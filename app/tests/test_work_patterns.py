"""作業パターングループ・作業パターン CRUD のテスト。"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


@pytest.mark.asyncio
async def test_create_pattern_group(client, auth_headers, dept):
    """作業パターングループを作成できる。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "A"
    assert data["is_auxiliary"] is False
    assert data["sort_order"] == 0
    # color 省略時は default (#dcfce7)
    assert data["color"] == "#dcfce7"


@pytest.mark.asyncio
async def test_create_pattern_group_with_custom_color(client, auth_headers, dept):
    """color を明示すると保存される。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/work-pattern-groups",
        json={
            "department_id": dept.id,
            "name": "A",
            "is_auxiliary": False,
            "color": "#ff8800",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["color"] == "#ff8800"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_color", ["red", "#GGGGGG", "#fff", "#1234567"])
async def test_create_pattern_group_rejects_invalid_color(
    client, auth_headers, dept, bad_color
):
    """`#RRGGBB` 形式以外は 422。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/work-pattern-groups",
        json={
            "department_id": dept.id,
            "name": "A",
            "is_auxiliary": False,
            "color": bad_color,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_pattern_group_normalizes_uppercase_hex(
    client, auth_headers, dept
):
    """大文字 hex (`#ABC123`) は lowercase (`#abc123`) で保存される。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/work-pattern-groups",
        json={
            "department_id": dept.id,
            "name": "A",
            "is_auxiliary": False,
            "color": "#ABC123",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["color"] == "#abc123"


@pytest.mark.asyncio
async def test_update_pattern_group_normalizes_uppercase_hex(
    client, auth_headers, dept
):
    """PUT で大文字 hex を送っても lowercase で保存される。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/work-pattern-groups/{gid}",
        json={"color": "#FFAA88"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["color"] == "#ffaa88"


@pytest.mark.asyncio
async def test_db_check_constraint_rejects_invalid_hex_via_raw_sql(
    client, auth_headers, dept
):
    """Pydantic を経由しない直接 INSERT でも DB CHECK 制約で reject される。

    Pydantic を緩めても DB 側 CHECK が defense-in-depth として効くことを確認。
    """
    _, db = client
    # `#GGGGGG` は 7 文字で String(7) を満たしつつ CHECK 違反 (regex に G 不一致)
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "INSERT INTO work_pattern_groups "
                "(department_id, name, sort_order, is_auxiliary, color) "
                "VALUES (:dept, :name, 0, false, :bad)"
            ),
            {"dept": dept.id, "name": "ZZZ", "bad": "#GGGGGG"},
        )
        await db.flush()


@pytest.mark.asyncio
async def test_update_pattern_group_color_only(client, auth_headers, dept):
    """color のみを送ると name は不変、color のみ更新される。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/work-pattern-groups/{gid}",
        json={"color": "#abc123"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "A"
    assert body["color"] == "#abc123"


@pytest.mark.asyncio
async def test_list_pattern_groups(client, auth_headers, dept):
    """作成後、一覧に反映される。"""
    http, _ = client
    await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    resp = await http.get("/api/v1/work-pattern-groups", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_update_pattern_group(client, auth_headers, dept):
    """グループ名を更新できる。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/work-pattern-groups/{gid}",
        json={"name": "B"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "B"


@pytest.mark.asyncio
async def test_delete_pattern_group(client, auth_headers, dept):
    """削除すると 204、その後 404。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/work-pattern-groups/{gid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/work-pattern-groups/{gid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_create_work_pattern(client, auth_headers, dept):
    """作業パターンを作成できる。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.post(
        "/api/v1/work-patterns",
        json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
              "shift_start": "07:00", "shift_end": "15:30"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["pattern_name"] == "A1"
    assert data["shift_type"] == 1
    assert data["sort_order"] == 0


@pytest.mark.asyncio
async def test_update_work_pattern(client, auth_headers, dept):
    """作業パターンの時間帯を更新できる。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    pid = (
        await http.post(
            "/api/v1/work-patterns",
            json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
                  "shift_start": "07:00", "shift_end": "15:30"},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/work-patterns/{pid}",
        json={"shift_end": "16:00"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["shift_end"] == "16:00"


@pytest.mark.asyncio
async def test_delete_work_pattern(client, auth_headers, dept):
    """作業パターン削除後は 404。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    pid = (
        await http.post(
            "/api/v1/work-patterns",
            json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
                  "shift_start": "07:00", "shift_end": "15:30"},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/work-patterns/{pid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/work-patterns/{pid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_list_pattern_groups_filtered_by_department(
    client, auth_headers, dept
):
    """department_id クエリで対象部門のグループだけ返る。"""
    http, session = client
    from app.models.department import Department, WorkRuleConfig

    other = Department(name="別部門")
    session.add(other)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other.id))
    await session.flush()

    await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": other.id, "name": "X", "is_auxiliary": False},
        headers=auth_headers,
    )

    resp = await http.get(
        "/api/v1/work-pattern-groups",
        params={"department_id": dept.id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    names = [g["name"] for g in resp.json()]
    assert names == ["A"]


@pytest.mark.asyncio
async def test_delete_group_cascades_patterns(client, auth_headers, dept):
    """グループを削除すると配下の作業パターンも削除される。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    pid = (
        await http.post(
            "/api/v1/work-patterns",
            json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
                  "shift_start": "07:00", "shift_end": "15:30"},
            headers=auth_headers,
        )
    ).json()["id"]

    assert (
        await http.delete(f"/api/v1/work-pattern-groups/{gid}", headers=auth_headers)
    ).status_code == 204
    assert (
        await http.get(f"/api/v1/work-patterns/{pid}", headers=auth_headers)
    ).status_code == 404


@pytest.mark.asyncio
async def test_export_patterns_csv(client, auth_headers, dept):
    """CSV エクスポートが BOM 付き UTF-8 で patterns.csv 形式を返す。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    await http.post(
        "/api/v1/work-patterns",
        json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
              "shift_start": "07:00", "shift_end": "15:30"},
        headers=auth_headers,
    )

    resp = await http.get(
        "/api/v1/work-patterns/export.csv",
        params={"department_id": dept.id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]

    body = resp.content
    assert body.startswith(b"\xef\xbb\xbf"), "UTF-8 BOM が必要"
    text = body.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0] == (
        "id,group_name,group_order,pattern_name,pattern_order,"
        "shift_type,shift_start,shift_end,is_auxiliary"
    )
    assert len(lines) == 2
    cols = lines[1].split(",")
    assert cols[1] == "A"
    assert cols[2] == "0"  # group_order
    assert cols[3] == "A1"
    assert cols[4] == "0"  # pattern_order
    assert cols[5] == "1"
    assert cols[6] == "07:00"
    assert cols[7] == "15:30"
    assert cols[8] == "0"


@pytest.mark.asyncio
async def test_export_patterns_csv_aux_flag(client, auth_headers, dept):
    """補助グループは is_auxiliary=1 で出力される。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "C", "is_auxiliary": True},
            headers=auth_headers,
        )
    ).json()["id"]
    await http.post(
        "/api/v1/work-patterns",
        json={"group_id": gid, "pattern_name": "C1", "shift_type": 2,
              "shift_start": "09:00", "shift_end": "18:00"},
        headers=auth_headers,
    )
    resp = await http.get(
        "/api/v1/work-patterns/export.csv",
        params={"department_id": dept.id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    line = resp.content.decode("utf-8-sig").strip().splitlines()[1]
    assert line.split(",")[8] == "1"


@pytest.mark.asyncio
async def test_invalid_shift_type_rejected(client, auth_headers, dept):
    """shift_type が 1-3 以外は 422。"""
    http, _ = client
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.post(
        "/api/v1/work-patterns",
        json={"group_id": gid, "pattern_name": "X", "shift_type": 9,
              "shift_start": "07:00", "shift_end": "15:30"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------ #
# 並び替え API
# ------------------------------------------------------------------ #


async def _create_group(http, auth_headers, dept_id, name):
    return (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept_id, "name": name, "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()


async def _create_pattern(http, auth_headers, gid, name):
    return (
        await http.post(
            "/api/v1/work-patterns",
            json={
                "group_id": gid,
                "pattern_name": name,
                "shift_type": 1,
                "shift_start": "07:00",
                "shift_end": "15:30",
            },
            headers=auth_headers,
        )
    ).json()


@pytest.mark.asyncio
async def test_reorder_groups_basic(client, auth_headers, dept):
    """ID 配列を逆順にして PUT すると sort_order が反転する。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, dept.id, "B")
    g3 = await _create_group(http, auth_headers, dept.id, "C")

    resp = await http.put(
        "/api/v1/work-pattern-groups/reorder",
        json={"department_id": dept.id, "ids": [g3["id"], g2["id"], g1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    names = [g["name"] for g in resp.json()]
    assert names == ["C", "B", "A"]

    listed = (
        await http.get(
            "/api/v1/work-pattern-groups",
            params={"department_id": dept.id},
            headers=auth_headers,
        )
    ).json()
    assert [g["name"] for g in listed] == ["C", "B", "A"]
    assert [g["sort_order"] for g in listed] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_groups_id_mismatch(client, auth_headers, dept):
    """部門外/存在しない ID を含めると 400。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    resp = await http.put(
        "/api/v1/work-pattern-groups/reorder",
        json={"department_id": dept.id, "ids": [g1["id"], 99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_groups_duplicate(client, auth_headers, dept):
    """重複 ID は 400。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    resp = await http.put(
        "/api/v1/work-pattern-groups/reorder",
        json={"department_id": dept.id, "ids": [g1["id"], g1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_patterns_basic(client, auth_headers, dept):
    """グループ内のパターン並び替え。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    p1 = await _create_pattern(http, auth_headers, g["id"], "A1")
    p2 = await _create_pattern(http, auth_headers, g["id"], "A2")

    resp = await http.put(
        "/api/v1/work-patterns/reorder",
        json={"group_id": g["id"], "ids": [p2["id"], p1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert [p["pattern_name"] for p in resp.json()] == ["A2", "A1"]
    assert [p["sort_order"] for p in resp.json()] == [0, 1]


@pytest.mark.asyncio
async def test_reorder_patterns_id_mismatch(client, auth_headers, dept):
    """グループ外の ID は 400。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    p1 = await _create_pattern(http, auth_headers, g["id"], "A1")
    resp = await http.put(
        "/api/v1/work-patterns/reorder",
        json={"group_id": g["id"], "ids": [p1["id"], 99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_group_assigns_sort_order(client, auth_headers, dept):
    """連続作成で sort_order が 0,1,2 と採番される。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, dept.id, "B")
    g3 = await _create_group(http, auth_headers, dept.id, "C")
    assert g1["sort_order"] == 0
    assert g2["sort_order"] == 1
    assert g3["sort_order"] == 2


@pytest.mark.asyncio
async def test_create_pattern_assigns_sort_order(client, auth_headers, dept):
    """連続作成で sort_order が 0,1 と採番される。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    p1 = await _create_pattern(http, auth_headers, g["id"], "A1")
    p2 = await _create_pattern(http, auth_headers, g["id"], "A2")
    assert p1["sort_order"] == 0
    assert p2["sort_order"] == 1


# ------------------------------------------------------------------ #
# 重複名禁止 (部門スコープ UNIQUE)
# ------------------------------------------------------------------ #


async def _make_other_dept(session):
    from app.models.department import Department, WorkRuleConfig
    other = Department(name="別部門")
    session.add(other)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other.id))
    await session.flush()
    return other


@pytest.mark.asyncio
async def test_create_group_rejects_duplicate_name_in_same_department(
    client, auth_headers, dept
):
    """同一部門に同名グループを 2 件作ろうとすると 409。"""
    http, _ = client
    r1 = await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    assert r1.status_code == 201
    r2 = await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    assert r2.status_code == 409
    assert "グループ" in r2.json()["detail"]


@pytest.mark.asyncio
async def test_create_group_allows_same_name_in_different_department(
    client, auth_headers, dept
):
    """別部門なら同名グループ OK。"""
    http, session = client
    other = await _make_other_dept(session)
    r1 = await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": dept.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    r2 = await http.post(
        "/api/v1/work-pattern-groups",
        json={"department_id": other.id, "name": "A", "is_auxiliary": False},
        headers=auth_headers,
    )
    assert r1.status_code == 201
    assert r2.status_code == 201


@pytest.mark.asyncio
async def test_update_group_rejects_duplicate_name(client, auth_headers, dept):
    """既存の別グループ名にリネームしようとすると 409。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, dept.id, "B")
    resp = await http.put(
        f"/api/v1/work-pattern-groups/{g2['id']}",
        json={"name": "A"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert "グループ" in resp.json()["detail"]
    _ = g1


@pytest.mark.asyncio
async def test_update_group_allows_self_name_unchanged(
    client, auth_headers, dept
):
    """自身の名前そのままで PUT は 200。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    resp = await http.put(
        f"/api/v1/work-pattern-groups/{g['id']}",
        json={"name": "A"},
        headers=auth_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_pattern_rejects_duplicate_in_same_group(
    client, auth_headers, dept
):
    """同一グループ内に同名パターンを 2 件作ると 409。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    await _create_pattern(http, auth_headers, g["id"], "A1")
    resp = await http.post(
        "/api/v1/work-patterns",
        json={
            "group_id": g["id"], "pattern_name": "A1", "shift_type": 1,
            "shift_start": "07:00", "shift_end": "15:30",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert "作業パターン" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_pattern_rejects_duplicate_in_same_department_cross_group(
    client, auth_headers, dept
):
    """同一部門・別グループに同名パターンを作ると 409。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, dept.id, "B")
    await _create_pattern(http, auth_headers, g1["id"], "X1")
    resp = await http.post(
        "/api/v1/work-patterns",
        json={
            "group_id": g2["id"], "pattern_name": "X1", "shift_type": 1,
            "shift_start": "07:00", "shift_end": "15:30",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert "作業パターン" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_pattern_allows_same_name_in_different_department(
    client, auth_headers, dept
):
    """別部門なら同名パターン OK。"""
    http, session = client
    other = await _make_other_dept(session)
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, other.id, "A")
    p1 = await _create_pattern(http, auth_headers, g1["id"], "A1")
    r2 = await http.post(
        "/api/v1/work-patterns",
        json={
            "group_id": g2["id"], "pattern_name": "A1", "shift_type": 1,
            "shift_start": "07:00", "shift_end": "15:30",
        },
        headers=auth_headers,
    )
    assert r2.status_code == 201
    _ = p1


@pytest.mark.asyncio
async def test_update_pattern_rejects_duplicate_in_same_department(
    client, auth_headers, dept
):
    """別グループの既存パターン名にリネームすると 409。"""
    http, _ = client
    g1 = await _create_group(http, auth_headers, dept.id, "A")
    g2 = await _create_group(http, auth_headers, dept.id, "B")
    await _create_pattern(http, auth_headers, g1["id"], "A1")
    p2 = await _create_pattern(http, auth_headers, g2["id"], "B1")
    resp = await http.put(
        f"/api/v1/work-patterns/{p2['id']}",
        json={"pattern_name": "A1"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert "作業パターン" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_update_pattern_allows_self_name_unchanged(
    client, auth_headers, dept
):
    """自身の名前そのままで PUT は 200。"""
    http, _ = client
    g = await _create_group(http, auth_headers, dept.id, "A")
    p = await _create_pattern(http, auth_headers, g["id"], "A1")
    resp = await http.put(
        f"/api/v1/work-patterns/{p['id']}",
        json={"pattern_name": "A1"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
