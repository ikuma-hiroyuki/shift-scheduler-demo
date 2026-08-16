import datetime

from sqlalchemy import Date, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Holiday(Base):
    """日本の法定祝日。jpholiday から年単位で lazy fetch して保存する読み取り専用マスタ。"""

    __tablename__ = "holidays"

    id: Mapped[int] = mapped_column(primary_key=True)
    holiday_date: Mapped[datetime.date] = mapped_column(
        Date, nullable=False, unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
