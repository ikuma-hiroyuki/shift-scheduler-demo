"""曜日別テンプレート・日別オーバーライドのテスト。"""

import pytest


async def _make_pattern(http, auth_headers, dept_id: int) -> int:
    """テスト用の作業パターンを作成して pattern_id を返す。"""
    gid = (
        await http.post(
            "/api/v1/work-pattern-groups",
            json={"department_id": dept_id, "name": "A", "is_auxiliary": False},
            headers=auth_headers,
        )
    ).json()["id"]
    return (
        await http.post(
            "/api/v1/work-patterns",
            json={"group_id": gid, "pattern_name": "A1", "shift_type": 1,
                  "shift_start": "07:00", "shift_end": "15:30"},
            headers=auth_headers,
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_create_day_template(client, auth_headers, dept):
    """曜日別テンプレートを作成できる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-templates",
        json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid, "required_min": 1},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["day_of_week"] == -1
    assert resp.json()["required_min"] == 1


@pytest.mark.asyncio
async def test_list_day_templates(client, auth_headers, dept):
    """作成したテンプレートが一覧に現れる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    await http.post(
        "/api/v1/day-templates",
        json={"department_id": dept.id, "day_of_week": 0, "pattern_id": pid, "required_min": 1},
        headers=auth_headers,
    )
    resp = await http.get("/api/v1/day-templates", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_update_day_template(client, auth_headers, dept):
    """required_min を更新できる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": 5, "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/day-templates/{tid}",
        json={"required_min": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["required_min"] == 2


@pytest.mark.asyncio
async def test_delete_day_template(client, auth_headers, dept):
    """削除後は 404。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/day-templates/{tid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/day-templates/{tid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_create_day_override(client, auth_headers, dept):
    """特定日のオーバーライドを作成できる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-overrides",
        json={"department_id": dept.id, "specific_date": "2026-05-03",
              "pattern_id": pid, "required_min": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["specific_date"] == "2026-05-03"
    assert resp.json()["required_min"] == 2


@pytest.mark.asyncio
async def test_delete_day_override(client, auth_headers, dept):
    """オーバーライド削除後は 404。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    oid = (
        await http.post(
            "/api/v1/day-overrides",
            json={"department_id": dept.id, "specific_date": "2026-05-04",
                  "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()["id"]
    assert (await http.delete(f"/api/v1/day-overrides/{oid}", headers=auth_headers)).status_code == 204
    assert (await http.get(f"/api/v1/day-overrides/{oid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_create_day_template_appends_sort_order(client, auth_headers, dept):
    """新規作成時に部門内の既存最大 sort_order + 1 が採番される。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    first = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()
    second = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": 0, "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()
    assert first["sort_order"] == 0
    assert second["sort_order"] == 1


@pytest.mark.asyncio
async def test_reorder_day_templates(client, auth_headers, dept):
    """ID 配列順に sort_order を再採番する。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    ids = []
    for wd in (0, 1, 2):
        ids.append(
            (
                await http.post(
                    "/api/v1/day-templates",
                    json={"department_id": dept.id, "day_of_week": wd, "pattern_id": pid, "required_min": 1},
                    headers=auth_headers,
                )
            ).json()["id"]
        )

    reordered = list(reversed(ids))
    resp = await http.put(
        "/api/v1/day-templates/reorder",
        json={"department_id": dept.id, "ids": reordered},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [row["id"] for row in body] == reordered
    assert [row["sort_order"] for row in body] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_day_templates_rejects_mismatched_ids(client, auth_headers, dept):
    """ID 集合が部門内の現存と一致しない場合は 400。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        "/api/v1/day-templates/reorder",
        json={"department_id": dept.id, "ids": [tid, 99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reorder_day_overrides(client, auth_headers, dept):
    """DayOverride も同様に並び替えできる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    ids = []
    for date_str in ("2026-05-01", "2026-05-02", "2026-05-03"):
        ids.append(
            (
                await http.post(
                    "/api/v1/day-overrides",
                    json={"department_id": dept.id, "specific_date": date_str,
                          "pattern_id": pid, "required_min": 1},
                    headers=auth_headers,
                )
            ).json()["id"]
        )

    reordered = list(reversed(ids))
    resp = await http.put(
        "/api/v1/day-overrides/reorder",
        json={"department_id": dept.id, "ids": reordered},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert [row["id"] for row in resp.json()] == reordered


@pytest.mark.asyncio
async def test_list_day_templates_orders_by_sort_order(client, auth_headers, dept):
    """list は sort_order 昇順で返る。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    ids = []
    for wd in (0, 1, 2):
        ids.append(
            (
                await http.post(
                    "/api/v1/day-templates",
                    json={"department_id": dept.id, "day_of_week": wd, "pattern_id": pid, "required_min": 1},
                    headers=auth_headers,
                )
            ).json()["id"]
        )
    await http.put(
        "/api/v1/day-templates/reorder",
        json={"department_id": dept.id, "ids": list(reversed(ids))},
        headers=auth_headers,
    )
    listed = (await http.get("/api/v1/day-templates", headers=auth_headers)).json()
    assert [row["id"] for row in listed] == list(reversed(ids))


@pytest.mark.asyncio
async def test_create_day_template_with_range(client, auth_headers, dept):
    """required_min/required_max で範囲指定のテンプレートを作成できる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-templates",
        json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid,
              "required_min": 2, "required_max": 4},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["required_min"] == 2
    assert resp.json()["required_max"] == 4


@pytest.mark.asyncio
async def test_create_day_template_max_defaults_none(client, auth_headers, dept):
    """required_max を省略すると None（厳格）になる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-templates",
        json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid, "required_min": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["required_min"] == 3
    assert resp.json()["required_max"] is None


@pytest.mark.asyncio
async def test_create_day_template_rejects_max_below_min(client, auth_headers, dept):
    """required_max < required_min は 422。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-templates",
        json={"department_id": dept.id, "day_of_week": -1, "pattern_id": pid,
              "required_min": 4, "required_max": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_day_template_clears_max_to_strict(client, auth_headers, dept):
    """required_max: null を明示送信すると範囲を厳格（max=None）に戻せる（tri-state）。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": 5, "pattern_id": pid,
                  "required_min": 2, "required_max": 4},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/day-templates/{tid}",
        json={"required_max": None},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["required_max"] is None
    assert resp.json()["required_min"] == 2


@pytest.mark.asyncio
async def test_update_day_template_rejects_max_below_existing_min(client, auth_headers, dept):
    """required_max のみ更新で既存 min を下回ると 400（DB 現値も含めて整合検証）。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": 5, "pattern_id": pid, "required_min": 3},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/day-templates/{tid}",
        json={"required_max": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_day_override_with_range(client, auth_headers, dept):
    """特定日オーバーライドも範囲指定できる。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    resp = await http.post(
        "/api/v1/day-overrides",
        json={"department_id": dept.id, "specific_date": "2026-05-03",
              "pattern_id": pid, "required_min": 1, "required_max": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["required_min"] == 1
    assert resp.json()["required_max"] == 3


@pytest.mark.asyncio
async def test_update_day_template_rejects_explicit_null_required_min(client, auth_headers, dept):
    """required_min に明示 null は 422(NOT NULL 列を null クリアできない / Codex F2 regression）。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    tid = (
        await http.post(
            "/api/v1/day-templates",
            json={"department_id": dept.id, "day_of_week": 5, "pattern_id": pid, "required_min": 2},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/day-templates/{tid}",
        json={"required_min": None},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_day_override_rejects_explicit_null_pattern_id(client, auth_headers, dept):
    """day_override も pattern_id に明示 null は 422。"""
    http, _ = client
    pid = await _make_pattern(http, auth_headers, dept.id)
    oid = (
        await http.post(
            "/api/v1/day-overrides",
            json={"department_id": dept.id, "specific_date": "2026-05-10", "pattern_id": pid, "required_min": 1},
            headers=auth_headers,
        )
    ).json()["id"]
    resp = await http.put(
        f"/api/v1/day-overrides/{oid}",
        json={"pattern_id": None},
        headers=auth_headers,
    )
    assert resp.status_code == 422
