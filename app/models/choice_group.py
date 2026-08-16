from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PatternChoiceGroup(Base):
    """作業パターン選択グループ（XOR 等の min/max 制約）。"""

    __tablename__ = "pattern_choice_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    # null = 毎日, 0=月〜6=日
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_count: Mapped[int] = mapped_column(Integer, default=1)
    max_count: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    candidates: Mapped[list["PatternChoiceGroupCandidate"]] = relationship(
        back_populates="choice_group", cascade="all, delete-orphan"
    )


class PatternChoiceGroupCandidate(Base):
    __tablename__ = "pattern_choice_group_candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    choice_group_id: Mapped[int] = mapped_column(
        ForeignKey("pattern_choice_groups.id", ondelete="CASCADE"), nullable=False
    )
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )

    choice_group: Mapped[PatternChoiceGroup] = relationship(back_populates="candidates")


class PatternIncompatibility(Base):
    """同日に同時使用不可な作業パターン対。"""

    __tablename__ = "pattern_incompatibilities"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    pattern_id_a: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    pattern_id_b: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
