"""employee_import_service のユニットテスト。

issue #193 で `consecutive_workable` 空セルが silent False になる挙動を
明示エラー化したため、その新仕様の回帰テストを置く。
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.department import Department
from app.models.employee import Employee
from app.services.employee_import_service import import_employees_csv


@pytest_asyncio.fixture
async def dept(client: tuple) -> Department:
    _, session = client
    d = Department(name="empインポート部門")
    session.add(d)
    await session.flush()
    await session.commit()
    return d


@pytest.mark.asyncio
async def test_valid_csv_imports_employees(client: tuple, dept: Department) -> None:
    _, session = client
    csv = (
        "employee_number,name,role,available_days,available_shift_types,consecutive_workable\n"
        "100,山田,CHIEF,0123456,12,1\n"
        "101,鈴木,STAFF,01234,123,0\n"
    )
    result = await import_employees_csv(
        session, department_id=dept.id, csv_bytes=csv.encode("utf-8")
    )
    assert result["created"] == 2
    assert result["errors"] == []
    rows = (
        await session.execute(select(Employee).where(Employee.department_id == dept.id))
    ).scalars().all()
    by_num = {e.employee_number: e for e in rows}
    assert by_num[100].consecutive_workable is True
    assert by_num[101].consecutive_workable is False


@pytest.mark.asyncio
async def test_empty_consecutive_workable_cell_is_rejected(
    client: tuple, dept: Department
) -> None:
    """issue #193: 空セルは silent False ではなく row error にする。"""
    _, session = client
    csv = (
        "employee_number,name,role,available_days,available_shift_types,consecutive_workable\n"
        "200,佐藤,CHIEF,0123456,12,\n"
    )
    result = await import_employees_csv(
        session, department_id=dept.id, csv_bytes=csv.encode("utf-8")
    )
    assert result["created"] == 0
    assert len(result["errors"]) == 1
    assert "consecutive_workable" in result["errors"][0]
    assert "空" in result["errors"][0]


@pytest.mark.asyncio
async def test_invalid_consecutive_workable_cell_is_rejected(
    client: tuple, dept: Department
) -> None:
    _, session = client
    csv = (
        "employee_number,name,role,available_days,available_shift_types,consecutive_workable\n"
        "201,田中,STAFF,012345,12,maybe\n"
    )
    result = await import_employees_csv(
        session, department_id=dept.id, csv_bytes=csv.encode("utf-8")
    )
    assert result["created"] == 0
    assert len(result["errors"]) == 1
    assert "consecutive_workable" in result["errors"][0]


@pytest.mark.asyncio
async def test_empty_cell_does_not_silently_disable_existing_h15(
    client: tuple, dept: Department
) -> None:
    """既存従業員 (consecutive_workable=True) を空セル CSV で update しても
    True のまま保持され、サイレントに False に flip しないことを保証する。"""
    _, session = client
    session.add(
        Employee(
            employee_number=300,
            department_id=dept.id,
            name="既存",
            role="CHIEF",
            available_days="0,1,2,3,4,5,6",
            available_shift_types="1,2",
            consecutive_workable=True,
            sort_order=0,
        )
    )
    await session.flush()
    await session.commit()

    csv = (
        "employee_number,name,role,available_days,available_shift_types,consecutive_workable\n"
        "300,既存,CHIEF,0123456,12,\n"
    )
    result = await import_employees_csv(
        session, department_id=dept.id, csv_bytes=csv.encode("utf-8")
    )
    assert result["updated"] == 0  # 行 reject されたので update せず
    assert len(result["errors"]) == 1

    refreshed = (
        await session.execute(
            select(Employee).where(Employee.employee_number == 300)
        )
    ).scalar_one()
    assert refreshed.consecutive_workable is True, (
        "空セル import で consecutive_workable が silent False に上書きされてはならない"
    )
