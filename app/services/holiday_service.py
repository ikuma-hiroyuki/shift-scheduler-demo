"""祝日サービス。

jpholiday から年単位で日本の法定祝日を lazy fetch し、`holidays` テーブルに永続化する。
UI (/shift など) と optimizer (app/optimizer/loader.py) の双方が本サービス経由で
DB を参照することで、祝日情報の真実の単一ソースを保つ。
"""
from __future__ import annotations

from sqlalchemy import extract, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holiday import Holiday


async def list_holidays(
    session: AsyncSession, year: int, month: int
) -> list[Holiday]:
    """指定年月の祝日を返す。

    指定年の祝日が DB に未投入なら jpholiday から年分を一括取得して保存し、
    そのうえで該当月分を絞り込んで返す。同一年に対する 2 回目以降の呼び出しは
    DB を読むだけで jpholiday は呼ばない。
    """
    has_year = await session.scalar(
        select(func.count(Holiday.id)).where(
            extract("year", Holiday.holiday_date) == year
        )
    )
    if not has_year:
        await _bulk_insert_year(session, year)

    result = await session.execute(
        select(Holiday)
        .where(
            extract("year", Holiday.holiday_date) == year,
            extract("month", Holiday.holiday_date) == month,
        )
        .order_by(Holiday.holiday_date)
    )
    return list(result.scalars().all())


async def _bulk_insert_year(session: AsyncSession, year: int) -> None:
    """jpholiday から年分の祝日を取得し ON CONFLICT DO NOTHING で挿入する。"""
    import jpholiday

    records = [
        {"holiday_date": d, "name": name}
        for d, name in jpholiday.year_holidays(year)
    ]
    if not records:
        return

    stmt = (
        pg_insert(Holiday)
        .values(records)
        .on_conflict_do_nothing(index_elements=["holiday_date"])
    )
    await session.execute(stmt)
    await session.flush()
