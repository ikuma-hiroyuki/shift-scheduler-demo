"""rename employees.prefer_consecutive to consecutive_workable

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-06

`prefer_consecutive` は「連勤を好む」と読める誤解を生むため、
実態に合わせて `consecutive_workable`（連勤可能フラグ）にリネームする。
データはそのまま保持される（PostgreSQL の RENAME COLUMN）。
"""
from collections.abc import Sequence
from typing import Union

from alembic import op


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'employees',
        'prefer_consecutive',
        new_column_name='consecutive_workable',
    )


def downgrade() -> None:
    op.alter_column(
        'employees',
        'consecutive_workable',
        new_column_name='prefer_consecutive',
    )
