"""
employee_priority_import_service のテスト。
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee, EmployeePatternPriority
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.services.employee_priority_import_service import (
    import_employee_priorities_csv,
)


@pytest_asyncio.fixture
async def dept_with_emp_patterns(client: tuple) -> tuple[Department, Employee, list[WorkPattern]]:
    _, session = client
    d = Department(name="優先度インポート部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emp = Employee(
        employee_number=55001, department_id=d.id, name="A",
        role="STAFF", available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3",
    )
    session.add(emp)

    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False)
    session.add(grp)
    await session.flush()
    p1 = WorkPattern(group_id=grp.id, pattern_name="A1", shift_type=1,
                     shift_start="07:00", shift_end="16:00")
    p2 = WorkPattern(group_id=grp.id, pattern_name="A2", shift_type=2,
                     shift_start="09:00", shift_end="18:00")
    session.add_all([p1, p2])
    await session.flush()
    return d, emp, [p1, p2]


def _csv(rows: list[str]) -> bytes:
    header = "employee_id,pattern_name,priority"
    return ("\n".join([header] + rows)).encode("utf-8-sig")


@pytest.mark.asyncio
async def test_import_creates(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, emp, _ = dept_with_emp_patterns
    csv_bytes = _csv(["55001,A1,8", "55001,A2,5"])
    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=csv_bytes
    )
    assert result["created"] == 2
    assert result["updated"] == 0
    assert result["errors"] == []
    rows = (await session.execute(select(EmployeePatternPriority))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_import_updates_existing(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, emp, pats = dept_with_emp_patterns
    session.add(EmployeePatternPriority(
        employee_id=emp.id, pattern_id=pats[0].id, priority=3
    ))
    await session.flush()

    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["55001,A1,9"])
    )
    assert result["updated"] == 1
    assert result["created"] == 0
    row = (await session.execute(select(EmployeePatternPriority))).scalar_one()
    assert row.priority == 9


@pytest.mark.asyncio
async def test_import_priority_zero_deletes(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, emp, pats = dept_with_emp_patterns
    session.add(EmployeePatternPriority(
        employee_id=emp.id, pattern_id=pats[0].id, priority=5
    ))
    await session.flush()

    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["55001,A1,0"])
    )
    assert result["deleted"] == 1
    rows = (await session.execute(select(EmployeePatternPriority))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_import_skips_unknown_employee(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, _, _ = dept_with_emp_patterns
    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["99999,A1,5"])
    )
    assert result["skipped"] == 1
    assert result["created"] == 0
    assert any("99999" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_import_skips_unknown_pattern(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, _, _ = dept_with_emp_patterns
    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["55001,ZZZ,5"])
    )
    assert result["skipped"] == 1
    assert any("ZZZ" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_import_priority_out_of_range(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, _, _ = dept_with_emp_patterns
    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["55001,A1,15"])
    )
    assert result["skipped"] == 1
    assert result["created"] == 0


@pytest.mark.asyncio
async def test_import_invalid_value(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, _, _ = dept_with_emp_patterns
    result = await import_employee_priorities_csv(
        session, department_id=d.id, csv_bytes=_csv(["abc,A1,5"])
    )
    assert result["skipped"] == 1


@pytest.mark.asyncio
async def test_import_missing_header_raises(client: tuple, dept_with_emp_patterns):
    _, session = client
    d, _, _ = dept_with_emp_patterns
    bad = "employee_id,pattern_name\n55001,A1\n".encode("utf-8-sig")
    with pytest.raises(ValueError, match="必須列"):
        await import_employee_priorities_csv(
            session, department_id=d.id, csv_bytes=bad
        )
