"""祝日 API ルーターのテスト。"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_list_holidays_returns_january_new_year(client, auth_headers):
    """1 月: 元日が含まれる。"""
    http, _ = client
    resp = await http.get(
        "/api/v1/holidays",
        params={"year": 2026, "month": 1},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    dates = [item["date"] for item in body]
    assert "2026-01-01" in dates


@pytest.mark.asyncio
async def test_list_holidays_returns_may_constitution_day(client, auth_headers):
    """5 月: 憲法記念日 (5/3) が含まれる。"""
    http, _ = client
    resp = await http.get(
        "/api/v1/holidays",
        params={"year": 2026, "month": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    dates = [item["date"] for item in body]
    assert "2026-05-03" in dates
    # 名称が文字列で返る
    for item in body:
        assert isinstance(item["name"], str) and len(item["name"]) > 0


@pytest.mark.asyncio
async def test_list_holidays_filters_by_month(client, auth_headers):
    """指定月以外の祝日は返らない。"""
    http, _ = client
    resp = await http.get(
        "/api/v1/holidays",
        params={"year": 2026, "month": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    for item in resp.json():
        assert item["date"].startswith("2026-05-")


@pytest.mark.asyncio
async def test_list_holidays_requires_auth(client):
    """認証なしは 401。"""
    http, _ = client
    resp = await http.get("/api/v1/holidays", params={"year": 2026, "month": 1})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_holidays_validates_query(client, auth_headers):
    """year / month バリデーション失敗で 422。"""
    http, _ = client
    resp = await http.get(
        "/api/v1/holidays",
        params={"year": 2026, "month": 13},
        headers=auth_headers,
    )
    assert resp.status_code == 422
