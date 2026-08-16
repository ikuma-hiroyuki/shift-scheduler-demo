"""
手動編集 PATCH /schedules/{id}/assignments のテスト。

ハード制約: H8 非両立 / H10 MANDATORY 有給 / H11 choice group / H13 グループ 1 日 1 名
ソフト制約は検査しない（人間判断を優先）。
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
    PatternIncompatibility,
)
from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.schedule import ShiftAssignment, ShiftSchedule, ShiftShortageSlot
from app.models.work_pattern import WorkPattern, WorkPatternGroup


@pytest_asyncio.fixture
async def edit_setup(client: tuple):
    """
    2 従業員 + グループ A(A1,A2) + グループ B(B1) + 既存 GENERATED スケジュール(2026/4)
    を持つ最小構成。
    """
    _, session = client
    d = Department(name="編集テスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emp1 = Employee(
        employee_number=10001, department_id=d.id, name="Alice",
        role="CHIEF", available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3", consecutive_workable=True,
    )
    emp2 = Employee(
        employee_number=10002, department_id=d.id, name="Bob",
        role="STAFF", available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3", consecutive_workable=True,
    )
    session.add_all([emp1, emp2])

    g_a = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False)
    g_b = WorkPatternGroup(department_id=d.id, name="B", is_auxiliary=False)
    session.add_all([g_a, g_b])
    await session.flush()

    p_a1 = WorkPattern(group_id=g_a.id, pattern_name="A1", shift_type=1,
                       shift_start="07:00", shift_end="16:00")
    p_a2 = WorkPattern(group_id=g_a.id, pattern_name="A2", shift_type=2,
                       shift_start="09:00", shift_end="18:00")
    p_b1 = WorkPattern(group_id=g_b.id, pattern_name="B1", shift_type=2,
                       shift_start="10:00", shift_end="19:00")
    session.add_all([p_a1, p_a2, p_b1])
    await session.flush()

    schedule = ShiftSchedule(
        department_id=d.id, year=2026, month=4, status="GENERATED",
        generation_attempt=1, is_active=True,
    )
    session.add(schedule)
    await session.flush()

    # 初期アサイン: Alice は 4/1 に A1, 4/2 は REST。Bob は 4/1 に B1, 4/2 は REST。
    session.add_all([
        ShiftAssignment(schedule_id=schedule.id, employee_id=emp1.id,
                        date=date(2026, 4, 1), assignment_type="WORK", pattern_id=p_a1.id),
        ShiftAssignment(schedule_id=schedule.id, employee_id=emp1.id,
                        date=date(2026, 4, 2), assignment_type="REST", pattern_id=None),
        ShiftAssignment(schedule_id=schedule.id, employee_id=emp2.id,
                        date=date(2026, 4, 1), assignment_type="WORK", pattern_id=p_b1.id),
        ShiftAssignment(schedule_id=schedule.id, employee_id=emp2.id,
                        date=date(2026, 4, 2), assignment_type="REST", pattern_id=None),
    ])
    await session.flush()

    return {
        "dept": d, "schedule": schedule,
        "emp_alice": emp1, "emp_bob": emp2,
        "p_a1": p_a1, "p_a2": p_a2, "p_b1": p_b1,
    }


# ---- Happy paths ----

@pytest.mark.asyncio
async def test_work_to_rest(client: tuple, auth_headers: dict, edit_setup):
    http, session = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-01",
            "assignment_type": "REST",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["label"] == "割当休日"
    assert body["assignment_type"] == "REST"
    assert body["pattern_id"] is None


@pytest.mark.asyncio
async def test_rest_to_work_with_pattern(client: tuple, auth_headers: dict, edit_setup):
    http, session = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-02",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["label"] == "A2"
    assert body["pattern_id"] == s["p_a2"].id


@pytest.mark.asyncio
async def test_rest_to_leave_creates_leave_request(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, session = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-02",
            "assignment_type": "LEAVE",
            "leave_type": "MANDATORY",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "有給"

    # LeaveRequest が作成された
    lr = (await session.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == s["emp_alice"].id,
            LeaveRequest.day == 2,
        )
    )).scalar_one_or_none()
    assert lr is not None
    assert lr.leave_type == "MANDATORY"


@pytest.mark.asyncio
async def test_leave_to_work_deletes_leave_request(
    client: tuple, auth_headers: dict, edit_setup,
):
    """REQUESTED(●) 希望休を WORK に戻す。MANDATORY ではないので H10 は発火しない。"""
    http, session = client
    s = edit_setup
    # 事前に LeaveRequest と LEAVE アサインをセット
    session.add(LeaveRequest(
        employee_id=s["emp_alice"].id, year=2026, month=4, day=3,
        leave_type="REQUESTED",
    ))
    session.add(ShiftAssignment(
        schedule_id=s["schedule"].id, employee_id=s["emp_alice"].id,
        date=date(2026, 4, 3), assignment_type="LEAVE", pattern_id=None,
    ))
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-03",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "A2"

    lr = (await session.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == s["emp_alice"].id,
            LeaveRequest.day == 3,
        )
    )).scalar_one_or_none()
    assert lr is None


# ---- H8: 非両立パターン ----

@pytest.mark.asyncio
async def test_h8_incompatibility_blocks(
    client: tuple, auth_headers: dict, edit_setup,
):
    """Alice と Bob が同日に使用不可な A1 と B1 を持つとき、Alice の A2 への変更は通る。
    A2-B1 が非両立のとき Alice を A2 に変更しようとすると 409。"""
    http, session = client
    s = edit_setup
    # A2 と B1 を非両立登録
    session.add(PatternIncompatibility(
        department_id=s["dept"].id,
        pattern_id_a=s["p_a2"].id,
        pattern_id_b=s["p_b1"].id,
    ))
    await session.flush()

    # Bob は 4/1 に B1。Alice を 4/1 で A1 → A2 に変更 → 非両立で 409
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-01",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    # ハード制約違反時、内部コード（H8 等）は client に露出させない（issue #91）
    assert "code" not in detail
    assert "conflicting" not in detail
    # H8 専用の状況別 user-facing メッセージ
    assert "併用できません" in detail["message"]


# ---- H10: MANDATORY 有給 ----

@pytest.mark.asyncio
async def test_h10_mandatory_leave_blocks_work(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, session = client
    s = edit_setup
    session.add(LeaveRequest(
        employee_id=s["emp_alice"].id, year=2026, month=4, day=2,
        leave_type="MANDATORY",
    ))
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-02",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "code" not in detail
    # H10 専用文言（有給休暇言及、ただし内部 enum "MANDATORY" は出さない）
    assert "有給休暇" in detail["message"]
    assert "MANDATORY" not in detail["message"]


@pytest.mark.asyncio
async def test_h10_requested_leave_allows_override(
    client: tuple, auth_headers: dict, edit_setup,
):
    """REQUESTED(●) はハード扱いしない。WORK への変更を許可する。"""
    http, session = client
    s = edit_setup
    session.add(LeaveRequest(
        employee_id=s["emp_alice"].id, year=2026, month=4, day=2,
        leave_type="REQUESTED",
    ))
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-02",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 200, resp.text


# ---- H11: choice group 人数制約 ----

@pytest.mark.asyncio
async def test_h11_choice_group_min_violated(
    client: tuple, auth_headers: dict, edit_setup,
):
    """choice group(A1 or A2) を min=1 max=1 に設定した weekday=水(4/1) で、
    Alice の A1 を REST に変更すると A 候補が 0 になり H11 違反。"""
    http, session = client
    s = edit_setup
    cg = PatternChoiceGroup(
        department_id=s["dept"].id,
        day_of_week=2,  # 水曜 (2026-04-01 は水)
        min_count=1, max_count=1,
    )
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=s["p_a1"].id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=s["p_a2"].id),
    ])
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-01",
            "assignment_type": "REST",
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "code" not in detail
    # H11 専用文言、内部 ID は出さない
    assert "曜日" in detail["message"] or "人数" in detail["message"]
    assert "id=" not in detail["message"]


# ---- H13: 作業パターングループは 1 日 1 名まで ----

@pytest.mark.asyncio
async def test_h13_group_unique(
    client: tuple, auth_headers: dict, edit_setup,
):
    """4/1 に Alice=A1 あり。Bob を A2 に変更しようとすると A グループが 2 名になり H13。"""
    http, session = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_bob"].id,
            "date": "2026-04-01",
            "assignment_type": "WORK",
            "pattern_id": s["p_a2"].id,
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "code" not in detail
    # H13 専用文言
    assert "1 日 1 名" in detail["message"]


# ---- エンドポイント入力検証 ----

@pytest.mark.asyncio
async def test_patch_draft_schedule_rejected(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, session = client
    s = edit_setup
    s["schedule"].status = "DRAFT"
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-01",
            "assignment_type": "REST",
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_patch_date_mismatch_rejected(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-05-01",  # 違う月
            "assignment_type": "REST",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_patch_work_without_pattern_id_rejected(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments",
        headers=auth_headers,
        json={
            "employee_id": s["emp_alice"].id,
            "date": "2026-04-02",
            "assignment_type": "WORK",
            # pattern_id を送らない
        },
    )
    assert resp.status_code == 400


# ---- work-patterns の department_id フィルタ ----

@pytest.mark.asyncio
async def test_work_patterns_filter_by_department(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, session = client
    s = edit_setup

    # 別部門を追加してパターンが混ざらないことを確認
    other_dept = Department(name="他部門")
    session.add(other_dept)
    await session.flush()
    other_group = WorkPatternGroup(department_id=other_dept.id, name="X")
    session.add(other_group)
    await session.flush()
    session.add(WorkPattern(
        group_id=other_group.id, pattern_name="X1", shift_type=1,
        shift_start="08:00", shift_end="17:00",
    ))
    await session.flush()

    resp = await http.get(
        f"/api/v1/work-patterns?department_id={s['dept'].id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    names = [p["pattern_name"] for p in resp.json()]
    assert sorted(names) == ["A1", "A2", "B1"]
    assert "X1" not in names


# ---- バッチ編集 (swap 等の多段編集) ----

@pytest.mark.asyncio
async def test_batch_swap_succeeds(client: tuple, auth_headers: dict, edit_setup):
    """Alice の A1 と Bob の B1 を同日で入れ替える。単セル PATCH だと H13 で失敗するが、
    バッチなら最終状態でのみ検査されるため通る。"""
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-01",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_b1"].id,
                },
                {
                    "employee_id": s["emp_bob"].id,
                    "date": "2026-04-01",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a1"].id,
                },
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    results = body["results"]
    assert len(results) == 2
    assert results[0]["label"] == "B1"
    assert results[1]["label"] == "A1"


@pytest.mark.asyncio
async def test_batch_h13_violation_rolls_back(
    client: tuple, auth_headers: dict, edit_setup,
):
    """2 名を同日同グループにセットするバッチは H13 で 409 + 全ロールバック。"""
    http, session = client
    s = edit_setup
    # 事前に Bob の 4/2 REST を確認
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a1"].id,
                },
                {
                    "employee_id": s["emp_bob"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a2"].id,  # 同 A グループ → H13
                },
            ]
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "code" not in detail
    # batch でも H13 専用文言を返す
    assert "1 日 1 名" in detail["message"]

    # ロールバック確認: Alice 4/2 は元の REST のまま
    await session.refresh(s["schedule"])
    result = await session.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == s["schedule"].id,
            ShiftAssignment.employee_id == s["emp_alice"].id,
            ShiftAssignment.date == date(2026, 4, 2),
        )
    )
    a = result.scalar_one()
    assert a.assignment_type == "REST"
    assert a.pattern_id is None


@pytest.mark.asyncio
async def test_batch_empty_rejected(client: tuple, auth_headers: dict, edit_setup):
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={"edits": []},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_batch_date_mismatch_rejected(
    client: tuple, auth_headers: dict, edit_setup,
):
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-05-01",  # 別月
                    "assignment_type": "REST",
                },
            ]
        },
    )
    assert resp.status_code == 400


# ---- 代休候補の自動添付（issue #91: REST→WORK 検知を backend に集約） ----

@pytest.mark.asyncio
async def test_batch_attaches_compensatory_suggestion_for_rest_to_work(
    client: tuple, auth_headers: dict, edit_setup,
):
    """REST→WORK 遷移を含む batch PATCH では compensatory_suggestion を自動添付する。

    旧 frontend は edits を再走査して /compensatory を別 API で叩いていたが、
    issue #91 で backend に集約。
    """
    http, _ = client
    s = edit_setup
    # Alice 4/2 (REST) → WORK + A1 への変更
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a1"].id,
                },
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    suggestion = body["compensatory_suggestion"]
    assert suggestion is not None
    assert suggestion["employee_id"] == s["emp_alice"].id
    assert suggestion["target_date"] == "2026-04-02"
    assert isinstance(suggestion["proposals"], list)
    assert suggestion["additional_transition_count"] == 0


@pytest.mark.asyncio
async def test_batch_no_compensatory_when_only_work_to_rest(
    client: tuple, auth_headers: dict, edit_setup,
):
    """WORK→REST のみの編集には compensatory_suggestion を添付しない。"""
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-01",  # 元 WORK(A1)
                    "assignment_type": "REST",
                },
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["compensatory_suggestion"] is None


# ---- force=true: ハード制約を無視して強制確定 (issue #245) ----

@pytest.mark.asyncio
async def test_batch_force_bypasses_h11(
    client: tuple, auth_headers: dict, edit_setup,
):
    """H11 (choice group 人数) 違反になる編集でも force=true なら 200 + 永続化。

    A1/A2 を min=1 max=1 に設定した水曜 (4/1)。Alice の A1 を REST にすると
    A 候補が 0 になり通常は H11 違反。force=true で人不足を承知で確定する。
    """
    http, session = client
    s = edit_setup
    cg = PatternChoiceGroup(
        department_id=s["dept"].id,
        day_of_week=2,  # 水曜 (2026-04-01)
        min_count=1, max_count=1,
    )
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=s["p_a1"].id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=s["p_a2"].id),
    ])
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "force": True,
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-01",
                    "assignment_type": "REST",
                },
            ],
        },
    )
    assert resp.status_code == 200, resp.text

    # 永続化確認: Alice 4/1 は REST
    result = await session.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == s["schedule"].id,
            ShiftAssignment.employee_id == s["emp_alice"].id,
            ShiftAssignment.date == date(2026, 4, 1),
        )
    )
    a = result.scalar_one()
    assert a.assignment_type == "REST"
    assert a.pattern_id is None


@pytest.mark.asyncio
async def test_batch_force_bypasses_h13(
    client: tuple, auth_headers: dict, edit_setup,
):
    """同日同グループ 2 名 (H13 違反) でも force=true なら 200。"""
    http, session = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "force": True,
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a1"].id,
                },
                {
                    "employee_id": s["emp_bob"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a2"].id,  # 同 A グループ
                },
            ],
        },
    )
    assert resp.status_code == 200, resp.text

    result = await session.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == s["schedule"].id,
            ShiftAssignment.date == date(2026, 4, 2),
            ShiftAssignment.assignment_type == "WORK",
        )
    )
    pids = sorted(a.pattern_id for a in result.scalars().all())
    assert pids == sorted([s["p_a1"].id, s["p_a2"].id])


@pytest.mark.asyncio
async def test_batch_force_bypasses_h8(
    client: tuple, auth_headers: dict, edit_setup,
):
    """非両立ペア (H8 違反) でも force=true なら 200。"""
    http, session = client
    s = edit_setup
    session.add(PatternIncompatibility(
        department_id=s["dept"].id,
        pattern_id_a=s["p_a2"].id,
        pattern_id_b=s["p_b1"].id,
    ))
    await session.flush()

    # 4/1: Bob=B1 のまま、Alice を A1 → A2 (A2-B1 非両立)
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "force": True,
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-01",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a2"].id,
                },
            ],
        },
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_batch_force_still_blocks_h10_mandatory_leave(
    client: tuple, auth_headers: dict, edit_setup,
):
    """H10 は force でも常にブロック。MANDATORY 有給 → WORK は 409 + 有給レコード保持。

    上書きを許すと _sync_leave_request が LeaveRequest を削除し、法的 PTO の記録が
    失われるため (issue #245 / codex review #2 の方針)。
    """
    http, session = client
    s = edit_setup
    session.add(LeaveRequest(
        employee_id=s["emp_alice"].id, year=2026, month=4, day=2,
        leave_type="MANDATORY",
    ))
    await session.flush()

    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "force": True,
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a2"].id,
                },
            ],
        },
    )
    assert resp.status_code == 409, resp.text
    assert "有給休暇" in resp.json()["detail"]["message"]

    # 有給レコードは保持される (削除されない)
    lr = await session.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == s["emp_alice"].id,
            LeaveRequest.year == 2026,
            LeaveRequest.month == 4,
            LeaveRequest.day == 2,
        )
    )
    kept = lr.scalar_one_or_none()
    assert kept is not None
    assert kept.leave_type == "MANDATORY"


@pytest.mark.asyncio
async def test_batch_force_still_validates_shape(
    client: tuple, auth_headers: dict, edit_setup,
):
    """force=true でも入力整合性 (WORK に pattern_id 必須) は 400 で弾く。"""
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "force": True,
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    # pattern_id 欠落
                },
            ],
        },
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_batch_force_default_false_still_blocks(
    client: tuple, auth_headers: dict, edit_setup,
):
    """force 省略時は従来どおりハード制約 (H13) で 409。"""
    http, _ = client
    s = edit_setup
    resp = await http.patch(
        f"/api/v1/schedules/{s['schedule'].id}/assignments/batch",
        headers=auth_headers,
        json={
            "edits": [
                {
                    "employee_id": s["emp_alice"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a1"].id,
                },
                {
                    "employee_id": s["emp_bob"].id,
                    "date": "2026-04-02",
                    "assignment_type": "WORK",
                    "pattern_id": s["p_a2"].id,  # 同 A グループ → H13
                },
            ],
        },
    )
    assert resp.status_code == 409, resp.text


@pytest.mark.asyncio
async def test_recalc_no_phantom_shortage_after_overfill(client, edit_setup):
    """範囲枠(required_min=2)で下限を超えて手動追加(over-fill)した後に削除しても、
    missing を実 WORK 数から再計算するため phantom shortage が出ない (issue #247 Codex F1)。"""
    from app.services.assignment_edit_service import _recalc_shortage_slot

    _, session = client
    s = edit_setup
    sched, p = s["schedule"], s["p_a1"]
    target = date(2026, 4, 3)

    emp3 = Employee(
        employee_number=10003, department_id=s["dept"].id, name="Carol",
        role="STAFF", available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3", consecutive_workable=True,
    )
    session.add(emp3)
    await session.flush()

    # 範囲枠 required_min=2、生成時 assigned=1 → missing=1
    slot = ShiftShortageSlot(
        schedule_id=sched.id, date=target, pattern_id=p.id,
        required_min=2, missing_count=1,
    )
    session.add(slot)
    session.add(ShiftAssignment(
        schedule_id=sched.id, employee_id=s["emp_alice"].id,
        date=target, assignment_type="WORK", pattern_id=p.id,
    ))
    await session.flush()

    async def recalc_and_missing() -> int:
        await _recalc_shortage_slot(session, sched.id, target, p.id)
        return slot.missing_count

    # assigned=1 → missing=1
    assert await recalc_and_missing() == 1

    # +Bob → assigned=2 (下限ちょうど) → missing=0
    a_bob = ShiftAssignment(
        schedule_id=sched.id, employee_id=s["emp_bob"].id,
        date=target, assignment_type="WORK", pattern_id=p.id,
    )
    session.add(a_bob)
    await session.flush()
    assert await recalc_and_missing() == 0

    # +Carol → assigned=3 (over-fill) → missing=0
    a_carol = ShiftAssignment(
        schedule_id=sched.id, employee_id=emp3.id,
        date=target, assignment_type="WORK", pattern_id=p.id,
    )
    session.add(a_carol)
    await session.flush()
    assert await recalc_and_missing() == 0

    # -Carol → assigned=2 (下限満たす) → missing=0  ← phantom 検証(従来は 1 になっていた)
    await session.delete(a_carol)
    await session.flush()
    assert await recalc_and_missing() == 0

    # -Bob → assigned=1 (下限割れ) → missing=1
    await session.delete(a_bob)
    await session.flush()
    assert await recalc_and_missing() == 1
