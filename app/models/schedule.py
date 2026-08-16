import datetime
from typing import Any

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ShiftSchedule(TimestampMixin, Base):
    __tablename__ = "shift_schedules"
    __table_args__ = (
        UniqueConstraint(
            "department_id", "year", "month", "generation_attempt",
            name="uq_schedule_dept_year_month_attempt",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    # DRAFT | GENERATING | GENERATED | PARTIAL | INFEASIBLE | CANCELLED | PUBLISHED
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    generation_attempt: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(default=False)
    # INFEASIBLE / PARTIAL 診断結果（改行区切り文字列、人間可読）
    diagnosis: Mapped[str | None] = mapped_column(nullable=True)
    # PARTIAL 用構造化診断 (shortages, capacity_summary, manager_gap_days)。フロントが直接消費する。
    diagnosis_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # CP-SAT に渡した最大計算時間（秒）。フロントの進捗バーが elapsed/time_limit で動くため永続化。
    time_limit: Mapped[float] = mapped_column(Float, nullable=False, default=120.0)
    # issue #196: worker が solve 中に定期更新する heartbeat。
    # status='GENERATING' のまま (started_at + 2 * time_limit) を超えても更新が無ければ
    # worker が異常終了したと見做して INFEASIBLE に flip する判定に使う。
    last_heartbeat_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ShiftAssignment(Base):
    __tablename__ = "shift_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("shift_schedules.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    # WORK | REST | LEAVE
    assignment_type: Mapped[str] = mapped_column(String(10), nullable=False)
    # assignment_type=WORK の場合のみ設定
    pattern_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="SET NULL"), nullable=True
    )


class ShiftShortageSlot(Base):
    """PARTIAL 状態の稼働表で、CP-SAT が埋められなかったポジ枠を 1 行 1 件で保持する。

    部分割当 (`solve_partial`) の結果として「日 D の作業パターン P が `missing_count` 名不足」
    を表す行を作成する。手動編集 UI で店長が `ShiftAssignment` を WORK + pattern_id=P で
    追加するたびに `missing_count -= 1` を実施。逆に WORK 解除 (pattern-swap や WORK→REST)
    した場合は `missing_count += 1` (上限 `required_min`)。`missing_count == 0` のとき
    `can_finalize: true` を判定し、行は復元可能性のため保持する (DELETE しない)。
    """

    __tablename__ = "shift_shortage_slots"
    __table_args__ = (
        UniqueConstraint(
            "schedule_id", "date", "pattern_id",
            name="uq_shortage_slot_schedule_date_pattern",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("shift_schedules.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    # solve_partial 開始時に確定した最小必要人数。restore 時の missing_count 上限値。
    required_min: Mapped[int] = mapped_column(Integer, nullable=False)
    missing_count: Mapped[int] = mapped_column(Integer, nullable=False)
