"""add color column to work_pattern_groups

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-06

`/work-patterns` 画面でグループごとに `/shift` 稼働表詳細の色を設定できるよう、
`work_pattern_groups.color` (`#RRGGBB`) を追加する。

既存行は preset 9 色を `(department_id, sort_order)` で循環割り当てし、
ShiftGrid の従来配色 (sort_order 順 % 9) と見た目互換にする。

preset hex は本ファイル(historical snapshot)に inline で持つが、
新規コードは `app.constants.group_colors.GROUP_COLOR_PRESETS` を参照すること。
両者の同期は `app/tests/test_preset_color_sync.py` で検証している。

WARNING (downgrade):
    `downgrade()` は `color` 列を `DROP COLUMN` するためユーザーが設定した
    custom hex は完全消失する。本番では downgrade 前に DB バックアップを取得
    すること。テスト/開発環境向けの reversible 保証のみ。

NOTE (concurrency):
    upgrade は (1) nullable 列追加 → (2) backfill UPDATE → (3) `SET NOT NULL`
    の 3 statement で構成される。デプロイ中に他 worker が `color` を伴わない
    INSERT を行うと NULL 行が残り (3) で `NotNullViolation` で失敗する可能性が
    ある。本プロジェクトは単一プロセス前提のため通常は問題ないが、
    マルチプロセス化時は migration 中に書き込みを止めるか、本 migration を
    トランザクション内で `LOCK TABLE work_pattern_groups IN ACCESS EXCLUSIVE
    MODE;` で挟むよう新しい migration を発行すること。
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PRESET_HEX = (
    "#dcfce7",  # green
    "#dbeafe",  # blue
    "#fef9c3",  # yellow
    "#e5e7eb",  # gray
    "#ecfccb",  # lime
    "#ffedd5",  # orange
    "#fef3c7",  # amber
    "#f3e4ff",  # purple
    "#e0f2fe",  # sky
)


def upgrade() -> None:
    op.add_column(
        "work_pattern_groups",
        sa.Column("color", sa.String(length=7), nullable=True),
    )

    array_literal = "ARRAY[" + ",".join(f"'{h}'" for h in _PRESET_HEX) + "]"
    op.execute(
        f"""
        UPDATE work_pattern_groups g
        SET color = sub.hex
        FROM (
          SELECT id,
                 ({array_literal})[
                    (ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY sort_order, id) - 1)
                    % {len(_PRESET_HEX)} + 1
                 ] AS hex
          FROM work_pattern_groups
        ) sub
        WHERE g.id = sub.id
        """
    )

    op.alter_column(
        "work_pattern_groups",
        "color",
        nullable=False,
        server_default="#dcfce7",
    )
    op.create_check_constraint(
        "ck_work_pattern_groups_color_hex",
        "work_pattern_groups",
        "color ~ '^#[0-9a-fA-F]{6}$'",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_work_pattern_groups_color_hex", "work_pattern_groups"
    )
    op.drop_column("work_pattern_groups", "color")
