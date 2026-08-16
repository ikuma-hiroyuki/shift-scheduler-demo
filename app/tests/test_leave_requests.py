"""希望休・有給申請 CRUD のテスト。"""

import random

import pytest


async def _make_employee(http, auth_headers, dept_id: int) -> int:
    """テスト用従業員を作成して id を返す。"""
    return (
        await http.post(
            "/api/v1/employees",
            json={
                "employee_number": random.randint(800000, 899999),
                "department_id": dept_id,
                "name": "休暇テスト",
                "role": "STAFF",
                "available_days": "0,1,2,3,4,5,6",
                "available_shift_types": "1,2,3",
                "consecutive_workable": True,
            },
            headers=auth_headers,
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_list_leave_requests_empty(client, auth_headers):
    """申請がない場合は空リストが返る。"""
    http, _ = client
    resp = await http.get("/api/v1/leave-requests", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_leave_request(client, auth_headers, dept):
    """希望休申請を作成できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/leave-requests",
        json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 1,
              "leave_type": "REQUESTED"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["employee_id"] == emp_id
    assert data["year"] == 2026
    assert data["month"] == 5
    assert data["day"] == 1
    assert data["leave_type"] == "REQUESTED"
    assert data["id"] > 0


@pytest.mark.asyncio
async def test_create_mandatory_leave(client, auth_headers, dept):
    """有給（MANDATORY）申請も作成できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/leave-requests",
        json={"employee_id": emp_id, "year": 2026, "month": 6, "day": 15,
              "leave_type": "MANDATORY"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["leave_type"] == "MANDATORY"


@pytest.mark.asyncio
async def test_get_leave_request(client, auth_headers, dept):
    """作成した申請を ID で取得できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    rid = (
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 10,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.get(f"/api/v1/leave-requests/{rid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["day"] == 10


@pytest.mark.asyncio
async def test_list_filter_by_year_month(client, auth_headers, dept):
    """year・month でフィルタできる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    # 5月と6月に1件ずつ登録
    for month, day in [(5, 1), (6, 1)]:
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": month, "day": day,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    resp = await http.get("/api/v1/leave-requests?year=2026&month=5", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["month"] == 5


@pytest.mark.asyncio
async def test_list_filter_by_employee(client, auth_headers, dept):
    """employee_id でフィルタできる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    await http.post(
        "/api/v1/leave-requests",
        json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 3,
              "leave_type": "REQUESTED"},
        headers=auth_headers,
    )
    resp = await http.get(f"/api/v1/leave-requests?employee_id={emp_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert all(item["employee_id"] == emp_id for item in resp.json())


@pytest.mark.asyncio
async def test_update_leave_request(client, auth_headers, dept):
    """leave_type を更新できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    rid = (
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 20,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/leave-requests/{rid}",
        json={"leave_type": "MANDATORY"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["leave_type"] == "MANDATORY"


@pytest.mark.asyncio
async def test_delete_leave_request(client, auth_headers, dept):
    """削除後は 404。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    rid = (
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 25,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/leave-requests/{rid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/leave-requests/{rid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_invalid_leave_type_rejected(client, auth_headers, dept):
    """不正な leave_type は 422。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/leave-requests",
        json={"employee_id": emp_id, "year": 2026, "month": 5, "day": 1,
              "leave_type": "HOLIDAY"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_tentative_leave(client, auth_headers, dept):
    """仮休 (TENTATIVE) 申請を作成できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/leave-requests",
        json={"employee_id": emp_id, "year": 2026, "month": 7, "day": 5,
              "leave_type": "TENTATIVE"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["leave_type"] == "TENTATIVE"


@pytest.mark.asyncio
async def test_update_to_tentative(client, auth_headers, dept):
    """既存申請を TENTATIVE に更新できる。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    rid = (
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 7, "day": 6,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/leave-requests/{rid}",
        json={"leave_type": "TENTATIVE"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["leave_type"] == "TENTATIVE"


@pytest.mark.asyncio
async def test_update_invalid_leave_type_rejected(client, auth_headers, dept):
    """更新時も不正な leave_type は 422。"""
    http, _ = client
    emp_id = await _make_employee(http, auth_headers, dept.id)
    rid = (
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 7, "day": 7,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/leave-requests/{rid}",
        json={"leave_type": "INVALID"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_list_filter_by_department(client, auth_headers, dept):
    """department_id で他部門の申請が除外される。"""
    http, session = client

    # 別部門を追加
    from app.models.department import Department, WorkRuleConfig
    other = Department(name="他部門")
    session.add(other)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other.id))
    await session.flush()

    emp_in = await _make_employee(http, auth_headers, dept.id)
    emp_out = await _make_employee(http, auth_headers, other.id)
    for emp_id in (emp_in, emp_out):
        await http.post(
            "/api/v1/leave-requests",
            json={"employee_id": emp_id, "year": 2026, "month": 8, "day": 1,
                  "leave_type": "REQUESTED"},
            headers=auth_headers,
        )

    resp = await http.get(
        f"/api/v1/leave-requests?department_id={dept.id}&year=2026&month=8",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["employee_id"] == emp_in
