"""部門一覧エンドポイントのテスト。"""

import pytest

@pytest.mark.asyncio
async def test_list_departments(client, auth_headers, dept):
    """部門一覧を取得できる。"""
    http, _ = client
    # The dept fixture creates at least one department in the DB.
    resp = await http.get("/api/v1/departments", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    
    # Check if the created department is in the list
    dept_ids = [d["id"] for d in data]
    assert dept.id in dept_ids
