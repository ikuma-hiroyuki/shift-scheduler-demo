"""役職マスタ CRUD エンドポイントのテスト (issue #173)。"""

import pytest


# ------------------------------------------------------------------ #
# GET /api/v1/roles
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_list_roles_returns_default_5(client, auth_headers):
    """デフォルト 5 役職が order_index 順に返る。rest_days_* 3 フィールド付き (issue #235)。"""
    http, _ = client
    resp = await http.get("/api/v1/roles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert [r["code"] for r in data] == [
        "CHIEF", "DEPUTY", "STAFF", "FULLPART", "MORNINGPART",
    ]
    assert [r["order_index"] for r in data] == [0, 1, 2, 3, 4]
    assert data[0]["name"] == "主任"
    # issue #235: rest_days_* default 値
    by_code = {r["code"]: r for r in data}
    assert by_code["CHIEF"]["rest_days_28_29"] == 9
    assert by_code["CHIEF"]["rest_days_30"] == 9
    assert by_code["CHIEF"]["rest_days_31"] == 10
    assert by_code["DEPUTY"]["rest_days_31"] == 10
    assert by_code["STAFF"]["rest_days_31"] == 10
    assert by_code["FULLPART"]["rest_days_28_29"] == 7
    assert by_code["FULLPART"]["rest_days_30"] == 7
    assert by_code["FULLPART"]["rest_days_31"] == 7
    assert by_code["MORNINGPART"]["rest_days_28_29"] == 7
    assert by_code["MORNINGPART"]["rest_days_30"] == 7
    assert by_code["MORNINGPART"]["rest_days_31"] == 7


@pytest.mark.asyncio
async def test_list_roles_requires_auth(client):
    """未認証は 401。"""
    http, _ = client
    resp = await http.get("/api/v1/roles")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_roles_allows_regular_user(client, regular_auth_headers):
    """list は一般ユーザーでも 200（プルダウン表示用）。"""
    http, _ = client
    resp = await http.get("/api/v1/roles", headers=regular_auth_headers)
    assert resp.status_code == 200


# ------------------------------------------------------------------ #
# POST /api/v1/roles
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_create_role_admin_201(client, auth_headers):
    """admin で新規役職追加できる。order_index は末尾に自動採番、rest_days_* も保存される (issue #235)。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWPART",
            "name": "新人パート",
            "rest_days_28_29": 8,
            "rest_days_30": 8,
            "rest_days_31": 9,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["code"] == "NEWPART"
    assert data["name"] == "新人パート"
    assert data["order_index"] == 5  # 既存 5 件の後ろ
    assert data["rest_days_28_29"] == 8
    assert data["rest_days_30"] == 8
    assert data["rest_days_31"] == 9


@pytest.mark.asyncio
async def test_create_role_regular_user_403(client, regular_auth_headers):
    """一般ユーザーは 403。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWPART",
            "name": "新人パート",
            "rest_days_28_29": 8,
            "rest_days_30": 8,
            "rest_days_31": 9,
        },
        headers=regular_auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_role_invalid_code_format_422(client, auth_headers):
    """code は ^[A-Z][A-Z0-9_]{0,19}$ にマッチしないと 422。"""
    http, _ = client
    for bad in ("lowercase", "123START", "WITH SPACE", "TOO_LONG_CODE_OVER_TWENTY_X", ""):
        resp = await http.post(
            "/api/v1/roles",
            json={
                "code": bad,
                "name": "x",
                "rest_days_28_29": 9,
                "rest_days_30": 9,
                "rest_days_31": 10,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422, f"expected 422 for code={bad!r}: {resp.text}"


@pytest.mark.asyncio
async def test_create_role_duplicate_code_409(client, auth_headers):
    """既存 code との重複は 409。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "CHIEF",
            "name": "別の主任",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 409


# ------------------------------------------------------------------ #
# PUT /api/v1/roles/{code}
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_update_role_name(client, auth_headers):
    """name + rest_days_* を更新できる (issue #235: 全フィールド必須)。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/CHIEF",
        json={
            "name": "チーフ",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "チーフ"


@pytest.mark.asyncio
async def test_update_role_404(client, auth_headers):
    """存在しない code は 404。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/NOPE",
        json={
            "name": "x",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_role_regular_user_403(client, regular_auth_headers):
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/CHIEF",
        json={
            "name": "x",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=regular_auth_headers,
    )
    assert resp.status_code == 403


# ------------------------------------------------------------------ #
# DELETE /api/v1/roles/{code}
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_delete_role_no_employees_204(client, auth_headers):
    """従業員ゼロの役職は削除できる。残行の order_index が詰まる。"""
    http, _ = client
    resp = await http.delete("/api/v1/roles/MORNINGPART", headers=auth_headers)
    assert resp.status_code == 204

    listed = (await http.get("/api/v1/roles", headers=auth_headers)).json()
    assert [r["code"] for r in listed] == ["CHIEF", "DEPUTY", "STAFF", "FULLPART"]
    assert [r["order_index"] for r in listed] == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_delete_role_with_employees_409(client, auth_headers, dept):
    """従業員に紐付いた役職の削除は 409。"""
    http, _ = client
    body = {
        "employee_number": 999001,
        "department_id": dept.id,
        "name": "テスト",
        "role": "STAFF",
    }
    await http.post("/api/v1/employees", json=body, headers=auth_headers)
    resp = await http.delete("/api/v1/roles/STAFF", headers=auth_headers)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_role_404(client, auth_headers):
    http, _ = client
    resp = await http.delete("/api/v1/roles/NOPE", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_role_regular_user_403(client, regular_auth_headers):
    http, _ = client
    resp = await http.delete("/api/v1/roles/MORNINGPART", headers=regular_auth_headers)
    assert resp.status_code == 403


# ------------------------------------------------------------------ #
# PUT /api/v1/roles/reorder
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_reorder_roles(client, auth_headers):
    """codes 配列の順に order_index 0..N-1 が再採番される。"""
    http, _ = client
    new_order = ["MORNINGPART", "FULLPART", "STAFF", "DEPUTY", "CHIEF"]
    resp = await http.put(
        "/api/v1/roles/reorder",
        json={"codes": new_order},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [r["code"] for r in data] == new_order
    assert [r["order_index"] for r in data] == [0, 1, 2, 3, 4]


@pytest.mark.asyncio
async def test_reorder_roles_set_mismatch_400(client, auth_headers):
    """既存 code の集合と一致しないと 400。"""
    http, _ = client
    # MORNINGPART を欠く
    resp = await http.put(
        "/api/v1/roles/reorder",
        json={"codes": ["CHIEF", "DEPUTY", "STAFF", "FULLPART"]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_roles_duplicate_400(client, auth_headers):
    """重複は 400。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/reorder",
        json={"codes": ["CHIEF", "CHIEF", "DEPUTY", "STAFF", "FULLPART"]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_roles_unknown_code_400(client, auth_headers):
    """存在しない code を含むと 400。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/reorder",
        json={"codes": ["CHIEF", "DEPUTY", "STAFF", "FULLPART", "NOPE"]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_roles_regular_user_403(client, regular_auth_headers):
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/reorder",
        json={"codes": ["CHIEF", "DEPUTY", "STAFF", "FULLPART", "MORNINGPART"]},
        headers=regular_auth_headers,
    )
    assert resp.status_code == 403


# ------------------------------------------------------------------ #
# issue #235: rest_days_* validation (バケツ別 max, required)
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_create_role_missing_rest_days_28_29_422(client, auth_headers):
    """rest_days_28_29 欠落で 422 (全必須)。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={"code": "NEWROLE", "name": "新規", "rest_days_30": 9, "rest_days_31": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_missing_rest_days_30_422(client, auth_headers):
    """rest_days_30 欠落で 422。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={"code": "NEWROLE", "name": "新規", "rest_days_28_29": 9, "rest_days_31": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_missing_rest_days_31_422(client, auth_headers):
    """rest_days_31 欠落で 422。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={"code": "NEWROLE", "name": "新規", "rest_days_28_29": 9, "rest_days_30": 9},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_rest_days_28_29_over_29_422(client, auth_headers):
    """rest_days_28_29 > 29 は 422 (28-29日月のバケツに 30 は不可)。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWROLE",
            "name": "新規",
            "rest_days_28_29": 30,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_rest_days_30_over_30_422(client, auth_headers):
    """rest_days_30 > 30 は 422 (30日月のバケツに 31 は不可)。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWROLE",
            "name": "新規",
            "rest_days_28_29": 9,
            "rest_days_30": 31,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_rest_days_31_over_31_422(client, auth_headers):
    """rest_days_31 > 31 は 422 (31日月のバケツに 32 は不可)。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWROLE",
            "name": "新規",
            "rest_days_28_29": 9,
            "rest_days_30": 9,
            "rest_days_31": 32,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_role_rest_days_negative_422(client, auth_headers):
    """rest_days_* に負数は 422。"""
    http, _ = client
    resp = await http.post(
        "/api/v1/roles",
        json={
            "code": "NEWROLE",
            "name": "新規",
            "rest_days_28_29": -1,
            "rest_days_30": 9,
            "rest_days_31": 10,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_role_rest_days_persists(client, auth_headers):
    """update で rest_days_* を変更すると永続化される。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/CHIEF",
        json={
            "name": "主任",
            "rest_days_28_29": 11,
            "rest_days_30": 12,
            "rest_days_31": 13,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["rest_days_28_29"] == 11
    assert data["rest_days_30"] == 12
    assert data["rest_days_31"] == 13

    # 再取得して反映確認
    listed = (await http.get("/api/v1/roles", headers=auth_headers)).json()
    chief = next(r for r in listed if r["code"] == "CHIEF")
    assert chief["rest_days_28_29"] == 11
    assert chief["rest_days_30"] == 12
    assert chief["rest_days_31"] == 13


@pytest.mark.asyncio
async def test_update_role_missing_rest_days_422(client, auth_headers):
    """update で rest_days_* 欠落は 422 (RoleUpdate も全必須)。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/roles/CHIEF",
        json={"name": "主任"},  # rest_days_* 欠落
        headers=auth_headers,
    )
    assert resp.status_code == 422
