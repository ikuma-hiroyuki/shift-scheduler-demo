import datetime

from pydantic import BaseModel


class HolidayResponse(BaseModel):
    """祝日 1 件分のレスポンススキーマ。読み取り専用。"""

    date: datetime.date
    name: str

    model_config = {"from_attributes": False}
