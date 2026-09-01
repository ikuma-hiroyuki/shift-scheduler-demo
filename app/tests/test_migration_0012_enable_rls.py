"""Migration 0012 (public スキーマ全テーブルの RLS 有効化) の検証。

Supabase は public スキーマを PostgREST (Data API) で自動公開するため、RLS が
無効なテーブルは anon キーを持つ相手から直接読み書きできてしまう
(database linter: 0013_rls_disabled_in_public / ERROR)。

本アプリは PostgREST を一切使わず SQLAlchemy で直結するだけなので、
「ポリシーを 1 つも作らずに RLS だけ有効化する」= PostgREST 側は全拒否、
テーブル所有者 (本番 postgres / ローカル demomart) は素の ENABLE なら
バイパスするのでアプリは無影響、という状態が正しいゴール。

このテストは 0012 に固定した検証ではなく head 全体に対する不変条件として書く。
将来 0013 以降で追加したテーブルが RLS を有効化し忘れていれば、ここで落ちる。
"""
from __future__ import annotations

import os
import subprocess

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.tests.test_alembic_migrations import (
    ALEMBIC_INI,
    fresh_alembic_db,  # noqa: F401 — pytest fixture re-export
)


def _run_alembic(*args: str, db_url: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run(
        ["alembic", "-c", str(ALEMBIC_INI), *args],
        check=True,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


async def test_all_public_tables_have_rls_enabled(fresh_alembic_db: str) -> None:
    """upgrade head 後、public スキーマの全テーブルで RLS が有効になっている。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND rowsecurity = false "
                        "ORDER BY tablename"
                    )
                )
            ).scalars().all()
            # alembic_version も PostgREST から見えるので対象に含む
            assert rows == [], f"RLS 未有効のテーブル: {rows}"

            # 素の ENABLE であること (FORCE だと所有者も拒否され、アプリが壊れる)
            forced = (
                await conn.execute(
                    text(
                        "SELECT relname FROM pg_class c "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                        "AND c.relforcerowsecurity = true ORDER BY relname"
                    )
                )
            ).scalars().all()
            assert forced == [], f"FORCE RLS になっているテーブル: {forced}"
    finally:
        await eng.dispose()


async def test_0012_downgrade_disables_rls(fresh_alembic_db: str) -> None:
    """downgrade 0011 で RLS が元の無効状態に戻る。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)
    _run_alembic("downgrade", "0011", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            enabled = (
                await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND rowsecurity = true "
                        "ORDER BY tablename"
                    )
                )
            ).scalars().all()
            assert enabled == [], f"downgrade 後も RLS が残っている: {enabled}"
    finally:
        await eng.dispose()


async def test_owner_can_still_read_write_after_rls_enabled(fresh_alembic_db: str) -> None:
    """RLS 有効化後もアプリの接続ロール (= テーブル所有者) は読み書きできる。

    ポリシーは 1 つも無いので、FORCE ROW LEVEL SECURITY にしてしまうと所有者も
    拒否されアプリが壊れる。素の ENABLE であることをここで実証する。
    """
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.begin() as conn:
            await conn.execute(
                text("INSERT INTO departments (name) VALUES ('RLS 検証部門')")
            )
        async with eng.connect() as conn:
            names = (
                await conn.execute(text("SELECT name FROM departments"))
            ).scalars().all()
            assert "RLS 検証部門" in names
    finally:
        await eng.dispose()
