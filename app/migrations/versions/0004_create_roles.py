"""create roles master table (issue #173)

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-06

役職をマスタテーブル化し、Employee.role に FK 制約を追加する。
デフォルト 5 役職を bulk_insert で投入する。
"""
from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    roles_table = op.create_table(
        'roles',
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('code'),
    )

    op.bulk_insert(
        roles_table,
        [
            {'code': 'CHIEF', 'name': '主任', 'order_index': 0},
            {'code': 'DEPUTY', 'name': '副主任', 'order_index': 1},
            {'code': 'STAFF', 'name': '一般', 'order_index': 2},
            {'code': 'FULLPART', 'name': 'フルパート', 'order_index': 3},
            {'code': 'MORNINGPART', 'name': '早朝パート', 'order_index': 4},
        ],
    )

    op.create_foreign_key(
        'fk_employees_role_roles',
        'employees',
        'roles',
        ['role'],
        ['code'],
        ondelete='RESTRICT',
    )


def downgrade() -> None:
    op.drop_constraint('fk_employees_role_roles', 'employees', type_='foreignkey')
    op.drop_table('roles')
