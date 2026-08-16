"""
employee_priorities ルーターのテスト。
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee, EmployeePatternPriority
from app.models.work_pattern import WorkPattern, WorkPatternGroup


@pytest_asyncio.fixture
async def dept_with_emp_pattern(client: tuple) -> tuple[Department, Employee, WorkPattern]:
    _, session = client
    d = Department(name="優先度テスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emp = Employee(
        employee_number=77001,
        department_id=d.id,
        name="優先太郎",
        role="STAFF",
        available_days="0,1,2,3,4,5,6",
        available_shift_types="1,2,3",
    )
    session.add(emp)

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
    return d, emp, pat


@pytest.mark.asyncio
async def test_list_priorities_empty(client: tuple, auth_headers: dict, dept_with_emp_pattern):
    d, _, _ = dept_with_emp_pattern
    http, _s = client
    resp = await http.get(
        "/api/v1/employee-priorities",
        params={"department_id": d.id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_priority(client: tuple, auth_headers: dict, dept_with_emp_pattern):
    _d, emp, pat = dept_with_emp_pattern
    http, _s = client
    resp = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": emp.id, "pattern_id": pat.id, "priority": 8},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["priority"] == 8
    assert body["employee_id"] == emp.id


@pytest.mark.asyncio
async def test_create_priority_zero_rejected(
    client: tuple, auth_headers: dict, dept_with_emp_pattern
):
    _d, emp, pat = dept_with_emp_pattern
    http, _s = client
    resp = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": emp.id, "pattern_id": pat.id, "priority": 0},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_priority_duplicate_conflict(
    client: tuple, auth_headers: dict, dept_with_emp_pattern
):
    _d, emp, pat = dept_with_emp_pattern
    http, _s = client
    payload = {"employee_id": emp.id, "pattern_id": pat.id, "priority": 5}
    r1 = await http.post("/api/v1/employee-priorities", headers=auth_headers, json=payload)
    assert r1.status_code == 201
    r2 = await http.post("/api/v1/employee-priorities", headers=auth_headers, json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_create_priority_unknown_employee(
    client: tuple, auth_headers: dict, dept_with_emp_pattern
):
    _d, _emp, pat = dept_with_emp_pattern
    http, _s = client
    resp = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": 99999, "pattern_id": pat.id, "priority": 5},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_priority(client: tuple, auth_headers: dict, dept_with_emp_pattern):
    _d, emp, pat = dept_with_emp_pattern
    http, _s = client
    r1 = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": emp.id, "pattern_id": pat.id, "priority": 5},
    )
    pid = r1.json()["id"]
    r2 = await http.put(
        f"/api/v1/employee-priorities/{pid}",
        headers=auth_headers,
        json={"priority": 9},
    )
    assert r2.status_code == 200
    assert r2.json()["priority"] == 9


@pytest.mark.asyncio
async def test_update_priority_zero_deletes(
    client: tuple, auth_headers: dict, dept_with_emp_pattern
):
    _d, emp, pat = dept_with_emp_pattern
    http, session = client
    r1 = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": emp.id, "pattern_id": pat.id, "priority": 5},
    )
    pid = r1.json()["id"]
    r2 = await http.put(
        f"/api/v1/employee-priorities/{pid}",
        headers=auth_headers,
        json={"priority": 0},
    )
    assert r2.status_code == 204
    remaining = (
        await session.execute(
            select(EmployeePatternPriority).where(EmployeePatternPriority.id == pid)
        )
    ).scalar_one_or_none()
    assert remaining is None


@pytest.mark.asyncio
async def test_delete_priority(client: tuple, auth_headers: dict, dept_with_emp_pattern):
    _d, emp, pat = dept_with_emp_pattern
    http, _s = client
    r1 = await http.post(
        "/api/v1/employee-priorities",
        headers=auth_headers,
        json={"employee_id": emp.id, "pattern_id": pat.id, "priority": 5},
    )
    pid = r1.json()["id"]
    r2 = await http.delete(f"/api/v1/employee-priorities/{pid}", headers=auth_headers)
    assert r2.status_code == 204
    r3 = await http.delete(f"/api/v1/employee-priorities/{pid}", headers=auth_headers)
    assert r3.status_code == 404


@pytest.mark.asyncio
async def test_list_priorities_requires_auth(client: tuple, dept_with_emp_pattern):
    d, _, _ = dept_with_emp_pattern
    http, _s = client
    resp = await http.get(
        "/api/v1/employee-priorities", params={"department_id": d.id}
    )
    assert resp.status_code == 401
