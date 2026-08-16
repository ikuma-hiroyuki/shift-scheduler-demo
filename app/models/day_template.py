import datetime

from sqlalchemy import Date, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DayTemplate(Base):
    """曜日別の作業パターン必要人数定義。weekday=-1 は全曜日適用。"""

    __tablename__ = "day_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    # -1=全曜日, 0=月, 1=火, 2=水, 3=木, 4=金, 5=土, 6=日, 7=祝
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    # 最小必要人数。required_max=None のとき「ちょうど required_min 人」（厳格）。
    required_min: Mapped[int] = mapped_column(Integer, default=1)
    # 上限必要人数。None=厳格（required_min 人ちょうど）、値あり=範囲 required_min〜required_max。
    required_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DayOverride(Base):
    """特定日（祝日・繁忙日）のパターン必要人数上書き。"""

    __tablename__ = "day_overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    specific_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    # 最小必要人数。required_max=None のとき「ちょうど required_min 人」（厳格）。
    required_min: Mapped[int] = mapped_column(Integer, default=1)
    # 上限必要人数。None=厳格（required_min 人ちょうど）、値あり=範囲 required_min〜required_max。
    required_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
