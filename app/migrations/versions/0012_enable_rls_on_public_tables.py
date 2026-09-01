"""enable row level security on all public tables

Supabase は public スキーマを PostgREST (Data API) で自動公開するため、RLS が
無効なテーブルは anon キーを持つ相手から直接読み書きできる
(database linter: 0013_rls_disabled_in_public / ERROR)。

本アプリは PostgREST を使わず SQLAlchemy で直結するだけなので、ポリシーは 1 つも
作らずに RLS だけ有効化する = PostgREST 経由 (anon / authenticated) は全拒否。
テーブル所有者 (本番 postgres / ローカル demomart) は素の ENABLE なら RLS を
バイパスするため、アプリ側の挙動は変わらない。

FORCE ROW LEVEL SECURITY は使わないこと。ポリシーが無い状態で FORCE すると
所有者も拒否され、アプリが即座に壊れる。

なお 0013 以降で新テーブルを追加する場合は、そのリビジョンでも
ENABLE ROW LEVEL SECURITY が必要（app/tests/test_migration_0012_enable_rls.py が
head 全体の不変条件として検証している）。

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-02
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# alembic_version も PostgREST から見えるので対象に含める。
_LOOP = """
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I {action} ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_LOOP.format(action="ENABLE"))


def downgrade() -> None:
    op.execute(_LOOP.format(action="DISABLE"))
