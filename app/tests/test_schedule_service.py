"""
schedule_service の単体テスト。

enqueue_generation はバックグラウンドタスクを起動するため、
_spawn_generation_task を monkeypatch でスタブする。
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from app.models.department import Department, WorkRuleConfig
from app.models.schedule import ShiftSchedule
from app.services import schedule_service


@pytest_asyncio.fixture
async def two_depts(client: tuple) -> tuple[Department, Department]:
    _, session = client
    d1 = Department(name="スケジュールテスト1")
    d2 = Department(name="スケジュールテスト2")
    session.add_all([d1, d2])
    await session.flush()
    session.add(WorkRuleConfig(department_id=d1.id))
    session.add(WorkRuleConfig(department_id=d2.id))
    await session.flush()
    return d1, d2


@pytest.mark.asyncio
async def test_get_schedule_returns_none_for_unknown(client: tuple):
    _, session = client
    assert await schedule_service.get_schedule(session, 999999) is None


@pytest.mark.asyncio
async def test_get_schedule_returns_existing(client: tuple, two_depts):
    _, session = client
    d1, _ = two_depts
    sch = ShiftSchedule(
        department_id=d1.id, year=2026, month=5,
        status="DRAFT", generation_attempt=1, is_active=False,
    )
    session.add(sch)
    await session.flush()

    got = await schedule_service.get_schedule(session, sch.id)
    assert got is not None
    assert got.id == sch.id


@pytest.mark.asyncio
async def test_list_schedules_orders_desc(client: tuple, two_depts):
    _, session = client
    d1, _ = two_depts
    a = ShiftSchedule(department_id=d1.id, year=2026, month=3,
                      status="DRAFT", generation_attempt=1, is_active=False)
    b = ShiftSchedule(department_id=d1.id, year=2026, month=4,
                      status="DRAFT", generation_attempt=1, is_active=False)
    c = ShiftSchedule(department_id=d1.id, year=2026, month=4,
                      status="DRAFT", generation_attempt=2, is_active=False)
    session.add_all([a, b, c])
    await session.flush()

    rows = await schedule_service.list_schedules(session, department_id=d1.id)
    assert [(r.year, r.month, r.generation_attempt) for r in rows] == [
        (2026, 4, 2),
        (2026, 4, 1),
        (2026, 3, 1),
    ]


@pytest.mark.asyncio
async def test_list_schedules_filters_by_department(client: tuple, two_depts):
    _, session = client
    d1, d2 = two_depts
    session.add(ShiftSchedule(department_id=d1.id, year=2026, month=5,
                              status="DRAFT", generation_attempt=1, is_active=False))
    session.add(ShiftSchedule(department_id=d2.id, year=2026, month=5,
                              status="DRAFT", generation_attempt=1, is_active=False))
    await session.flush()

    only_d1 = await schedule_service.list_schedules(session, department_id=d1.id)
    assert len(only_d1) == 1
    assert only_d1[0].department_id == d1.id

    all_rows = await schedule_service.list_schedules(session)
    assert len(all_rows) == 2


@pytest.mark.asyncio
async def test_enqueue_generation_increments_attempt(
    client: tuple, two_depts, monkeypatch
):
    """同部門・同年月に既存があれば generation_attempt が +1 される。"""
    _, session = client
    d1, _ = two_depts

    monkeypatch.setattr(schedule_service, "_spawn_generation_task", lambda *a, **k: None)

    # 既存スケジュールを直接 INSERT
    session.add(ShiftSchedule(
        department_id=d1.id, year=2026, month=6,
        status="GENERATED", generation_attempt=1, is_active=True,
    ))
    session.add(ShiftSchedule(
        department_id=d1.id, year=2026, month=6,
        status="FAILED", generation_attempt=2, is_active=False,
    ))
    await session.flush()

    sch = await schedule_service.enqueue_generation(
        session, department_id=d1.id, year=2026, month=6,
    )
    assert sch.generation_attempt == 3
    assert sch.status == "DRAFT"
    assert sch.department_id == d1.id


@pytest.mark.asyncio
async def test_enqueue_generation_first_attempt(
    client: tuple, two_depts, monkeypatch
):
    """既存無しなら attempt=1。"""
    _, session = client
    d1, _ = two_depts

    monkeypatch.setattr(schedule_service, "_spawn_generation_task", lambda *a, **k: None)

    sch = await schedule_service.enqueue_generation(
        session, department_id=d1.id, year=2027, month=1,
    )
    assert sch.generation_attempt == 1


@pytest.mark.asyncio
async def test_enqueue_generation_persists_time_limit(
    client: tuple, two_depts, monkeypatch
):
    """time_limit 引数が ShiftSchedule に保存される。"""
    _, session = client
    d1, _ = two_depts

    monkeypatch.setattr(schedule_service, "_spawn_generation_task", lambda *a, **k: None)

    sch = await schedule_service.enqueue_generation(
        session, department_id=d1.id, year=2027, month=2, time_limit=180.0,
    )
    assert sch.time_limit == 180.0


@pytest.mark.asyncio
async def test_enqueue_generation_default_time_limit(
    client: tuple, two_depts, monkeypatch
):
    """time_limit を指定しない場合は 120 秒（API 既定値）。"""
    _, session = client
    d1, _ = two_depts

    monkeypatch.setattr(schedule_service, "_spawn_generation_task", lambda *a, **k: None)

    sch = await schedule_service.enqueue_generation(
        session, department_id=d1.id, year=2027, month=3,
    )
    assert sch.time_limit == 120.0
