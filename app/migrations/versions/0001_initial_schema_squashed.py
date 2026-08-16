"""initial schema (squashed)

Revision ID: 0001
Revises:
Create Date: 2026-05-03

過去 0001〜0010 のリビジョンを 1 本に潰した最終形。
スキーマは旧最終 head と機能的に等価。`server_default`、制約名、UNIQUE/INDEX
構造、`diagnosis` の型まで合わせている（旧 head の pg_dump とほぼ一致する）。

差分許容項目:
- pg_dump 出力上のカラム順序差（論理的等価）
"""
from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'departments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'holidays',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('holiday_date', sa.Date(), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('holiday_date', name='uq_holidays_holiday_date'),
    )
    op.create_index(
        'ix_holidays_holiday_date',
        'holidays',
        ['holiday_date'],
        unique=False,
    )
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('is_admin', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_table(
        'employees',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_number', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('available_days', sa.String(length=20), server_default='0,1,2,3,4,5,6', nullable=False),
        sa.Column('available_shift_types', sa.String(length=10), server_default='1,2,3', nullable=False),
        sa.Column('prefer_consecutive', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_number'),
    )
    op.create_table(
        'pattern_choice_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('day_of_week', sa.Integer(), nullable=True),
        sa.Column('min_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('max_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'shift_schedules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='DRAFT', nullable=False),
        sa.Column('generation_attempt', sa.Integer(), server_default='1', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('diagnosis', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'year', 'month', 'generation_attempt', name='uq_schedule_dept_year_month_attempt'),
    )
    op.create_table(
        'work_pattern_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('is_auxiliary', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'name', name='uq_work_pattern_groups_dept_name'),
        sa.UniqueConstraint('id', 'department_id', name='uq_work_pattern_groups_id_dept'),
    )
    op.create_table(
        'work_rule_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('standard_work_hours_per_day', sa.Float(), server_default='8.0', nullable=False),
        sa.Column('rest_days_fullpart', sa.Integer(), server_default='7', nullable=False),
        sa.Column('rest_days_staff_30', sa.Integer(), server_default='9', nullable=False),
        sa.Column('rest_days_staff_31', sa.Integer(), server_default='10', nullable=False),
        sa.Column('max_overtime_hours_staff', sa.Float(), server_default='40.0', nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id'),
    )
    op.create_table(
        'leave_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('day', sa.Integer(), nullable=False),
        sa.Column('leave_type', sa.String(length=20), server_default='REQUESTED', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'pattern_triggers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('auxiliary_group_id', sa.Integer(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['auxiliary_group_id'], ['work_pattern_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'work_patterns',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('pattern_name', sa.String(length=50), nullable=False),
        sa.Column('shift_type', sa.Integer(), nullable=False),
        sa.Column('shift_start', sa.String(length=5), nullable=False),
        sa.Column('shift_end', sa.String(length=5), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], name='fk_work_patterns_department_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['group_id', 'department_id'],
            ['work_pattern_groups.id', 'work_pattern_groups.department_id'],
            name='fk_work_patterns_group_dept',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'pattern_name', name='uq_work_patterns_dept_pattern_name'),
    )
    op.create_table(
        'day_overrides',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('specific_date', sa.Date(), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.Column('required_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'day_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('day_of_week', sa.Integer(), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.Column('required_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'employee_pattern_priorities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.Column('priority', sa.Integer(), server_default='5', nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'pattern_choice_group_candidates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('choice_group_id', sa.Integer(), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['choice_group_id'], ['pattern_choice_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'pattern_incompatibilities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('pattern_id_a', sa.Integer(), nullable=False),
        sa.Column('pattern_id_b', sa.Integer(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id_a'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id_b'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'pattern_trigger_required_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trigger_id', sa.Integer(), nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['group_id'], ['work_pattern_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['trigger_id'], ['pattern_triggers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'shift_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('schedule_id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('assignment_type', sa.String(length=10), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['schedule_id'], ['shift_schedules.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'special_assignment_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('condition_type', sa.String(length=20), nullable=False),
        sa.Column('condition_value', sa.Integer(), nullable=True),
        sa.Column('required_role', sa.String(length=20), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pattern_id'], ['work_patterns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('special_assignment_rules')
    op.drop_table('shift_assignments')
    op.drop_table('pattern_trigger_required_groups')
    op.drop_table('pattern_incompatibilities')
    op.drop_table('pattern_choice_group_candidates')
    op.drop_table('employee_pattern_priorities')
    op.drop_table('day_templates')
    op.drop_table('day_overrides')
    op.drop_table('work_patterns')
    op.drop_table('pattern_triggers')
    op.drop_table('leave_requests')
    op.drop_table('work_rule_configs')
    op.drop_table('work_pattern_groups')
    op.drop_table('shift_schedules')
    op.drop_table('pattern_choice_groups')
    op.drop_table('employees')
    op.drop_table('users')
    op.drop_index('ix_holidays_holiday_date', table_name='holidays')
    op.drop_table('holidays')
    op.drop_table('departments')
