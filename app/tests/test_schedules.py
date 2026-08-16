"""
schedules エンドポイントのテスト。

稼働表生成は ARQ キューへの投入のみ検証する（実際のソルバー実行はワーカープロセスが行う）。
export エンドポイントは GENERATED 状態のスケジュールを手動で作成して検証する。
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import date

from sqlalchemy import select

from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee
from app.models.schedule import ShiftAssignment, ShiftSchedule
from app.models.work_pattern import WorkPattern, WorkPatternGroup


@pytest_asyncio.fixture
async def dept_with_data(client: tuple) -> Department:
    """テスト用部門 + 従業員 + 作業パターン（最小構成）。"""
    _, session = client
    d = Department(name="テスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    # 従業員
    emp = Employee(
        employee_number=99001,
        department_id=d.id,
        name="テスト太郎",
        role="CHIEF",
        available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3",
        consecutive_workable=True,
    )
    session.add(emp)

    # 作業パターングループ + パターン
    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False)
    session.add(grp)
    await session.flush()
    pat = WorkPattern(
        group_id=grp.id,
        pattern_name="A1",
        shift_type=1,
        shift_start="07:00",
        shift_end="16:00",
    )
    session.add(pat)
    await session.flush()

    return d


@pytest_asyncio.fixture
async def generated_schedule(client: tuple, dept_with_data: Department) -> ShiftSchedule:
    """GENERATED 状態の ShiftSchedule（エクスポートテスト用）。"""
    _, session = client

    # 従業員を取得
    emp_result = await session.execute(
        select(Employee).where(Employee.department_id == dept_with_data.id)
    )
    emp = emp_result.scalar_one()

    pat_result = await session.execute(
        select(WorkPattern).join(WorkPatternGroup).where(
            WorkPatternGroup.department_id == dept_with_data.id
        )
    )
    pat = pat_result.scalar_one()

    schedule = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=4,
        status="GENERATED",
        generation_attempt=1,
        is_active=True,
    )
    session.add(schedule)
    await session.flush()

    # 1日分の勤務アサイン
    session.add(ShiftAssignment(
        schedule_id=schedule.id,
        employee_id=emp.id,
        date=date(2026, 4, 1),
        assignment_type="WORK",
        pattern_id=pat.id,
    ))
    # 残りは休み
    for d in range(2, 31):
        session.add(ShiftAssignment(
            schedule_id=schedule.id,
            employee_id=emp.id,
            date=date(2026, 4, d),
            assignment_type="REST",
            pattern_id=None,
        ))
    await session.flush()
    return schedule


# ---- テスト ----

@pytest.mark.asyncio
async def test_list_schedules_empty(client: tuple, auth_headers: dict):
    http, _ = client
    resp = await http.get("/api/v1/schedules", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_schedule_not_found(client: tuple, auth_headers: dict):
    http, _ = client
    resp = await http.get("/api/v1/schedules/99999", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_generate_requires_auth(client: tuple, dept_with_data: Department):
    http, _ = client
    resp = await http.post("/api/v1/schedules/generate", json={
        "department_id": dept_with_data.id,
        "year": 2026,
        "month": 5,
    })
    assert resp.status_code == 401


# ---- cancel エンドポイント (issue #177) ----

@pytest.mark.asyncio
async def test_cancel_schedule_draft_transitions_to_cancelled(
    client: tuple, auth_headers: dict, dept_with_data: Department, monkeypatch
):
    """DRAFT 状態の cancel は即時 CANCELLED に遷移する。"""
    http, session = client

    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026, month=8,
        status="DRAFT", generation_attempt=1, is_active=False,
    )
    session.add(sch)
    await session.flush()

    # Redis 接続をスタブ化
    sets: list[tuple[str, bytes]] = []

    class _StubRedis:
        async def set(self, key, value, ex=None):
            sets.append((key, value))

        async def aclose(self):
            return None

    async def _fake_pool(_settings):
        return _StubRedis()

    import arq
    monkeypatch.setattr(arq, "create_pool", _fake_pool)

    resp = await http.post(
        f"/api/v1/schedules/{sch.id}/cancel", headers=auth_headers
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "CANCELLED"
    # Redis フラグも立っている
    assert any(k == f"schedule:cancel:{sch.id}" for k, _ in sets)


@pytest.mark.asyncio
async def test_cancel_schedule_generating_sets_flag_only(
    client: tuple, auth_headers: dict, dept_with_data: Department, monkeypatch
):
    """GENERATING の cancel はフラグだけ立て、状態は worker が CANCELLED に確定するまで GENERATING のまま。"""
    http, session = client

    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026, month=9,
        status="GENERATING", generation_attempt=1, is_active=False,
    )
    session.add(sch)
    await session.flush()

    sets: list[tuple[str, bytes]] = []

    class _StubRedis:
        async def set(self, key, value, ex=None):
            sets.append((key, value))

        async def aclose(self):
            return None

    async def _fake_pool(_settings):
        return _StubRedis()

    import arq
    monkeypatch.setattr(arq, "create_pool", _fake_pool)

    resp = await http.post(
        f"/api/v1/schedules/{sch.id}/cancel", headers=auth_headers
    )
    assert resp.status_code == 202
    body = resp.json()
    # worker が確定するまでは GENERATING のまま返す（フラグだけ立った状態）
    assert body["status"] == "GENERATING"
    assert any(k == f"schedule:cancel:{sch.id}" for k, _ in sets)


@pytest.mark.asyncio
async def test_cancel_schedule_already_generated_returns_409(
    client: tuple, auth_headers: dict, generated_schedule: ShiftSchedule
):
    """GENERATED 済みは停止できない。"""
    http, _ = client
    resp = await http.post(
        f"/api/v1/schedules/{generated_schedule.id}/cancel",
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_cancel_schedule_not_found(client: tuple, auth_headers: dict):
    http, _ = client
    resp = await http.post("/api/v1/schedules/99999/cancel", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_schedule_requires_auth(client: tuple):
    http, _ = client
    resp = await http.post("/api/v1/schedules/1/cancel")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_export_generated_schedule(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}/export",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    # xlsx マジックバイト (PK\x03\x04)
    assert resp.content[:4] == b"PK\x03\x04"


@pytest.mark.asyncio
async def test_export_csv_long_generated_schedule(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    """CSV エクスポートが 200 を返し cp932 でデコードできること。"""
    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}/export/csv",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]

    # cp932 でデコードできること
    text = resp.content.decode("cp932")
    lines = [l for l in text.splitlines() if l]

    # ヘッダ確認
    header = lines[0].split(",")
    assert header == ["社員番号", "氏名", "日付", "祝日", "作業パターン", "勤務区分"]

    # 行数: ヘッダ1 + 従業員1名 × 30日
    assert len(lines) == 1 + 30


@pytest.mark.asyncio
async def test_export_csv_long_rest_codes(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    """REST アサインが 割当休日コード(4) に変換されること。"""
    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}/export/csv",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    text = resp.content.decode("cp932")
    lines = text.splitlines()[1:]  # ヘッダ除外

    # generated_schedule は 4/1 のみ WORK(A1)、残りは REST
    by_date = {row.split(",")[2]: row.split(",") for row in lines}
    assert by_date["2026/04/01"][4] == "A1"    # 勤務行: パターン名
    assert by_date["2026/04/01"][5] == "勤務"
    assert by_date["2026/04/02"][4] == "4"     # REST → 割当休日コード
    assert by_date["2026/04/02"][5] == "休日"


@pytest.mark.asyncio
async def test_export_csv_long_date_format(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    """日付列が yyyy/mm/dd 形式であること。"""
    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}/export/csv",
        headers=auth_headers,
    )
    text = resp.content.decode("cp932")
    first_data = text.splitlines()[1]
    date_val = first_data.split(",")[2]
    assert date_val == "2026/04/01"


@pytest.mark.asyncio
async def test_export_csv_long_draft_rejected(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    """DRAFT スケジュールは 409 を返すこと。"""
    _, session = client
    draft = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=8,
        status="DRAFT",
        generation_attempt=1,
        is_active=False,
    )
    session.add(draft)
    await session.flush()

    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{draft.id}/export/csv",
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_export_draft_schedule_rejected(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    _, session = client
    draft = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=6,
        status="DRAFT",
        generation_attempt=1,
        is_active=False,
    )
    session.add(draft)
    await session.flush()

    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{draft.id}/export",
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_compensatory_not_generated(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    _, session = client
    emp_result = await session.execute(
        select(Employee).where(Employee.department_id == dept_with_data.id)
    )
    emp = emp_result.scalar_one()

    draft = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=7,
        status="DRAFT",
        generation_attempt=1,
        is_active=False,
    )
    session.add(draft)
    await session.flush()

    http, _ = client
    resp = await http.post(
        f"/api/v1/schedules/{draft.id}/compensatory",
        headers=auth_headers,
        json={"employee_id": emp.id, "target_date": "2026-07-10"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_schedule(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    http, _ = client
    resp = await http.delete(
        f"/api/v1/schedules/{generated_schedule.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204

    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_schedule_not_found(client: tuple, auth_headers: dict):
    http, _ = client
    resp = await http.delete("/api/v1/schedules/99999", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_assignments(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{generated_schedule.id}/assignments",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["year"] == 2026
    assert data["month"] == 4
    assert len(data["employees"]) == 1
    emp = data["employees"][0]
    assert emp["name"] == "テスト太郎"
    assert len(emp["days"]) == 30  # 4月は30日
    day1 = next(d for d in emp["days"] if d["day"] == 1)
    assert day1["label"] == "A1"
    # 構造化フィールドが含まれること（issue #91: client は label 逆引きを行わない）
    assert day1["assignment_type"] == "WORK"
    assert isinstance(day1["pattern_id"], int)
    assert day1["leave_type"] is None

    day2 = next(d for d in emp["days"] if d["day"] == 2)
    assert day2["label"] == "割当休日"
    assert day2["assignment_type"] == "REST"
    assert day2["pattern_id"] is None
    assert day2["leave_type"] is None


@pytest.mark.asyncio
async def test_get_assignments_not_generated(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    _, session = client
    draft = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=8,
        status="DRAFT",
        generation_attempt=1,
        is_active=False,
    )
    session.add(draft)
    await session.flush()

    http, _ = client
    resp = await http.get(
        f"/api/v1/schedules/{draft.id}/assignments",
        headers=auth_headers,
    )
    assert resp.status_code == 409


# ---- issue #196: stale GENERATING sweeper -----------------------------------

@pytest.mark.asyncio
async def test_get_schedule_flips_stale_generating_to_infeasible(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    """status='GENERATING' で heartbeat が time_limit*2 を超えて止まっている行は
    GET /schedules/{id} で INFEASIBLE に flip され、永久 GENERATING を解消する。"""
    from datetime import datetime, timedelta, timezone

    _, session = client
    # time_limit=10s, started 5 分前, heartbeat も 5 分前 (停止)
    long_ago = datetime.now(timezone.utc) - timedelta(minutes=5)
    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=9,
        status="GENERATING",
        generation_attempt=1,
        is_active=False,
        started_at=long_ago,
        last_heartbeat_at=long_ago,
        time_limit=10.0,
    )
    session.add(sch)
    await session.flush()
    await session.commit()

    http, _ = client
    resp = await http.get(f"/api/v1/schedules/{sch.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "INFEASIBLE"
    assert "ワーカー" in (body["diagnosis"] or "")


@pytest.mark.asyncio
async def test_get_schedule_does_not_flip_fresh_generating(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    """heartbeat が新しければ GENERATING のまま返る (誤検出しない)。"""
    from datetime import datetime, timedelta, timezone

    _, session = client
    started = datetime.now(timezone.utc) - timedelta(seconds=5)
    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=10,
        status="GENERATING",
        generation_attempt=1,
        is_active=False,
        started_at=started,
        last_heartbeat_at=datetime.now(timezone.utc),
        time_limit=120.0,
    )
    session.add(sch)
    await session.flush()
    await session.commit()

    http, _ = client
    resp = await http.get(f"/api/v1/schedules/{sch.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "GENERATING"


@pytest.mark.asyncio
async def test_get_schedule_does_not_flip_within_grace_window(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    """time_limit が極端に短い (1s) でも、最低 grace 30s 以内は flip しない。"""
    from datetime import datetime, timedelta, timezone

    _, session = client
    started = datetime.now(timezone.utc) - timedelta(seconds=5)
    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=11,
        status="GENERATING",
        generation_attempt=1,
        is_active=False,
        started_at=started,
        last_heartbeat_at=None,  # heartbeat 無くても grace 内なら flip しない
        time_limit=1.0,
    )
    session.add(sch)
    await session.flush()
    await session.commit()

    http, _ = client
    resp = await http.get(f"/api/v1/schedules/{sch.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "GENERATING"


@pytest.mark.asyncio
async def test_get_schedule_flips_stale_when_heartbeat_never_set(
    client: tuple,
    auth_headers: dict,
    dept_with_data: Department,
):
    """worker が heartbeat を一度も書かずに死んだケース (起動直後の SIGKILL):
    started_at が十分古ければ flip する。"""
    from datetime import datetime, timedelta, timezone

    _, session = client
    long_ago = datetime.now(timezone.utc) - timedelta(minutes=10)
    sch = ShiftSchedule(
        department_id=dept_with_data.id,
        year=2026,
        month=12,
        status="GENERATING",
        generation_attempt=1,
        is_active=False,
        started_at=long_ago,
        last_heartbeat_at=None,
        time_limit=60.0,
    )
    session.add(sch)
    await session.flush()
    await session.commit()

    http, _ = client
    resp = await http.get(f"/api/v1/schedules/{sch.id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "INFEASIBLE"


@pytest.mark.asyncio
async def test_compensatory_proposals(
    client: tuple,
    auth_headers: dict,
    generated_schedule: ShiftSchedule,
):
    _, session = client
    from sqlalchemy import select
    emp_result = await session.execute(
        select(Employee).where(Employee.department_id == generated_schedule.department_id)
    )
    emp = emp_result.scalar_one()

    http, _ = client
    resp = await http.post(
        f"/api/v1/schedules/{generated_schedule.id}/compensatory",
        headers=auth_headers,
        json={"employee_id": emp.id, "target_date": "2026-04-02"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "proposals" in data
    # 2日目(REST)→WORK にするので代休候補は1日目(WORK)のみ
    assert isinstance(data["proposals"], list)
