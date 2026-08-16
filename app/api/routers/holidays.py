"""祝日 API ルーター。読み取り専用。

GET /api/v1/holidays?year=Y&month=M で指定年月の法定祝日を返す。
内部で `app.services.holiday_service.list_holidays` を呼び、DB に未投入なら
jpholiday から年分を lazy fetch して保存する。
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.holiday import HolidayResponse
from app.services import holiday_service

router = APIRouter(tags=["holidays"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


@router.get("/holidays", response_model=list[HolidayResponse])
async def list_holidays(
    db: DbDep,
    _: AuthDep,
    year: Annotated[int, Query(ge=1900, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
) -> list[HolidayResponse]:
    holidays = await holiday_service.list_holidays(db, year, month)
    return [HolidayResponse(date=h.holiday_date, name=h.name) for h in holidays]
