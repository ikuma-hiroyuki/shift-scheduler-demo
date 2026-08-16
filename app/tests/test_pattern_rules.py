"""PatternTrigger・SpecialAssignmentRule のテスト。"""

import pytest


async def _make_group(http, auth_headers, dept_id, name="A", is_auxiliary=False) -> int:
    return (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept_id, "name": name,
                  "is_auxiliary": is_auxiliary},
            headers=auth_headers,
        )
    ).json()["id"]


async def _make_pattern(http, auth_headers, group_id, name="A1") -> int:
    return (
        await http.post(
            "/api/v1/work-patterns",
            json={"group_id": group_id, "pattern_name": name, "shift_type": 1,
                  "shift_start": "07:00", "shift_end": "15:30"},
            headers=auth_headers,
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_create_pattern_trigger(client, auth_headers, dept):
    """補助ポジション発生トリガーを作成できる。"""
    http, _ = client
    aux_gid = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    req_gid1 = await _make_group(http, auth_headers, dept.id, "B")
    req_gid2 = await _make_group(http, auth_headers, dept.id, "D")
    resp = await http.post(
        "/api/v1/pattern-triggers",
        json={"department_id": dept.id, "auxiliary_group_id": aux_gid,
              "required_group_ids": [req_gid1, req_gid2]},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["auxiliary_group_id"] == aux_gid
    assert sorted(data["required_group_ids"]) == sorted([req_gid1, req_gid2])


@pytest.mark.asyncio
async def test_get_pattern_trigger(client, auth_headers, dept):
    """GET で required_group_ids が正しく返る。"""
    http, _ = client
    aux_gid = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    req_gid = await _make_group(http, auth_headers, dept.id, "B")
    tid = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux_gid,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.get(f"/api/v1/pattern-triggers/{tid}", headers=auth_headers)
    assert resp.status_code == 200
    assert req_gid in resp.json()["required_group_ids"]


@pytest.mark.asyncio
async def test_update_pattern_trigger(client, auth_headers, dept):
    """PUT で auxiliary_group_id と required_group_ids を更新できる。"""
    http, _ = client
    aux_gid = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    aux_gid2 = await _make_group(http, auth_headers, dept.id, "F", is_auxiliary=True)
    req_gid1 = await _make_group(http, auth_headers, dept.id, "B")
    req_gid2 = await _make_group(http, auth_headers, dept.id, "D")
    req_gid3 = await _make_group(http, auth_headers, dept.id, "E")
    tid = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux_gid,
                  "required_group_ids": [req_gid1]},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/pattern-triggers/{tid}",
        json={"auxiliary_group_id": aux_gid2, "required_group_ids": [req_gid2, req_gid3]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["auxiliary_group_id"] == aux_gid2
    assert sorted(data["required_group_ids"]) == sorted([req_gid2, req_gid3])


@pytest.mark.asyncio
async def test_update_pattern_trigger_rejects_duplicate_aux(client, auth_headers, dept):
    """PUT で他 trigger と aux が衝突する変更は 422 で弾かれる。"""
    http, _ = client
    aux1 = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    aux2 = await _make_group(http, auth_headers, dept.id, "F", is_auxiliary=True)
    req_gid = await _make_group(http, auth_headers, dept.id, "B")
    # 2 trigger を別 aux で作成
    t1 = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux1,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()["id"]
    t2_id = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux2,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()["id"]
    # t2 の aux を t1 と同じ aux1 に変更しようとすると 422
    resp = await http.put(
        f"/api/v1/pattern-triggers/{t2_id}",
        json={"auxiliary_group_id": aux1},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    # 自分の aux に変えるのは OK (no-op)
    resp_same = await http.put(
        f"/api/v1/pattern-triggers/{t1}",
        json={"auxiliary_group_id": aux1},
        headers=auth_headers,
    )
    assert resp_same.status_code == 200


@pytest.mark.asyncio
async def test_create_pattern_trigger_assigns_sort_order(client, auth_headers, dept):
    """部門ごとに 0 から順に sort_order が採番される。"""
    http, _ = client
    aux1 = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    aux2 = await _make_group(http, auth_headers, dept.id, "F", is_auxiliary=True)
    req_gid = await _make_group(http, auth_headers, dept.id, "B")
    t1 = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux1,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()
    t2 = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux2,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()
    assert t1["sort_order"] == 0
    assert t2["sort_order"] == 1


@pytest.mark.asyncio
async def test_reorder_pattern_triggers(client, auth_headers, dept):
    """PUT /pattern-triggers/reorder で sort_order が再採番される。"""
    http, _ = client
    aux1 = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    aux2 = await _make_group(http, auth_headers, dept.id, "F", is_auxiliary=True)
    aux3 = await _make_group(http, auth_headers, dept.id, "G", is_auxiliary=True)
    req_gid = await _make_group(http, auth_headers, dept.id, "B")
    ids = []
    for aux in [aux1, aux2, aux3]:
        ids.append(
            (
                await http.post(
                    "/api/v1/pattern-triggers",
                    json={"department_id": dept.id, "auxiliary_group_id": aux,
                          "required_group_ids": [req_gid]},
                    headers=auth_headers,
                )
            ).json()["id"]
        )
    new_order = [ids[2], ids[0], ids[1]]
    resp = await http.put(
        "/api/v1/pattern-triggers/reorder",
        json={"department_id": dept.id, "ids": new_order},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [t["id"] for t in data] == new_order
    assert [t["sort_order"] for t in data] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_pattern_triggers_rejects_mismatch(client, auth_headers, dept):
    """ID 集合不一致で 400。"""
    http, _ = client
    resp = await http.put(
        "/api/v1/pattern-triggers/reorder",
        json={"department_id": dept.id, "ids": [99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_pattern_trigger(client, auth_headers, dept):
    """削除後は 404。"""
    http, _ = client
    aux_gid = await _make_group(http, auth_headers, dept.id, "C", is_auxiliary=True)
    req_gid = await _make_group(http, auth_headers, dept.id, "B")
    tid = (
        await http.post(
            "/api/v1/pattern-triggers",
            json={"department_id": dept.id, "auxiliary_group_id": aux_gid,
                  "required_group_ids": [req_gid]},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/pattern-triggers/{tid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/pattern-triggers/{tid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_create_special_assignment_rule(client, auth_headers, dept):
    """特別割当ルール（木曜）を作成できる。"""
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A3")
    resp = await http.post(
        "/api/v1/special-assignment-rules",
        json={"department_id": dept.id, "condition_type": "WEEKDAY",
              "condition_value": 3, "required_role": "CHIEF", "pattern_id": pid},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["condition_type"] == "WEEKDAY"
    assert data["condition_value"] == 3
    assert data["required_role"] == "CHIEF"


@pytest.mark.asyncio
async def test_create_special_assignment_last_day(client, auth_headers, dept):
    """月末ルールを作成できる。"""
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A2")
    resp = await http.post(
        "/api/v1/special-assignment-rules",
        json={"department_id": dept.id, "condition_type": "LAST_DAY",
              "condition_value": None, "required_role": "CHIEF", "pattern_id": pid},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["condition_type"] == "LAST_DAY"


@pytest.mark.asyncio
async def test_update_special_assignment_condition_type(client, auth_headers, dept):
    """PUT で condition_type を WEEKDAY → LAST_DAY などに変更できる (issue #116)。"""
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A2")
    rid = (
        await http.post(
            "/api/v1/special-assignment-rules",
            json={"department_id": dept.id, "condition_type": "WEEKDAY",
                  "condition_value": 3, "required_role": "CHIEF", "pattern_id": pid},
            headers=auth_headers,
        )
    ).json()["id"]
    # WEEKDAY → LAST_DAY（同時に required_role も維持されることを確認）
    resp = await http.put(
        f"/api/v1/special-assignment-rules/{rid}",
        json={"condition_type": "LAST_DAY"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["condition_type"] == "LAST_DAY"
    assert resp.json()["required_role"] == "CHIEF"


@pytest.mark.asyncio
async def test_update_special_assignment_last_day_clears_condition_value(
    client, auth_headers, dept
):
    """LAST_DAY 切替時は condition_value が None に強制される (issue #116)。"""
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A2")
    rid = (
        await http.post(
            "/api/v1/special-assignment-rules",
            json={"department_id": dept.id, "condition_type": "WEEKDAY",
                  "condition_value": 5, "required_role": "DEPUTY", "pattern_id": pid},
            headers=auth_headers,
        )
    ).json()["id"]
    # WEEKDAY (condition_value=5) → LAST_DAY 切替で condition_value が None になる
    resp = await http.put(
        f"/api/v1/special-assignment-rules/{rid}",
        json={"condition_type": "LAST_DAY"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["condition_type"] == "LAST_DAY"
    assert resp.json()["condition_value"] is None


@pytest.mark.asyncio
async def test_update_existing_last_day_rule_keeps_condition_value_null(
    client, auth_headers, dept
):
    """既存の LAST_DAY rule に condition_value のみ送っても None が維持される (issue #125)。

    PR #124 では `body.condition_type == "LAST_DAY"` のみ判定していたため、
    既に LAST_DAY な rule に condition_value=3 を送ると LAST_DAY/3 という
    不整合状態が作れてしまっていた。`rule.condition_type` で判定するよう修正。
    """
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A2")
    # LAST_DAY rule を直接作成
    rid = (
        await http.post(
            "/api/v1/special-assignment-rules",
            json={"department_id": dept.id, "condition_type": "LAST_DAY",
                  "condition_value": None, "required_role": "CHIEF", "pattern_id": pid},
            headers=auth_headers,
        )
    ).json()["id"]
    # condition_value=3 だけ送る (condition_type は送らない)
    resp = await http.put(
        f"/api/v1/special-assignment-rules/{rid}",
        json={"condition_value": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["condition_type"] == "LAST_DAY"
    # 不整合状態が作られないこと
    assert resp.json()["condition_value"] is None


@pytest.mark.asyncio
async def test_delete_special_assignment_rule(client, auth_headers, dept):
    """削除後は 404。"""
    http, _ = client
    gid = await _make_group(http, auth_headers, dept.id, "A")
    pid = await _make_pattern(http, auth_headers, gid, "A3")
    rid = (
        await http.post(
            "/api/v1/special-assignment-rules",
            json={"department_id": dept.id, "condition_type": "WEEKDAY",
                  "condition_value": 3, "required_role": "CHIEF", "pattern_id": pid},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (
        await http.delete(f"/api/v1/special-assignment-rules/{rid}", headers=auth_headers)
    ).status_code == 204
    assert (
        await http.get(f"/api/v1/special-assignment-rules/{rid}", headers=auth_headers)
    ).status_code == 404
