"""add time_limit column to shift_schedules (issue #161)

Revision ID: 0003
Revises: 0001
Create Date: 2026-05-05

CP-SAT ソルバーの最大実行時間（秒）を ShiftSchedule に保存する。
フロントの生成進捗バーが ``elapsed / time_limit`` で動作するために必要。
既存行は server_default=120.0 で初期化される。
"""
from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'shift_schedules',
        sa.Column(
            'time_limit',
            sa.Float(),
            server_default=sa.text('120.0'),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('shift_schedules', 'time_limit')
