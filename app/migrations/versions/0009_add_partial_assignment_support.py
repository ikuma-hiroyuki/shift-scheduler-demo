"""add diagnosis_json to shift_schedules and create shift_shortage_slots

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-11

部分割当機能 (issue: PARTIAL ステータス導入) のためのスキーマ拡張:

1. shift_schedules.diagnosis_json (JSONB nullable) を追加。
   PARTIAL 状態のときに `{shortages: [...], capacity_summary: [...], manager_gap_days: [...]}`
   構造化診断データを保存し、フロント (ShortagePopover / ShiftGrid 不足行) が直接消費する。
   既存の `diagnosis: str` (人間可読、改行区切り) は維持し並走させる。

2. shift_shortage_slots テーブルを新規追加。CP-SAT が部分解で埋められなかった
   「日 D × 作業パターン P × N 名不足」を 1 行 1 件で保持する。手動編集 UI で店長が
   ShiftAssignment を WORK + pattern_id=P で追加するたびに行を 1 件減らし、
   全行が消えたら `can_finalize: true` を API が返す。

   制約: (schedule_id, date, pattern_id) UNIQUE (同じ日・同じパターンで複数行作らない、
   missing_count を増減する)。schedule_id / pattern_id とも CASCADE。

WARNING (downgrade):
    downgrade() は shift_shortage_slots テーブルを DROP し、shift_schedules.diagnosis_json
    列を DROP する。PARTIAL 状態の稼働表の構造化診断と不足スロット情報は全て消失する。
    既存の `diagnosis: str` テキスト列は残るため人間可読の診断は維持される。
    PARTIAL 状態の稼働表は INFEASIBLE 相当の挙動に劣化する。downgrade 前に PARTIAL
    状態の稼働表を GENERATED に確定するか CANCELLED にすること。
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shift_schedules",
        sa.Column(
            "diagnosis_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )

    op.create_table(
        "shift_shortage_slots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("pattern_id", sa.Integer(), nullable=False),
        # 元々その日 × そのパターンで必要だった人数 (solve_partial 開始時に確定)。
        # pattern-swap 編集で WORK A → WORK B / WORK → REST 等が起きたとき、
        # A の slot を復元する際に `missing_count += 1` の上限として使う。
        sa.Column("required_count", sa.Integer(), nullable=False),
        sa.Column("missing_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["schedule_id"],
            ["shift_schedules.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pattern_id"],
            ["work_patterns.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "schedule_id", "date", "pattern_id",
            name="uq_shortage_slot_schedule_date_pattern",
        ),
        # 不足カウントは 0..required_count の範囲。0 のとき can_finalize 判定に
        # 使われず (PATCH 復元時に再び >0 になり得るため行は保持する)、
        # 同時 PATCH で負値になる事故を DB レベルで遮断する。
        sa.CheckConstraint(
            "missing_count >= 0 AND missing_count <= required_count",
            name="ck_shortage_slot_missing_count_range",
        ),
        sa.CheckConstraint(
            "required_count > 0",
            name="ck_shortage_slot_required_count_positive",
        ),
    )
    op.create_index(
        "ix_shift_shortage_slots_schedule_id",
        "shift_shortage_slots",
        ["schedule_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shift_shortage_slots_schedule_id",
        table_name="shift_shortage_slots",
    )
    op.drop_table("shift_shortage_slots")
    op.drop_column("shift_schedules", "diagnosis_json")
