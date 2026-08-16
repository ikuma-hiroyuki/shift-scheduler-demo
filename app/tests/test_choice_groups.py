"""PatternChoiceGroup・PatternIncompatibility のテスト。"""

import pytest


async def _make_patterns(http, auth_headers, dept_id: int, count: int = 2) -> list[int]:
    """テスト用の作業パターンを複数作成して id リストを返す。"""
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept_id, "name": "X", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    ids = []
    for i in range(count):
        pid = (
            await http.post(
                "/api/v1/work-patterns",
                json={"group_id": gid, "pattern_name": f"X{i+1}", "shift_type": 1,
                      "shift_start": "07:00", "shift_end": "15:30"},
                headers=auth_headers,
            )
        ).json()["id"]
        ids.append(pid)
    return ids


@pytest.mark.asyncio
async def test_create_choice_group(client, auth_headers, dept):
    """選択グループを候補パターン付きで作成できる。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 3)
    resp = await http.post(
        "/api/v1/choice-groups",
        json={"department_id": dept.id, "day_of_week": None,
              "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert sorted(data["candidate_pattern_ids"]) == sorted(pids)
    assert data["min_count"] == 1


@pytest.mark.asyncio
async def test_get_choice_group_returns_candidates(client, auth_headers, dept):
    """GET で候補パターンが正しく返る。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    gid = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.get(f"/api/v1/choice-groups/{gid}", headers=auth_headers)
    assert resp.status_code == 200
    assert sorted(resp.json()["candidate_pattern_ids"]) == sorted(pids)


@pytest.mark.asyncio
async def test_update_choice_group_candidates(client, auth_headers, dept):
    """候補パターンを差し替えできる。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 3)
    gid = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[:2]},
            headers=auth_headers,
        )
    ).json()["id"]
    # 候補を3つに更新
    resp = await http.put(
        f"/api/v1/choice-groups/{gid}",
        json={"candidate_pattern_ids": pids},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert sorted(resp.json()["candidate_pattern_ids"]) == sorted(pids)


@pytest.mark.asyncio
async def test_update_choice_group_day_of_week(client, auth_headers, dept):
    """PUT で day_of_week を null（毎日）→ 特定曜日に変更できる (issue #115)。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    gid = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids},
            headers=auth_headers,
        )
    ).json()["id"]
    # null → 3 (木曜)
    resp = await http.put(
        f"/api/v1/choice-groups/{gid}",
        json={"day_of_week": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["day_of_week"] == 3
    # 3 → null (毎日) に戻せる
    resp = await http.put(
        f"/api/v1/choice-groups/{gid}",
        json={"day_of_week": None},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["day_of_week"] is None


@pytest.mark.asyncio
async def test_delete_choice_group(client, auth_headers, dept):
    """削除後は 404。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    gid = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/choice-groups/{gid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/choice-groups/{gid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_create_pattern_incompatibility(client, auth_headers, dept):
    """非両立ルールを作成できる。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    resp = await http.post(
        "/api/v1/pattern-incompatibilities",
        json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["pattern_id_a"] == pids[0]
    assert data["pattern_id_b"] == pids[1]


@pytest.mark.asyncio
async def test_delete_pattern_incompatibility(client, auth_headers, dept):
    """非両立ルール削除後はリストから消える。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    iid = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (
        await http.delete(f"/api/v1/pattern-incompatibilities/{iid}", headers=auth_headers)
    ).status_code == 204
    listed = (await http.get("/api/v1/pattern-incompatibilities", headers=auth_headers)).json()
    assert all(item["id"] != iid for item in listed)


# ------------------------------------------------------------------ #
# sort_order / reorder テスト
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_choice_group_post_assigns_sort_order(client, auth_headers, dept):
    """POST 時に部門内の最大 sort_order + 1 を採番する。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    g1 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[:2]},
            headers=auth_headers,
        )
    ).json()
    g2 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[2:]},
            headers=auth_headers,
        )
    ).json()
    assert g1["sort_order"] == 0
    assert g2["sort_order"] == 1


@pytest.mark.asyncio
async def test_choice_group_list_ordered_by_sort_order(client, auth_headers, dept):
    """list は (department_id, sort_order, id) で順序保持される。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    g1 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[:2]},
            headers=auth_headers,
        )
    ).json()
    g2 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[2:]},
            headers=auth_headers,
        )
    ).json()
    listed = (await http.get("/api/v1/choice-groups", headers=auth_headers)).json()
    deptd = [g for g in listed if g["department_id"] == dept.id]
    assert [g["id"] for g in deptd] == [g1["id"], g2["id"]]


@pytest.mark.asyncio
async def test_choice_group_reorder_changes_order(client, auth_headers, dept):
    """PUT /reorder で並び順が反転する。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    g1 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[:2]},
            headers=auth_headers,
        )
    ).json()
    g2 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids[2:]},
            headers=auth_headers,
        )
    ).json()
    resp = await http.put(
        "/api/v1/choice-groups/reorder",
        json={"department_id": dept.id, "ids": [g2["id"], g1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [g["id"] for g in body] == [g2["id"], g1["id"]]
    assert body[0]["sort_order"] == 0
    assert body[1]["sort_order"] == 1


@pytest.mark.asyncio
async def test_choice_group_reorder_id_mismatch_returns_400(client, auth_headers, dept):
    """部門に存在しない id を含めると 400。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    g1 = (
        await http.post(
            "/api/v1/choice-groups",
            json={"department_id": dept.id, "day_of_week": None,
                  "min_count": 1, "max_count": 1, "candidate_pattern_ids": pids},
            headers=auth_headers,
        )
    ).json()
    resp = await http.put(
        "/api/v1/choice-groups/reorder",
        json={"department_id": dept.id, "ids": [g1["id"], 99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_incompatibility_rejects_same_pattern_id(client, auth_headers, dept):
    """A == B の自己非両立は 422 で弾かれる。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    resp = await http.post(
        "/api/v1/pattern-incompatibilities",
        json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[0]},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_incompatibility_post_assigns_sort_order(client, auth_headers, dept):
    """非両立ルール POST 時に sort_order が採番される。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    i1 = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()
    i2 = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[2], "pattern_id_b": pids[3]},
            headers=auth_headers,
        )
    ).json()
    assert i1["sort_order"] == 0
    assert i2["sort_order"] == 1


@pytest.mark.asyncio
async def test_incompatibility_reorder_changes_order(client, auth_headers, dept):
    """非両立ルール PUT /reorder で並び順が反転する。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    i1 = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()
    i2 = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[2], "pattern_id_b": pids[3]},
            headers=auth_headers,
        )
    ).json()
    resp = await http.put(
        "/api/v1/pattern-incompatibilities/reorder",
        json={"department_id": dept.id, "ids": [i2["id"], i1["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [i["id"] for i in body] == [i2["id"], i1["id"]]


# ------------------------------------------------------------------ #
# PUT /pattern-incompatibilities/{incomp_id} (UPDATE)
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_update_incompatibility_changes_patterns(client, auth_headers, dept):
    """A/B を別パターンに変更すると 200 で更新後の値が返る。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 4)
    iid = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/pattern-incompatibilities/{iid}",
        json={"pattern_id_a": pids[2], "pattern_id_b": pids[3]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["pattern_id_a"] == pids[2]
    assert data["pattern_id_b"] == pids[3]


@pytest.mark.asyncio
async def test_update_incompatibility_self_pattern_returns_422(client, auth_headers, dept):
    """既存 ID で pattern_id_a == pattern_id_b にしようとすると 422。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    iid = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/pattern-incompatibilities/{iid}",
        json={"pattern_id_a": pids[0], "pattern_id_b": pids[0]},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_incompatibility_not_found_returns_404(client, auth_headers, dept):
    """存在しない id を指定すると 404。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 2)
    resp = await http.put(
        "/api/v1/pattern-incompatibilities/99999",
        json={"pattern_id_a": pids[0], "pattern_id_b": pids[1]},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_incompatibility_partial_keeps_other_field(client, auth_headers, dept):
    """pattern_id_a のみ送ったとき pattern_id_b は変わらない。"""
    http, _ = client
    pids = await _make_patterns(http, auth_headers, dept.id, 3)
    iid = (
        await http.post(
            "/api/v1/pattern-incompatibilities",
            json={"department_id": dept.id, "pattern_id_a": pids[0], "pattern_id_b": pids[1]},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/pattern-incompatibilities/{iid}",
        json={"pattern_id_a": pids[2]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["pattern_id_a"] == pids[2]
    assert data["pattern_id_b"] == pids[1]
