"""add rest_days_28_29/30/31 to roles, drop rest_days_* from work_rule_configs

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-13

issue #235: 役職ごとに月間休日数 (28-29日月 / 30日月 / 31日月) をマスタで設定可能にする。

データモデル決定 (D6):
    Role テーブル (global) に 3 列追加し、WorkRuleConfig (department 別) から
    既存 3 列 (rest_days_staff_30/31/fullpart) を削除。multi-tenant 拡張
    (Phase 6) では別 table (role × department) に切り出すリファクタを前提。

4-step migration (Section 1 finding A1):
    既存 row に直接 NOT NULL 列を ADD すると DDL エラーになるため、
    nullable で ADD → backfill → ALTER NOT NULL → WRC 列 DROP の順で実行する。

    1. ALTER TABLE roles ADD COLUMN rest_days_28_29/30/31 INT NULL
    2. UPDATE roles SET ... per code (default 値 backfill)
    3. ALTER TABLE roles ALTER COLUMN ... SET NOT NULL
    4. ALTER TABLE work_rule_configs DROP COLUMN rest_days_staff_30/31/fullpart

Default 値 (D7):
    CHIEF/DEPUTY/STAFF: (28_29, 30, 31) = (9, 9, 10)
    FULLPART/MORNINGPART: (28_29, 30, 31) = (7, 7, 7)
    その他カスタム role: (9, 9, 10) ハードコード fallback

WARNING (downgrade):
    downgrade() は work_rule_configs に 3 列を server_default 付きで復元するが、
    seed default 値 (rest_days_staff_30=9, _31=10, _fullpart=7) で一律埋まる。
    本番運用で WRC.rest_days_* を手動編集した履歴があっても upgrade で Role 表に
    値が移っているため、downgrade ではその個別値は復元できない (Role 表は同時に
    DROP COLUMN されるため)。事実上の片道切符。downgrade 前に必要なら手動 SQL で
    Role.rest_days_* の値を WorkRuleConfig.rest_days_* に書き戻すこと。
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 既知 role への default mapping
_ROLE_DEFAULTS: dict[str, tuple[int, int, int]] = {
    "CHIEF":       (9, 9, 10),
    "DEPUTY":      (9, 9, 10),
    "STAFF":       (9, 9, 10),
    "FULLPART":    (7, 7, 7),
    "MORNINGPART": (7, 7, 7),
}
# カスタム role の fallback
_FALLBACK = (9, 9, 10)


def upgrade() -> None:
    # ---- Step 1: roles に 3 列を nullable で追加 ---------------------------- #
    op.add_column("roles", sa.Column("rest_days_28_29", sa.Integer(), nullable=True))
    op.add_column("roles", sa.Column("rest_days_30",    sa.Integer(), nullable=True))
    op.add_column("roles", sa.Column("rest_days_31",    sa.Integer(), nullable=True))

    # ---- Step 2: backfill ---- #
    # 既知 role: 個別 default
    for code, (d28_29, d30, d31) in _ROLE_DEFAULTS.items():
        op.execute(
            sa.text(
                "UPDATE roles SET "
                "rest_days_28_29 = :d28_29, "
                "rest_days_30 = :d30, "
                "rest_days_31 = :d31 "
                "WHERE code = :code"
            ).bindparams(code=code, d28_29=d28_29, d30=d30, d31=d31)
        )
    # カスタム role (未設定残り): fallback
    op.execute(
        sa.text(
            "UPDATE roles SET "
            "rest_days_28_29 = :d28_29, "
            "rest_days_30 = :d30, "
            "rest_days_31 = :d31 "
            "WHERE rest_days_28_29 IS NULL"
        ).bindparams(d28_29=_FALLBACK[0], d30=_FALLBACK[1], d31=_FALLBACK[2])
    )

    # ---- Step 3: NOT NULL 化 ---- #
    op.alter_column("roles", "rest_days_28_29", existing_type=sa.Integer(), nullable=False)
    op.alter_column("roles", "rest_days_30",    existing_type=sa.Integer(), nullable=False)
    op.alter_column("roles", "rest_days_31",    existing_type=sa.Integer(), nullable=False)

    # ---- Step 4: work_rule_configs から 3 列 DROP ---- #
    op.drop_column("work_rule_configs", "rest_days_staff_30")
    op.drop_column("work_rule_configs", "rest_days_staff_31")
    op.drop_column("work_rule_configs", "rest_days_fullpart")


def downgrade() -> None:
    # ---- 逆 Step 4: work_rule_configs に 3 列を server_default 付きで復元 ---- #
    op.add_column(
        "work_rule_configs",
        sa.Column(
            "rest_days_staff_30",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("9"),
        ),
    )
    op.add_column(
        "work_rule_configs",
        sa.Column(
            "rest_days_staff_31",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("10"),
        ),
    )
    op.add_column(
        "work_rule_configs",
        sa.Column(
            "rest_days_fullpart",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("7"),
        ),
    )
    # server_default をそのまま残すと SQLAlchemy ORM の default と二重定義に
    # なるため、insert 用 default が走った後で DB レベル default を剥がす。
    op.alter_column("work_rule_configs", "rest_days_staff_30", server_default=None)
    op.alter_column("work_rule_configs", "rest_days_staff_31", server_default=None)
    op.alter_column("work_rule_configs", "rest_days_fullpart", server_default=None)

    # ---- 逆 Step 1-3: roles から 3 列 DROP ---- #
    op.drop_column("roles", "rest_days_31")
    op.drop_column("roles", "rest_days_30")
    op.drop_column("roles", "rest_days_28_29")
