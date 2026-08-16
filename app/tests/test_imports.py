"""
imports エンドポイントのテスト。
"""
from __future__ import annotations

import io

import pytest
import pytest_asyncio

from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee


@pytest_asyncio.fixture
async def dept_with_employees(client: tuple) -> tuple[Department, list[Employee]]:
    _, session = client
    d = Department(name="インポートテスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))

    emps = [
        Employee(
            employee_number=88001,
            department_id=d.id,
            name="田中一郎",
            role="STAFF",
            available_days="0,1,2,3,4,5,6",
            available_shift_types="1,2,3",
        ),
        Employee(
            employee_number=88002,
            department_id=d.id,
            name="鈴木花子",
            role="STAFF",
            available_days="0,1,2,3,4,5,6",
            available_shift_types="1,2,3",
        ),
    ]
    for e in emps:
        session.add(e)
    await session.flush()
    return d, emps


def _make_csv(rows: list[str]) -> bytes:
    header = "従業員番号,日付,休日区分"
    content = "\n".join([header] + rows)
    return content.encode("utf-8-sig")


@pytest.mark.asyncio
async def test_import_roster_success(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    d, emps = dept_with_employees
    http, _ = client

    csv_content = _make_csv([
        "88001,2026/5/1,1",
        "88001,2026/5/2,3",
        "88002,2026/5/10,1",
    ])

    resp = await http.post(
        "/api/v1/imports/roster",
        headers=auth_headers,
        files={"file": ("roster.csv", io.BytesIO(csv_content), "text/csv")},
        data={"department_id": d.id, "year": 2026, "month": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] == 3
    assert data["skipped"] == 0


@pytest.mark.asyncio
async def test_import_roster_unknown_employee_skipped(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    d, _ = dept_with_employees
    http, _ = client

    csv_content = _make_csv([
        "99999,2026/5/1,1",   # 存在しない社員番号
        "88001,2026/5/3,1",
    ])

    resp = await http.post(
        "/api/v1/imports/roster",
        headers=auth_headers,
        files={"file": ("roster.csv", io.BytesIO(csv_content), "text/csv")},
        data={"department_id": d.id, "year": 2026, "month": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_import_requires_auth(client: tuple, dept_with_employees: tuple):
    d, _ = dept_with_employees
    http, _ = client
    csv_content = _make_csv(["88001,2026/5/1,1"])
    resp = await http.post(
        "/api/v1/imports/roster",
        files={"file": ("roster.csv", io.BytesIO(csv_content), "text/csv")},
        data={"department_id": d.id, "year": 2026, "month": 5},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_import_non_csv_rejected(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    d, _ = dept_with_employees
    http, _ = client
    resp = await http.post(
        "/api/v1/imports/roster",
        headers=auth_headers,
        files={"file": ("data.xlsx", b"not a csv", "application/octet-stream")},
        data={"department_id": d.id, "year": 2026, "month": 5},
    )
    assert resp.status_code == 400


# ------------------------------------------------------------------ #
# employees.csv の display_order 列対応
# ------------------------------------------------------------------ #


def _emp_csv(rows: list[str], with_display_order: bool) -> bytes:
    if with_display_order:
        header = (
            "employee_number,name,role,available_days,available_shift_types,"
            "consecutive_workable,display_order"
        )
    else:
        header = (
            "employee_number,name,role,available_days,available_shift_types,"
            "consecutive_workable"
        )
    return ("\n".join([header] + rows)).encode("utf-8-sig")


@pytest.mark.asyncio
async def test_import_employees_without_display_order(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    """display_order 列が無い旧 CSV でもエラーなく取り込め、
    新規行は既存最大 sort_order の続きから採番される。"""
    d, _ = dept_with_employees
    http, session = client

    # 既存 2 名に 0,1 を振る (fixture は sort_order を渡していないので 0 のまま)
    from sqlalchemy import select

    existing = (
        await session.execute(
            select(Employee).where(Employee.department_id == d.id).order_by(Employee.id)
        )
    ).scalars().all()
    for i, e in enumerate(existing):
        e.sort_order = i
    await session.commit()

    csv_bytes = _emp_csv(
        [
            "88003,佐藤花,STAFF,0123456,123,1",
            "88004,高橋健,STAFF,0123456,123,1",
        ],
        with_display_order=False,
    )

    resp = await http.post(
        "/api/v1/imports/employees",
        headers=auth_headers,
        files={"file": ("employees.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 2
    assert body["errors"] == []

    # 新規 2 名は sort_order=2,3 になる
    rows = (
        await session.execute(
            select(Employee.employee_number, Employee.sort_order).where(
                Employee.employee_number.in_([88003, 88004])
            )
        )
    ).all()
    so_map = {r[0]: r[1] for r in rows}
    assert so_map[88003] == 2
    assert so_map[88004] == 3


@pytest.mark.asyncio
async def test_import_employees_with_display_order(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    """display_order 列があれば値が sort_order に反映される。"""
    d, _ = dept_with_employees
    http, session = client
    csv_bytes = _emp_csv(
        [
            "88003,佐藤花,STAFF,0123456,123,1,5",
            "88001,田中一郎,STAFF,0123456,123,1,2",
        ],
        with_display_order=True,
    )

    resp = await http.post(
        "/api/v1/imports/employees",
        headers=auth_headers,
        files={"file": ("employees.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200, resp.text

    from sqlalchemy import select

    rows = (
        await session.execute(
            select(Employee.employee_number, Employee.sort_order).where(
                Employee.employee_number.in_([88001, 88003])
            )
        )
    ).all()
    so_map = {r[0]: r[1] for r in rows}
    assert so_map[88003] == 5
    assert so_map[88001] == 2


@pytest.mark.asyncio
async def test_import_employees_display_order_duplicate_warns(
    client: tuple,
    auth_headers: dict,
    dept_with_employees: tuple,
):
    """display_order に重複があれば errors に警告メッセージが入る (取り込み自体は成功)。"""
    d, _ = dept_with_employees
    http, _ = client
    csv_bytes = _emp_csv(
        [
            "88003,佐藤花,STAFF,0123456,123,1,1",
            "88004,高橋健,STAFF,0123456,123,1,1",
        ],
        with_display_order=True,
    )
    resp = await http.post(
        "/api/v1/imports/employees",
        headers=auth_headers,
        files={"file": ("employees.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert any("display_order=1" in e and "重複" in e for e in body["errors"])


# ------------------------------------------------------------------ #
# day_templates.csv インポートエンドポイント
# ------------------------------------------------------------------ #


@pytest_asyncio.fixture
async def dept_with_pattern(client: tuple) -> tuple[Department, int]:
    """部門 + 1 つのパターンを用意する fixture。"""
    from app.models.work_pattern import WorkPattern, WorkPatternGroup

    _, session = client
    d = Department(name="DTテスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False, sort_order=0)
    session.add(grp)
    await session.flush()
    pat = WorkPattern(
        group_id=grp.id,
        pattern_name="A1",
        shift_type=1,
        shift_start="07:00",
        shift_end="15:30",
        sort_order=0,
    )
    session.add(pat)
    await session.flush()
    return d, pat.id


@pytest.mark.asyncio
async def test_import_day_templates_success(
    client: tuple,
    auth_headers: dict,
    dept_with_pattern: tuple,
):
    """正常な day_templates.csv が取り込め、created カウンタが進む。"""
    d, _pid = dept_with_pattern
    http, _ = client
    csv_bytes = b"weekday,pattern_name,required_min\n-1,A1,1\n3,A1,2\n"

    resp = await http.post(
        "/api/v1/imports/day-templates",
        headers=auth_headers,
        files={"file": ("day_templates.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 2
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_import_day_templates_missing_columns_returns_422(
    client: tuple,
    auth_headers: dict,
    dept_with_pattern: tuple,
):
    """必須列が無いと 422 を返す。"""
    d, _ = dept_with_pattern
    http, _ = client
    csv_bytes = b"weekday\n0\n"

    resp = await http.post(
        "/api/v1/imports/day-templates",
        headers=auth_headers,
        files={"file": ("day_templates.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------ #
# choice_groups.csv インポートエンドポイント
# ------------------------------------------------------------------ #


@pytest_asyncio.fixture
async def dept_with_patterns_for_cg(client: tuple) -> tuple[Department, dict[str, int]]:
    """部門 + 4 パターン (A1, A2, B1, B2)。choice-groups インポート用 fixture。"""
    from app.models.work_pattern import WorkPattern, WorkPatternGroup

    _, session = client
    d = Department(name="CG-imp部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False, sort_order=0)
    session.add(grp)
    await session.flush()
    name_to_id: dict[str, int] = {}
    for i, name in enumerate(["A1", "A2", "B1", "B2"]):
        p = WorkPattern(
            group_id=grp.id,
            pattern_name=name,
            shift_type=1,
            shift_start="07:00",
            shift_end="15:30",
            sort_order=i,
        )
        session.add(p)
        await session.flush()
        name_to_id[name] = p.id
    await session.commit()
    return d, name_to_id


@pytest.mark.asyncio
async def test_import_choice_groups_success(
    client: tuple,
    auth_headers: dict,
    dept_with_patterns_for_cg: tuple,
):
    """正常な choice_groups.csv が取り込め、created カウンタが進む。"""
    d, _ = dept_with_patterns_for_cg
    http, _ = client
    csv_bytes = b"pattern_names,min_count,max_count\nA1;A2,1,1\nB1;B2,0,2\n"

    resp = await http.post(
        "/api/v1/imports/choice-groups",
        headers=auth_headers,
        files={"file": ("choice_groups.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 2
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_import_choice_groups_missing_columns_returns_422(
    client: tuple,
    auth_headers: dict,
    dept_with_patterns_for_cg: tuple,
):
    """必須列が無いと 422 を返す。"""
    d, _ = dept_with_patterns_for_cg
    http, _ = client
    csv_bytes = b"pattern_names\nA1;A2\n"

    resp = await http.post(
        "/api/v1/imports/choice-groups",
        headers=auth_headers,
        files={"file": ("choice_groups.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 422


@pytest_asyncio.fixture
async def dept_with_groups_for_pt(client: tuple) -> tuple[Department, dict[str, int]]:
    """部門 + 4 グループ (A, B, C(aux), D, E)。pattern_triggers インポート用 fixture。"""
    from app.models.work_pattern import WorkPatternGroup

    _, session = client
    d = Department(name="PT-imp部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    name_to_id: dict[str, int] = {}
    specs = [("A", False), ("B", False), ("C", True), ("D", False), ("E", False)]
    for i, (name, aux) in enumerate(specs):
        g = WorkPatternGroup(
            department_id=d.id, name=name, is_auxiliary=aux, sort_order=i
        )
        session.add(g)
        await session.flush()
        name_to_id[name] = g.id
    await session.commit()
    return d, name_to_id


@pytest.mark.asyncio
async def test_import_pattern_triggers_success(
    client: tuple,
    auth_headers: dict,
    dept_with_groups_for_pt: tuple,
):
    """正常な pattern_triggers.csv が取り込め、created カウンタが進む。"""
    d, _ = dept_with_groups_for_pt
    http, _ = client
    csv_bytes = b"auxiliary_group_name,required_group_names\nC,B;D;E\n"

    resp = await http.post(
        "/api/v1/imports/pattern-triggers",
        headers=auth_headers,
        files={"file": ("pattern_triggers.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 1
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_import_pattern_triggers_missing_columns_returns_422(
    client: tuple,
    auth_headers: dict,
    dept_with_groups_for_pt: tuple,
):
    """必須列が無いと 422 を返す。"""
    d, _ = dept_with_groups_for_pt
    http, _ = client
    csv_bytes = b"auxiliary_group_name\nC\n"

    resp = await http.post(
        "/api/v1/imports/pattern-triggers",
        headers=auth_headers,
        files={"file": ("pattern_triggers.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"department_id": d.id},
    )
    assert resp.status_code == 422
