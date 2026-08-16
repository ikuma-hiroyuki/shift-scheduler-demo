from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PatternTrigger(Base):
    """補助ポジション発生条件（例: C は B+D+E 全員埋まり時のみ使用可）。"""

    __tablename__ = "pattern_triggers"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    auxiliary_group_id: Mapped[int] = mapped_column(
        ForeignKey("work_pattern_groups.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    required_groups: Mapped[list["PatternTriggerRequiredGroup"]] = relationship(
        back_populates="trigger", cascade="all, delete-orphan"
    )


class PatternTriggerRequiredGroup(Base):
    __tablename__ = "pattern_trigger_required_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    trigger_id: Mapped[int] = mapped_column(
        ForeignKey("pattern_triggers.id", ondelete="CASCADE"), nullable=False
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("work_pattern_groups.id", ondelete="CASCADE"), nullable=False
    )

    trigger: Mapped[PatternTrigger] = relationship(back_populates="required_groups")


class SpecialAssignmentRule(Base):
    """特定条件下での役職・作業パターン固定ルール（木曜/月末など）。"""

    __tablename__ = "special_assignment_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    # WEEKDAY | LAST_DAY
    condition_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # WEEKDAY の場合: 0=月〜6=日。LAST_DAY の場合は null。
    condition_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # CHIEF | DEPUTY
    required_role: Mapped[str] = mapped_column(String(20), nullable=False)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
