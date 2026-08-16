"""
compensatory_service.propose_compensatory のテスト。
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.pattern_rule import SpecialAssignmentRule
from app.models.schedule import ShiftAssignment, ShiftSchedule
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.services.compensatory_service import propose_compensatory


@pytest_asyncio.fixture
async def schedule_with_assignments(client: tuple) -> tuple[ShiftSchedule, Employee, WorkPattern]:
    """2026/4 の最小構成スケジュール: emp が 1〜10日 WORK、11〜30日 REST。"""
    _, session = client
    d = Department(name="代休テスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emp = Employee(
        employee_number=66001,
        department_id=d.id,
        name="代休太郎",
        role="STAFF",
        available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3",
    )
    session.add(emp)

    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False)
    session.add(grp)
    await session.flush()
    pat = WorkPattern(
        group_id=grp.id, pattern_name="A1", shift_type=1,
        shift_start="07:00", shift_end="16:00",
    )
    session.add(pat)
    await session.flush()

    sch = ShiftSchedule(
        department_id=d.id, year=2026, month=4,
        status="GENERATED", generation_attempt=1, is_active=True,
    )
    session.add(sch)
    await session.flush()

    for day in range(1, 31):
        if day <= 10:
            session.add(ShiftAssignment(
                schedule_id=sch.id, employee_id=emp.id,
                date=date(2026, 4, day),
                assignment_type="WORK", pattern_id=pat.id,
            ))
        else:
            session.add(ShiftAssignment(
                schedule_id=sch.id, employee_id=emp.id,
                date=date(2026, 4, day),
                assignment_type="REST", pattern_id=None,
            ))
    await session.flush()
    return sch, emp, pat


@pytest.mark.asyncio
async def test_propose_excludes_target_date(client: tuple, schedule_with_assignments):
    _, session = client
    sch, emp, _ = schedule_with_assignments
    target = date(2026, 4, 5)
    proposals = await propose_compensatory(session, sch.id, emp.id, target, top_n=20)
    assert all(p.date != target for p in proposals)


@pytest.mark.asyncio
async def test_propose_only_work_days(client: tuple, schedule_with_assignments):
    _, session = client
    sch, emp, _ = schedule_with_assignments
    proposals = await propose_compensatory(
        session, sch.id, emp.id, date(2026, 4, 5), top_n=20
    )
    # WORK は 1〜10。target=5 を除く 9 候補
    assert len(proposals) == 9
    days = {p.date.day for p in proposals}
    assert days == {1, 2, 3, 4, 6, 7, 8, 9, 10}


@pytest.mark.asyncio
async def test_propose_excludes_leave_request_days(
    client: tuple, schedule_with_assignments
):
    _, session = client
    sch, emp, _ = schedule_with_assignments
    # 4/3 に有給を立てる
    session.add(LeaveRequest(
        employee_id=emp.id, year=2026, month=4, day=3, leave_type="MANDATORY"
    ))
    await session.flush()

    proposals = await propose_compensatory(
        session, sch.id, emp.id, date(2026, 4, 5), top_n=20
    )
    days = {p.date.day for p in proposals}
    assert 3 not in days


@pytest.mark.asyncio
async def test_propose_excludes_special_assignment_weekday(
    client: tuple, schedule_with_assignments
):
    """SpecialAssignmentRule(WEEKDAY) が発火する曜日は除外される。"""
    _, session = client
    sch, emp, pat = schedule_with_assignments
    # 4/2 = 木曜(weekday=3)。木曜 CHIEF を A1 に固定するルール
    session.add(SpecialAssignmentRule(
        department_id=sch.department_id,
        condition_type="WEEKDAY",
        condition_value=3,
        required_role="CHIEF",
        pattern_id=pat.id,
    ))
    await session.flush()

    proposals = await propose_compensatory(
        session, sch.id, emp.id, date(2026, 4, 5), top_n=20
    )
    days = {p.date.day for p in proposals}
    # 4月の木曜: 2, 9 (10 日まで)
    assert 2 not in days
    assert 9 not in days


@pytest.mark.asyncio
async def test_propose_excludes_last_day(client: tuple):
    """LAST_DAY ルールがあれば月末日は WORK 候補から除外される。"""
    _, session = client
    d = Department(name="LAST_DAY テスト")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emp = Employee(
        employee_number=66002, department_id=d.id, name="X",
        role="CHIEF", available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3",
    )
    session.add(emp)
    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False)
    session.add(grp)
    await session.flush()
    pat = WorkPattern(
        group_id=grp.id, pattern_name="A1", shift_type=1,
        shift_start="07:00", shift_end="16:00",
    )
    session.add(pat)
    await session.flush()

    sch = ShiftSchedule(
        department_id=d.id, year=2026, month=4,
        status="GENERATED", generation_attempt=1, is_active=True,
    )
    session.add(sch)
    await session.flush()

    # 4/29, 4/30 を WORK にする
    for day in (29, 30):
        session.add(ShiftAssignment(
            schedule_id=sch.id, employee_id=emp.id,
            date=date(2026, 4, day),
            assignment_type="WORK", pattern_id=pat.id,
        ))

    session.add(SpecialAssignmentRule(
        department_id=d.id, condition_type="LAST_DAY", condition_value=0,
        required_role="CHIEF", pattern_id=pat.id,
    ))
    await session.flush()

    proposals = await propose_compensatory(
        session, sch.id, emp.id, date(2026, 4, 29), top_n=20
    )
    days = {p.date.day for p in proposals}
    assert 30 not in days


@pytest.mark.asyncio
async def test_propose_top_n_limits_results(client: tuple, schedule_with_assignments):
    _, session = client
    sch, emp, _ = schedule_with_assignments
    proposals = await propose_compensatory(
        session, sch.id, emp.id, date(2026, 4, 5), top_n=3
    )
    assert len(proposals) == 3


@pytest.mark.asyncio
async def test_propose_unknown_schedule_returns_empty(client: tuple):
    _, session = client
    proposals = await propose_compensatory(
        session, schedule_id=999999, employee_id=1,
        target_date=date(2026, 4, 1), top_n=3,
    )
    assert proposals == []
