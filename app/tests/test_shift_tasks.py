"""
generate_shift タスクのタイムスタンプ記録テスト。

実際の CP-SAT 実行と DB エンジン生成は monkeypatch で差し替え、
DB セッション (テスト用 savepoint) を共有して started_at / finished_at が
3 完了経路 (成功 / INFEASIBLE / 入力エラー) すべてで記録されることを確認する。
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.schedule import ShiftSchedule
from app.services import schedule_service
from app.tasks import shift_tasks


class _SessionCtx:
    """async_sessionmaker() の戻り値が返す async ctx の代替。close は呼ばない。"""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *exc) -> None:
        # テスト fixture 側で close するので何もしない
        pass


class _FakeEngine:
    async def dispose(self) -> None:
        pass


@pytest.fixture
def patched_task(monkeypatch, client: tuple):
    """generate_shift が独自に作るエンジン/セッションをテスト用 session に差し替える。"""
    _, session = client

    monkeypatch.setattr(shift_tasks, "create_async_engine", lambda *a, **kw: _FakeEngine())
    monkeypatch.setattr(
        shift_tasks,
        "async_sessionmaker",
        lambda *a, **kw: (lambda: _SessionCtx(session)),
    )

    async def _fake_build_input(db, dept_id, year, month):
        return object()

    monkeypatch.setattr(shift_tasks, "build_shift_model_input", _fake_build_input)
    # preflight は generate_shift パイプラインに新規追加されたので、デフォルトでは
    # no-op に差し替える (個別テストで上書き可)。
    monkeypatch.setattr(
        shift_tasks, "preflight_priority_master", lambda inp: None,
    )
    # PARTIAL フローのデフォルトモック (テスト側で上書き可)。
    # 標準解 INFEASIBLE のテストでは部分解も INFEASIBLE で「従来の INFEASIBLE 経路」を踏むようにする。
    monkeypatch.setattr(
        shift_tasks, "run_partial_solve",
        lambda inp, sid, time_limit, solver=None: ("INFEASIBLE", [], [], []),
    )
    return session


async def _make_schedule(session: AsyncSession) -> ShiftSchedule:
    dept = Department(name="タスクテスト部門")
    session.add(dept)
    await session.flush()
    sch = ShiftSchedule(
        department_id=dept.id, year=2026, month=6,
        status="DRAFT", generation_attempt=1, is_active=False,
    )
    session.add(sch)
    await session.flush()
    return sch


@pytest.mark.asyncio
async def test_generate_shift_records_timestamps_on_success(monkeypatch, patched_task):
    session = patched_task
    sch = await _make_schedule(session)

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("OPTIMAL", []),
    )

    before = datetime.now(timezone.utc)
    result = await shift_tasks.generate_shift(sch.id)
    after = datetime.now(timezone.utc)

    assert result["status"] == "GENERATED"
    await session.refresh(sch)
    assert sch.status == "GENERATED"
    assert sch.started_at is not None and before <= sch.started_at <= after
    assert sch.finished_at is not None and sch.started_at <= sch.finished_at <= after


@pytest.mark.asyncio
async def test_generate_shift_records_timestamps_on_infeasible(monkeypatch, patched_task):
    session = patched_task
    sch = await _make_schedule(session)

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    monkeypatch.setattr(shift_tasks, "run_diagnosis", lambda inp: ["H3違反"])
    monkeypatch.setattr(shift_tasks, "run_capacity_summary", lambda inp: [])

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    # 不足日サマリは空、suspects のみある → 「【原因の可能性】」セクションのみ
    assert "【原因の可能性】" in sch.diagnosis
    assert "H3違反" in sch.diagnosis
    assert sch.started_at is not None
    assert sch.finished_at is not None
    assert sch.started_at <= sch.finished_at


@pytest.mark.asyncio
async def test_generate_shift_concatenates_shortage_summary_and_suspects(
    monkeypatch, patched_task
):
    """INFEASIBLE 時、不足日サマリと原因可能性の両セクションが \\n\\n 区切りで並ぶ。"""
    session = patched_task
    sch = await _make_schedule(session)

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    monkeypatch.setattr(
        shift_tasks, "run_capacity_summary",
        lambda inp: ["10日(土): 必要枠8名 > 利用可能7名 (希望休7名)"],
    )
    monkeypatch.setattr(shift_tasks, "run_diagnosis", lambda inp: ["有給・希望休"])

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "INFEASIBLE"
    await session.refresh(sch)
    diagnosis = sch.diagnosis
    assert "【不足日サマリ】" in diagnosis
    assert "10日(土): 必要枠8名 > 利用可能7名 (希望休7名)" in diagnosis
    assert "【原因の可能性】" in diagnosis
    assert "有給・希望休" in diagnosis
    # 不足日サマリが原因可能性より先に来ること
    assert diagnosis.index("【不足日サマリ】") < diagnosis.index("【原因の可能性】")


@pytest.mark.asyncio
async def test_generate_shift_diagnosis_when_no_shortage_and_no_suspects(
    monkeypatch, patched_task
):
    """不足日サマリも原因可能性も空の場合、固定文「容量は足りていますが...」を出す。"""
    session = patched_task
    sch = await _make_schedule(session)

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    monkeypatch.setattr(shift_tasks, "run_capacity_summary", lambda inp: [])
    monkeypatch.setattr(shift_tasks, "run_diagnosis", lambda inp: [])

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert "【不足日サマリ】" in sch.diagnosis
    assert "容量は足りていますが" in sch.diagnosis


@pytest.mark.asyncio
async def test_generate_shift_bumps_attempt_on_infeasible_retry(
    monkeypatch, patched_task
):
    """issue #211: INFEASIBLE 状態で再投入されると generation_attempt が +1 される。
    これにより診断履歴と監査ログが「第 N 回試行」で区別できる。"""
    session = patched_task
    sch = await _make_schedule(session)

    # 1 回目: INFEASIBLE で終了 (attempt=1 のまま)
    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    monkeypatch.setattr(shift_tasks, "run_diagnosis", lambda inp: ["H3違反"])
    monkeypatch.setattr(shift_tasks, "run_capacity_summary", lambda inp: [])
    result1 = await shift_tasks.generate_shift(sch.id)
    assert result1["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    assert sch.generation_attempt == 1

    # 2 回目: ユーザが制約を緩めて再投入 → attempt が 2 に bump される
    result2 = await shift_tasks.generate_shift(sch.id)
    assert result2["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert sch.generation_attempt == 2

    # 3 回目: さらにもう一度 → 3 に bump
    result3 = await shift_tasks.generate_shift(sch.id)
    assert result3["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert sch.generation_attempt == 3


@pytest.mark.asyncio
async def test_generate_shift_does_not_bump_attempt_on_first_run(
    monkeypatch, patched_task
):
    """初回 (DRAFT 状態) からの実行は generation_attempt を変更しない。
    bump は INFEASIBLE → re-run の遷移でのみ発火する。"""
    session = patched_task
    sch = await _make_schedule(session)
    assert sch.generation_attempt == 1

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("OPTIMAL", []),
    )

    await shift_tasks.generate_shift(sch.id)
    await session.refresh(sch)
    assert sch.generation_attempt == 1


@pytest.mark.asyncio
async def test_generate_shift_skips_when_cancel_requested_before_solver(
    monkeypatch, patched_task
):
    """タスク起動後・solver 起動前に cancel フラグが立っていれば即時 CANCELLED に確定し、
    run_optimizer は呼ばれない。"""
    session = patched_task
    sch = await _make_schedule(session)

    called = {"run": False}

    def _should_not_run(*args, **kwargs):
        called["run"] = True
        return ("OPTIMAL", [])

    monkeypatch.setattr(shift_tasks, "run_optimizer", _should_not_run)

    schedule_service.mark_cancelled(sch.id)

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "CANCELLED"
    assert called["run"] is False
    await session.refresh(sch)
    assert sch.status == "CANCELLED"
    assert sch.finished_at is not None


@pytest.mark.asyncio
async def test_generate_shift_cancel_during_solver(monkeypatch, patched_task):
    """solver 実行中に cancel フラグが立てば watcher が stop_search を呼び、
    結果は CANCELLED として確定する。"""
    session = patched_task
    sch = await _make_schedule(session)

    stopped = {"called": False}

    class _Solver:
        def stop_search(self):
            stopped["called"] = True

    # cp_model.CpSolver を差し替え
    import app.tasks.shift_tasks as st_mod
    monkeypatch.setattr(st_mod.cp_model, "CpSolver", _Solver)

    def _slow_run(inp, sid, time_limit, workers, solver=None):
        # watcher が cancel を検知するまで擬似的に時間をかける（同期）
        # to_thread で別スレッド実行されるため、メインループはこの間にキャンセルフラグをポーリング可能。
        import time as _t
        for _ in range(20):
            if stopped["called"]:
                break
            _t.sleep(0.05)
        return ("UNKNOWN", [])

    monkeypatch.setattr(shift_tasks, "run_optimizer", _slow_run)

    async def _mark_cancelled_after_delay():
        import asyncio as _a
        await _a.sleep(0.2)
        schedule_service.mark_cancelled(sch.id)

    import asyncio
    trigger = asyncio.create_task(_mark_cancelled_after_delay())
    result = await shift_tasks.generate_shift(sch.id)
    await trigger

    assert result["status"] == "CANCELLED"
    assert stopped["called"] is True
    await session.refresh(sch)
    assert sch.status == "CANCELLED"
    assert sch.finished_at is not None


@pytest.mark.asyncio
async def test_generate_shift_cancel_during_partial_solve(monkeypatch, patched_task):
    """partial solve 中に cancel フラグが立てば watcher が stop_search を呼び、
    結果は CANCELLED として確定する。"""
    session = patched_task
    sch = await _make_schedule(session)

    stopped = {"called": False}

    class _Solver:
        def stop_search(self):
            stopped["called"] = True

    import app.tasks.shift_tasks as st_mod
    monkeypatch.setattr(st_mod.cp_model, "CpSolver", _Solver)

    # 標準 solve は UNKNOWN を返す（キャンセル想定の最短経路）
    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("UNKNOWN", []),
    )

    def _slow_partial(inp, sid, time_limit, solver=None):
        import time as _t
        for _ in range(20):
            if stopped["called"]:
                break
            _t.sleep(0.05)
        return ("UNKNOWN", [], [], [])

    monkeypatch.setattr(shift_tasks, "run_partial_solve", _slow_partial)

    async def _mark_cancelled_after_delay():
        import asyncio as _a
        await _a.sleep(0.2)
        schedule_service.mark_cancelled(sch.id)

    import asyncio
    trigger = asyncio.create_task(_mark_cancelled_after_delay())
    result = await shift_tasks.generate_shift(sch.id)
    await trigger

    assert result["status"] == "CANCELLED"
    assert stopped["called"] is True
    await session.refresh(sch)
    assert sch.status == "CANCELLED"
    assert sch.finished_at is not None


@pytest.mark.asyncio
async def test_generate_shift_records_timestamps_on_input_error(monkeypatch, patched_task):
    session = patched_task
    sch = await _make_schedule(session)

    async def _raise(db, dept_id, year, month):
        raise RuntimeError("入力データ不正")

    monkeypatch.setattr(shift_tasks, "build_shift_model_input", _raise)

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "ERROR"
    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    assert sch.diagnosis is not None and "入力データ" in sch.diagnosis
    assert sch.started_at is not None
    assert sch.finished_at is not None


@pytest.mark.asyncio
async def test_generate_shift_records_status_when_build_aborts_transaction(
    monkeypatch, patched_task
):
    """build が DB エラーでトランザクションを abort させても、診断を永続化できる。

    旧実装は abort 済みセッションで status を commit しようとして
    InFailedSQLTransactionError で二次クラッシュ → heartbeat 途絶で
    「ワーカー異常終了」という誤メッセージになっていた。handler 側で
    先に rollback することで、本来の原因が INFEASIBLE 診断として残る。
    """
    from sqlalchemy import text

    session = patched_task
    sch = await _make_schedule(session)

    async def _raise_db_error(db, dept_id, year, month):
        # 存在しない列を参照して asyncpg トランザクションを abort させる
        # (本番で起きた UndefinedColumnError と同等の状況を再現)。
        await db.execute(text("SELECT nonexistent_col_xyz FROM shift_schedules"))

    monkeypatch.setattr(shift_tasks, "build_shift_model_input", _raise_db_error)

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "ERROR"
    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    assert sch.diagnosis is not None and "入力データ構築エラー" in sch.diagnosis
    assert sch.finished_at is not None


# ---------------------------------------------------------------------------
# PARTIAL フロー: 標準 INFEASIBLE → solve_partial で部分解 → status='PARTIAL'
# ---------------------------------------------------------------------------

from app.optimizer.types import ShortageRow  # noqa: E402
from app.models.schedule import ShiftShortageSlot  # noqa: E402
from sqlalchemy import select  # noqa: E402


@pytest.mark.asyncio
async def test_generate_shift_partial_path_saves_shortages(
    monkeypatch, patched_task
):
    """標準 INFEASIBLE で solve_partial が解を返す → status='PARTIAL' + 不足が
    DB と diagnosis_json に正しく保存されること。"""
    from app.models.work_pattern import WorkPattern, WorkPatternGroup

    session = patched_task
    sch = await _make_schedule(session)

    # FK 整合性のため work_pattern を 2 件作成
    grp = WorkPatternGroup(department_id=sch.department_id, name="テスト", color="#3b82f6")
    session.add(grp)
    await session.flush()
    pat_b1 = WorkPattern(
        group_id=grp.id, pattern_name="B1", shift_type=1,
        shift_start="07:00", shift_end="15:00",
    )
    pat_c1 = WorkPattern(
        group_id=grp.id, pattern_name="C1", shift_type=1,
        shift_start="08:00", shift_end="16:00",
    )
    session.add_all([pat_b1, pat_c1])
    await session.flush()

    # 標準 solve は INFEASIBLE
    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    # solve_partial は FEASIBLE + 不足 2 件 (assignments は本テストの主題ではないので空)
    fake_shortages = [
        ShortageRow(day=5, pattern_id=pat_b1.id, pattern_name="B1",
                    required=1, assigned=0, missing=1),
        ShortageRow(day=5, pattern_id=pat_c1.id, pattern_name="C1",
                    required=1, assigned=0, missing=1),
    ]
    monkeypatch.setattr(
        shift_tasks, "run_partial_solve",
        lambda inp, sid, time_limit, solver=None: ("FEASIBLE", [], fake_shortages, []),
    )
    monkeypatch.setattr(
        shift_tasks, "run_capacity_summary",
        lambda inp: ["5日(月): 必要枠2名 > 利用可能0名 (希望休4名)"],
    )

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "PARTIAL"
    assert result["shortage_count"] == 2

    await session.refresh(sch)
    assert sch.status == "PARTIAL"
    assert sch.finished_at is not None
    # 構造化 diagnosis
    dj = sch.diagnosis_json
    assert dj is not None
    assert len(dj["shortages"]) == 2
    assert {s["pattern_id"] for s in dj["shortages"]} == {pat_b1.id, pat_c1.id}
    # 回帰: swap_proposals は含まれない
    assert "swap_proposals" not in dj
    # 人間可読 diagnosis
    assert sch.diagnosis is not None
    assert "【不足日サマリ】" in sch.diagnosis

    # ShiftShortageSlot が 2 件保存されている
    slot_result = await session.execute(
        select(ShiftShortageSlot).where(
            ShiftShortageSlot.schedule_id == sch.id
        )
    )
    slots = slot_result.scalars().all()
    assert len(slots) == 2


@pytest.mark.asyncio
async def test_generate_shift_falls_back_to_infeasible_when_partial_also_infeasible(
    monkeypatch, patched_task
):
    """solve_partial も INFEASIBLE (構造的不能) のときは従来通り status='INFEASIBLE'。"""
    session = patched_task
    sch = await _make_schedule(session)

    monkeypatch.setattr(
        shift_tasks, "run_optimizer",
        lambda inp, sid, time_limit, workers, solver=None: ("INFEASIBLE", []),
    )
    # default fixture patches run_partial_solve to return INFEASIBLE
    monkeypatch.setattr(shift_tasks, "run_diagnosis", lambda inp: ["管理職の毎日出勤"])
    monkeypatch.setattr(
        shift_tasks, "run_capacity_summary",
        lambda inp: ["5日(月): 管理職全員休み"],
    )

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "INFEASIBLE"
    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    assert sch.diagnosis is not None
    assert "管理職" in sch.diagnosis


@pytest.mark.asyncio
async def test_generate_shift_returns_infeasible_when_priority_master_incomplete(
    monkeypatch, patched_task
):
    """priority master が不完全 (preflight 失敗) のときは status='INFEASIBLE' +
    分かりやすい diagnosis を返し、solver は呼ばない。
    """
    from app.optimizer.loader import PriorityMasterError

    session = patched_task
    sch = await _make_schedule(session)

    # build_shift_model_input は通過、preflight が PriorityMasterError を投げる構成。
    # 実装は build → preflight の順なので preflight に到達する。
    monkeypatch.setattr(
        shift_tasks, "preflight_priority_master",
        lambda inp: (_ for _ in ()).throw(
            PriorityMasterError(
                "priority_master_incomplete: 要求 pattern に priority 設定済み "
                "employee が居ません: B朝, G週"
            )
        ),
    )
    # solver が呼ばれていないことを confirm するため raise する
    def _should_not_be_called(*args, **kwargs):
        raise AssertionError("solver should not be called when preflight fails")
    monkeypatch.setattr(shift_tasks, "run_optimizer", _should_not_be_called)

    result = await shift_tasks.generate_shift(sch.id)

    assert result["status"] == "ERROR"
    assert result["error"] == "priority_master_incomplete"

    await session.refresh(sch)
    assert sch.status == "INFEASIBLE"
    assert sch.diagnosis is not None
    assert "優先作業パターンマスタ" in sch.diagnosis
    assert "B朝" in sch.diagnosis and "G週" in sch.diagnosis
