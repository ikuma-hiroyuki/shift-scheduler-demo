"""rename required_count to required_min and add required_max (issue #247)

曜日テンプレ／特定日上書きの必要人数を範囲指定 (n〜m 人) に拡張する。
- day_templates / day_overrides / shift_shortage_slots の required_count を required_min にリネーム。
- day_templates / day_overrides に required_max (nullable) を追加。NULL=厳格 (ちょうど required_min 人)。

alter_column の rename は既存値を保持する。

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # required_count -> required_min (値は保持)
    op.alter_column("day_templates", "required_count", new_column_name="required_min")
    op.alter_column("day_overrides", "required_count", new_column_name="required_min")
    op.alter_column(
        "shift_shortage_slots", "required_count", new_column_name="required_min"
    )
    # required_max を追加 (NULL=厳格)
    op.add_column(
        "day_templates", sa.Column("required_max", sa.Integer(), nullable=True)
    )
    op.add_column(
        "day_overrides", sa.Column("required_max", sa.Integer(), nullable=True)
    )
    # max>=min を DB レベルでも保証 (NULL=厳格は許容)。schema 検証の最終防御。
    op.create_check_constraint(
        "ck_day_templates_max_ge_min",
        "day_templates",
        "required_max IS NULL OR required_max >= required_min",
    )
    op.create_check_constraint(
        "ck_day_overrides_max_ge_min",
        "day_overrides",
        "required_max IS NULL OR required_max >= required_min",
    )


def downgrade() -> None:
    op.drop_constraint("ck_day_overrides_max_ge_min", "day_overrides", type_="check")
    op.drop_constraint("ck_day_templates_max_ge_min", "day_templates", type_="check")
    op.drop_column("day_overrides", "required_max")
    op.drop_column("day_templates", "required_max")
    op.alter_column(
        "shift_shortage_slots", "required_min", new_column_name="required_count"
    )
    op.alter_column("day_overrides", "required_min", new_column_name="required_count")
    op.alter_column("day_templates", "required_min", new_column_name="required_count")
