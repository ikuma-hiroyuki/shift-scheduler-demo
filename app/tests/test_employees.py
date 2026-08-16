"""従業員 CRUD エンドポイントのテスト。"""

import pytest


def _emp_body(dept_id: int, **kwargs) -> dict:
    return {
        "employee_number": 999001,
        "department_id": dept_id,
        "name": "テスト太郎",
        "role": "STAFF",
        "available_days": "0,1,2,3,4,5,6",
        "available_shift_types": "1,2,3",
        "consecutive_workable": True,
        **kwargs,
    }


@pytest.mark.asyncio
async def test_list_employees_empty(client, auth_headers, dept):
    """従業員がいない場合は空リストが返る。"""
    http, _ = client
    resp = await http.get("/api/v1/employees", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_employee(client, auth_headers, dept):
    """従業員を作成すると 201 と作成されたデータが返る。"""
    http, _ = client
    body = _emp_body(dept.id)
    resp = await http.post("/api/v1/employees", json=body, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "テスト太郎"
    assert data["role"] == "STAFF"
    assert data["id"] > 0


@pytest.mark.asyncio
async def test_get_employee(client, auth_headers, dept):
    """作成した従業員を ID で取得できる。"""
    http, _ = client
    created = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()
    resp = await http.get(f"/api/v1/employees/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["employee_number"] == 999001


@pytest.mark.asyncio
async def test_list_returns_created_employee(client, auth_headers, dept):
    """作成後、一覧に反映される。"""
    http, _ = client
    await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    resp = await http.get("/api/v1/employees", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_update_employee(client, auth_headers, dept):
    """従業員情報を更新できる。"""
    http, _ = client
    emp_id = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/employees/{emp_id}",
        json={"name": "テスト次郎", "role": "FULLPART"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "テスト次郎"
    assert data["role"] == "FULLPART"


@pytest.mark.asyncio
async def test_delete_employee(client, auth_headers, dept):
    """削除すると 204 が返り、その後 404 になる。"""
    http, _ = client
    emp_id = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()["id"]
    assert (await http.delete(f"/api/v1/employees/{emp_id}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/employees/{emp_id}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_get_nonexistent_employee(client, auth_headers):
    """存在しない ID は 404 が返る。"""
    http, _ = client
    resp = await http.get("/api/v1/employees/999999", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_unknown_role_rejected(client, auth_headers, dept):
    """roles テーブルに存在しない role コードは 400。"""
    http, _ = client
    body = _emp_body(dept.id, role="NOT_A_ROLE")
    resp = await http.post("/api/v1/employees", json=body, headers=auth_headers)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_employee_with_custom_role(client, auth_headers, dept):
    """カスタム追加した役職コードでも従業員を作成できる。"""
    http, _ = client
    create_resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWPART",
            "name": "新人パート",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    body = _emp_body(dept.id, role="NEWPART")
    resp = await http.post("/api/v1/employees", json=body, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["role"] == "NEWPART"


@pytest.mark.asyncio
async def test_update_employee_unknown_role_400(client, auth_headers, dept):
    """update でも roles に存在しない role は 400。"""
    http, _ = client
    emp_id = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/employees/{emp_id}",
        json={"role": "DOES_NOT_EXIST"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_employee_usage_zero(client, auth_headers, dept):
    """関連レコードが無い場合は全て 0 が返る。"""
    http, _ = client
    emp_id = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()["id"]
    resp = await http.get(f"/api/v1/employees/{emp_id}/usage", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {
        "assignment_count": 0,
        "schedule_count": 0,
        "leave_request_count": 0,
    }


@pytest.mark.asyncio
async def test_employee_usage_counts_assignments_and_leaves(
    client, auth_headers, dept,
):
    """稼働表割当と休暇希望が正しくカウントされる。"""
    from datetime import date

    from app.models.leave_request import LeaveRequest
    from app.models.schedule import ShiftAssignment, ShiftSchedule

    http, session = client
    emp_id = (
        await http.post("/api/v1/employees", json=_emp_body(dept.id), headers=auth_headers)
    ).json()["id"]

    sched1 = ShiftSchedule(department_id=dept.id, year=2026, month=4, status="GENERATED")
    sched2 = ShiftSchedule(department_id=dept.id, year=2026, month=5, status="GENERATED")
    session.add_all([sched1, sched2])
    await session.flush()

    session.add_all([
        ShiftAssignment(schedule_id=sched1.id, employee_id=emp_id, date=date(2026, 4, 1), assignment_type="REST"),
        ShiftAssignment(schedule_id=sched1.id, employee_id=emp_id, date=date(2026, 4, 2), assignment_type="REST"),
        ShiftAssignment(schedule_id=sched2.id, employee_id=emp_id, date=date(2026, 5, 1), assignment_type="REST"),
        LeaveRequest(employee_id=emp_id, year=2026, month=4, day=10, leave_type="REQUESTED"),
    ])
    await session.flush()

    resp = await http.get(f"/api/v1/employees/{emp_id}/usage", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignment_count"] == 3
    assert body["schedule_count"] == 2
    assert body["leave_request_count"] == 1


@pytest.mark.asyncio
async def test_employee_usage_404(client, auth_headers):
    """存在しない従業員は 404。"""
    http, _ = client
    resp = await http.get("/api/v1/employees/999999/usage", headers=auth_headers)
    assert resp.status_code == 404


# ------------------------------------------------------------------ #
# 並び替え API
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_create_employee_assigns_sort_order(client, auth_headers, dept):
    """連続作成時、sort_order が 0 から連番採番される。"""
    http, _ = client
    e1 = (
        await http.post(
            "/api/v1/employees",
            json=_emp_body(dept.id, employee_number=100001),
            headers=auth_headers,
        )
    ).json()
    e2 = (
        await http.post(
            "/api/v1/employees",
            json=_emp_body(dept.id, employee_number=100002),
            headers=auth_headers,
        )
    ).json()
    e3 = (
        await http.post(
            "/api/v1/employees",
            json=_emp_body(dept.id, employee_number=100003),
            headers=auth_headers,
        )
    ).json()
    assert e1["sort_order"] == 0
    assert e2["sort_order"] == 1
    assert e3["sort_order"] == 2


@pytest.mark.asyncio
async def test_reorder_employees_basic(client, auth_headers, dept):
    """ID 配列を逆順にして PUT すると一覧の並びが反転する。"""
    http, _ = client
    ids = []
    for n in (100001, 100002, 100003):
        ids.append(
            (
                await http.post(
                    "/api/v1/employees",
                    json=_emp_body(dept.id, employee_number=n, name=f"emp{n}"),
                    headers=auth_headers,
                )
            ).json()["id"]
        )

    resp = await http.put(
        "/api/v1/employees/reorder",
        json={"department_id": dept.id, "ids": list(reversed(ids))},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    returned_ids = [e["id"] for e in resp.json()]
    assert returned_ids == list(reversed(ids))

    listed = (await http.get("/api/v1/employees", headers=auth_headers)).json()
    assert [e["id"] for e in listed] == list(reversed(ids))
    assert [e["sort_order"] for e in listed] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_employees_id_mismatch(client, auth_headers, dept):
    """部門外/存在しない ID を含めると 400。"""
    http, _ = client
    e1 = (
        await http.post(
            "/api/v1/employees",
            json=_emp_body(dept.id, employee_number=100001),
            headers=auth_headers,
        )
    ).json()
    resp = await http.put(
        "/api/v1/employees/reorder",
        json={"department_id": dept.id, "ids": [e1["id"], 99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_employees_duplicate(client, auth_headers, dept):
    """ids に重複があると 400。"""
    http, _ = client
    e1 = (
        await http.post(
            "/api/v1/employees",
            json=_emp_body(dept.id, employee_number=100001),
            headers=auth_headers,
        )
    ).json()
    resp = await http.put(
        "/api/v1/employees/reorder",
        json={"department_id": dept.id, "ids": [e1["id"], e1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


# ------------------------------------------------------------------ #
# 役職→社員番号順 並び替え API (issue #173)
# ------------------------------------------------------------------ #


async def _create_emp(http, auth_headers, dept_id, *, number, role, name=None):
    body = _emp_body(
        dept_id,
        employee_number=number,
        role=role,
        name=name or f"emp{number}",
    )
    resp = await http.post("/api/v1/employees", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_sort_by_role_orders_by_default_role_priority(
    client, auth_headers, dept,
):
    """sort-by-role でデフォルト役職並び順 (CHIEF→...→MORNINGPART) が反映される。"""
    http, _ = client
    e_staff = await _create_emp(http, auth_headers, dept.id, number=100002, role="STAFF")
    e_chief = await _create_emp(http, auth_headers, dept.id, number=100001, role="CHIEF")
    e_morning = await _create_emp(http, auth_headers, dept.id, number=100003, role="MORNINGPART")

    resp = await http.post(
        "/api/v1/employees/sort-by-role",
        json={"department_id": dept.id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    listed = (await http.get("/api/v1/employees", headers=auth_headers)).json()
    assert [e["id"] for e in listed] == [e_chief["id"], e_staff["id"], e_morning["id"]]
    assert [e["sort_order"] for e in listed] == [0, 1, 2]


@pytest.mark.asyncio
async def test_sort_by_role_within_role_by_employee_number(
    client, auth_headers, dept,
):
    """同役職内では employee_number 昇順。"""
    http, _ = client
    a = await _create_emp(http, auth_headers, dept.id, number=200003, role="STAFF")
    b = await _create_emp(http, auth_headers, dept.id, number=200001, role="STAFF")
    c = await _create_emp(http, auth_headers, dept.id, number=200002, role="STAFF")

    await http.post(
        "/api/v1/employees/sort-by-role",
        json={"department_id": dept.id},
        headers=auth_headers,
    )
    listed = (await http.get("/api/v1/employees", headers=auth_headers)).json()
    assert [e["id"] for e in listed] == [b["id"], c["id"], a["id"]]


@pytest.mark.asyncio
async def test_sort_by_role_respects_custom_role_order(
    client, auth_headers, dept,
):
    """roles の order_index を変えると sort-by-role の結果も追従する。"""
    http, _ = client
    e_chief = await _create_emp(http, auth_headers, dept.id, number=300001, role="CHIEF")
    e_staff = await _create_emp(http, auth_headers, dept.id, number=300002, role="STAFF")

    # STAFF を CHIEF より前に
    await http.put(
        "/api/v1/roles/reorder",
        json={"codes": ["STAFF", "CHIEF", "DEPUTY", "FULLPART", "MORNINGPART"]},
        headers=auth_headers,
    )
    await http.post(
        "/api/v1/employees/sort-by-role",
        json={"department_id": dept.id},
        headers=auth_headers,
    )
    listed = (await http.get("/api/v1/employees", headers=auth_headers)).json()
    assert [e["id"] for e in listed] == [e_staff["id"], e_chief["id"]]


@pytest.mark.asyncio
async def test_sort_by_role_does_not_affect_other_department(
    client, auth_headers, dept,
):
    """sort-by-role は対象部門の sort_order だけを変更する。"""
    from app.models.department import Department, WorkRuleConfig

    http, session = client
    other = Department(name="他部門")
    session.add(other)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other.id))
    await session.flush()

    own = await _create_emp(http, auth_headers, dept.id, number=400001, role="STAFF")
    other_emp = await _create_emp(http, auth_headers, other.id, number=400002, role="CHIEF")

    # 他部門の sort_order を 9 に手動で書き換え（並び替えで上書きされないことを確認するため）
    from sqlalchemy import update as sa_update
    from app.models.employee import Employee
    await session.execute(
        sa_update(Employee).where(Employee.id == other_emp["id"]).values(sort_order=9)
    )
    await session.flush()

    await http.post(
        "/api/v1/employees/sort-by-role",
        json={"department_id": dept.id},
        headers=auth_headers,
    )

    listed = (await http.get("/api/v1/employees", headers=auth_headers)).json()
    by_id = {e["id"]: e for e in listed}
    assert by_id[own["id"]]["sort_order"] == 0
    assert by_id[other_emp["id"]]["sort_order"] == 9
