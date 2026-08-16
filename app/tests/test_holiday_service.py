"""祝日サービスのテスト。jpholiday から年単位で lazy fetch して DB に保存する挙動を検証する。"""
from __future__ import annotations

import pytest
from sqlalchemy import extract, select

from app.models.holiday import Holiday
from app.services import holiday_service


@pytest.mark.asyncio
async def test_list_holidays_lazy_fetch_inserts_year(client):
    """空 DB → list_holidays(2026, 5) で 2026 年全祝日が DB に入る。"""
    _, db = client

    # 事前: holidays は 0 件
    pre = (await db.execute(select(Holiday))).scalars().all()
    assert len(pre) == 0

    result = await holiday_service.list_holidays(db, 2026, 5)

    # 5 月分は最低 3 日 (3, 4, 5) は含まれる
    days = sorted(h.holiday_date.day for h in result)
    assert 3 in days
    assert 4 in days
    assert 5 in days

    # 年単位で投入されている (2026 年は祝日 16 件前後)
    year_holidays = (
        await db.execute(
            select(Holiday).where(extract("year", Holiday.holiday_date) == 2026)
        )
    ).scalars().all()
    assert len(year_holidays) >= 14


@pytest.mark.asyncio
async def test_list_holidays_skip_when_already_fetched(client):
    """同一年に対し 2 回目以降の呼び出しでは DB 件数が増えない。"""
    _, db = client

    await holiday_service.list_holidays(db, 2026, 5)
    after_first = len((await db.execute(select(Holiday))).scalars().all())

    await holiday_service.list_holidays(db, 2026, 1)
    after_second = len((await db.execute(select(Holiday))).scalars().all())

    assert after_first == after_second
    assert after_first > 0


@pytest.mark.asyncio
async def test_list_holidays_month_filter(client):
    """返却される Holiday は指定年月に限定される。"""
    _, db = client

    result = await holiday_service.list_holidays(db, 2026, 5)

    assert len(result) > 0
    for h in result:
        assert h.holiday_date.year == 2026
        assert h.holiday_date.month == 5


@pytest.mark.asyncio
async def test_list_holidays_january_includes_new_year(client):
    """1 月: 元日 (1/1) が含まれる。"""
    _, db = client

    result = await holiday_service.list_holidays(db, 2026, 1)
    days = [h.holiday_date.day for h in result]
    assert 1 in days


@pytest.mark.asyncio
async def test_list_holidays_no_holiday_month_returns_empty(client):
    """祝日の無い月 (例: 2026 年 6 月) では空リストが返る (年データは投入される)。"""
    _, db = client

    result = await holiday_service.list_holidays(db, 2026, 6)
    assert result == []

    # ただし他月 (例 5 月) には DB 投入済みのはず
    may = await holiday_service.list_holidays(db, 2026, 5)
    assert len(may) > 0


@pytest.mark.asyncio
async def test_list_holidays_different_years_independent(client):
    """異なる年は独立に lazy fetch される。"""
    _, db = client

    await holiday_service.list_holidays(db, 2026, 1)
    count_2026 = (
        await db.execute(
            select(Holiday).where(extract("year", Holiday.holiday_date) == 2026)
        )
    ).scalars().all()

    await holiday_service.list_holidays(db, 2027, 1)
    count_2027 = (
        await db.execute(
            select(Holiday).where(extract("year", Holiday.holiday_date) == 2027)
        )
    ).scalars().all()

    assert len(count_2026) > 0
    assert len(count_2027) > 0
