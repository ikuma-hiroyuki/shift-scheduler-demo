from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Department(TimestampMixin, Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    work_rule_config: Mapped["WorkRuleConfig"] = relationship(
        back_populates="department", uselist=False, cascade="all, delete-orphan"
    )


class WorkRuleConfig(Base):
    __tablename__ = "work_rule_configs"

    # issue #235: rest_days_fullpart / rest_days_staff_30 / rest_days_staff_31 は
    # Role 表の rest_days_28_29 / rest_days_30 / rest_days_31 に移行 (migration 0010)。
    # WorkRuleConfig は標準勤務時間と残業上限のみ保持。
    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    standard_work_hours_per_day: Mapped[float] = mapped_column(default=8.0)
    max_overtime_hours_staff: Mapped[float] = mapped_column(default=40.0)

    department: Mapped[Department] = relationship(back_populates="work_rule_config")
