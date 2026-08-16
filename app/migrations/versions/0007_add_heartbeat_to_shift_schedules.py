"""add last_heartbeat_at column to shift_schedules

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-06

issue #196: worker が solve 中に定期更新する heartbeat 列を追加する。
status='GENERATING' のまま heartbeat が古い行を sweeper が INFEASIBLE に
flip して、worker 異常終了時の永久 GENERATING 状態を解消する。

nullable のまま (default なし) で追加し、既存行は NULL のまま残す。
sweeper は started_at + 2 * time_limit を超えても heartbeat NULL の行を
worker 異常終了とみなして INFEASIBLE 化する。

WARNING (downgrade):
    `downgrade()` は列を `DROP COLUMN` するため、稼働中 worker の heartbeat
    記録が消失する。downgrade 前に worker を停止すること。
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shift_schedules",
        sa.Column(
            "last_heartbeat_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("shift_schedules", "last_heartbeat_at")
