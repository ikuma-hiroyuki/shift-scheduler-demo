"""drop server_default from work_pattern_groups.color

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-07

NOTE (revision history):
    元は 0007 で発行 (PR #220) したが、平行して PR #196 が同番号 0007 で
    heartbeat migration を merge していたため、Alembic に 2 つの head が並ぶ
    状態が発生した (`Revision 0007 is present more than once`)。本 migration を
    0008 にリネームし、down_revision を heartbeat 0007 に向けることで chain
    を 0006 → 0007(heartbeat) → 0008(color drop) として一本化する。

issue #214: 0006 で color に `server_default='#dcfce7'` を残してあると、
SQL 直接 INSERT (admin tool, ad-hoc seed) で color を省略した行が silent に
緑になり、「per-department 循環割り当て」の intent を破壊する。

アプリ経路 (FastAPI router 経由) は Pydantic default `DEFAULT_GROUP_COLOR`
で必ず色を送るためこの drop で挙動は変わらない。
ORM 経由の直接 `WorkPatternGroup(...)` 構築は SQLAlchemy model の
Python レベル `default="#dcfce7"` がフォールバックを担う (model 側は本 PR
では触らない — ORM 利用ケースでは silent fallback 問題は発生しない)。

NULL 行は CHECK 制約で禁止済 (`color ~ '^#[0-9a-fA-F]{6}$'`) かつ
NOT NULL なので、SQL 直接 INSERT で色省略すると NotNullViolation で
即座に失敗する状態になる (本 migration の狙い)。

WARNING (downgrade):
    `downgrade()` は server_default を `#dcfce7` に戻す。0006 と同等の状態
    に復帰する。データ消失なし。
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alembic's `alter_column(server_default=None)` is a no-op (means "leave unchanged").
    # Use raw DDL to actually DROP DEFAULT.
    op.execute(
        "ALTER TABLE work_pattern_groups ALTER COLUMN color DROP DEFAULT"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE work_pattern_groups ALTER COLUMN color SET DEFAULT '#dcfce7'"
    )
