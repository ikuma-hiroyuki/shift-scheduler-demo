from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    event,
    select,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class WorkPatternGroup(TimestampMixin, Base):
    __tablename__ = "work_pattern_groups"
    __table_args__ = (
        UniqueConstraint(
            "department_id", "name", name="uq_work_pattern_groups_dept_name"
        ),
        UniqueConstraint(
            "id", "department_id", name="uq_work_pattern_groups_id_dept"
        ),
        # color は `#RRGGBB` (hex) のみ。migration 0006 と同じ regex を model 側にも
        # 持たせ、テスト DB (Base.metadata.create_all) でも CHECK が効くようにする。
        CheckConstraint(
            "color ~ '^#[0-9a-fA-F]{6}$'",
            name="ck_work_pattern_groups_color_hex",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_auxiliary: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str] = mapped_column(
        String(7),
        nullable=False,
        # default は app.constants.group_colors.DEFAULT_GROUP_COLOR と同期。
        # migration での server_default リテラルとも一致させること。
        default="#dcfce7",
    )

    patterns: Mapped[list["WorkPattern"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        foreign_keys="WorkPattern.group_id",
    )


class WorkPattern(TimestampMixin, Base):
    __tablename__ = "work_patterns"
    __table_args__ = (
        UniqueConstraint(
            "department_id",
            "pattern_name",
            name="uq_work_patterns_dept_pattern_name",
        ),
        ForeignKeyConstraint(
            ["group_id", "department_id"],
            ["work_pattern_groups.id", "work_pattern_groups.department_id"],
            ondelete="CASCADE",
            name="fk_work_patterns_group_dept",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # group_id は複合 FK (group_id, department_id) で管理する
    # (単独 FK は 0009 で削除済み: AmbiguousForeignKeysError 回避のため)
    group_id: Mapped[int] = mapped_column(Integer, nullable=False)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    pattern_name: Mapped[str] = mapped_column(String(50), nullable=False)
    shift_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1=早 2=フル 3=遅
    shift_start: Mapped[str] = mapped_column(String(5), nullable=False)  # "HH:MM"
    shift_end: Mapped[str] = mapped_column(String(5), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    group: Mapped[WorkPatternGroup] = relationship(
        back_populates="patterns",
        foreign_keys=[group_id],
    )


@event.listens_for(WorkPattern, "before_insert")
def _wp_set_department_id_from_group(_mapper, connection, target: WorkPattern) -> None:
    """`group_id` から `department_id` を自動補完。

    呼び出し側 (API / seed / scripts / tests) で department_id を渡し忘れても
    DB の (group_id, department_id) 複合 FK を満たせるようにする。

    NOTE: `Session.bulk_insert_mappings` / `Session.execute(insert(WorkPattern), ...)` 等の
    Core 経路は ORM event を**バイパス**する。バルク投入時は呼び出し側で
    `department_id` を必ず明示すること。
    """
    if target.department_id is None and target.group_id is not None:
        result = connection.execute(
            select(WorkPatternGroup.department_id).where(
                WorkPatternGroup.id == target.group_id
            )
        ).scalar_one_or_none()
        if result is not None:
            target.department_id = result
