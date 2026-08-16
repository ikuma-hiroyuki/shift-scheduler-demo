"""
Alembic マイグレーションの up/down スモークテスト。

専用の使い捨て DB（demomart_alembic_test）を作って `alembic upgrade head`
と `alembic downgrade base` を順に走らせ、両方とも成功し終了することを確認する。
全リビジョンを順次走査するため、any-revision の構文エラーやドロップ忘れがあれば
ここで落ちる。
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# alembic.ini は repo ルート。
# 本ファイル: <root>/app/tests/test_alembic_migrations.py → 親×3 = <root>
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"

# 既存テスト DB を汚染しないよう専用 DB を使う。
# 接続先（host/port/credentials）は TEST_DATABASE_URL から派生させる。
# Docker compose では `db` ホスト、CI（GitHub Actions service）では `localhost`。
def _resolve_alembic_db_url() -> str:
    explicit = os.environ.get("ALEMBIC_TEST_DATABASE_URL")
    if explicit:
        return explicit
    fallback_host = "db"
    try:
        import socket as _socket
        _socket.getaddrinfo("db", 5432)
    except OSError:
        fallback_host = "localhost"
    test_url = os.environ.get(
        "TEST_DATABASE_URL",
        f"postgresql+asyncpg://demomart:demomart@{fallback_host}:5432/demomart_test",
    )
    base = test_url.rsplit("/", 1)[0]
    return f"{base}/demomart_alembic_test"


ALEMBIC_DB_URL = _resolve_alembic_db_url()
DB_NAME = ALEMBIC_DB_URL.rsplit("/", 1)[1]
ADMIN_URL = ALEMBIC_DB_URL.rsplit("/", 1)[0] + "/demomart"


async def _drop_and_create_db() -> None:
    admin = create_async_engine(ADMIN_URL)
    try:
        async with admin.execution_options(isolation_level="AUTOCOMMIT").connect() as conn:
            # 既存接続が残っていれば終了させてから DROP
            await conn.execute(text(
                f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                f"WHERE datname = '{DB_NAME}' AND pid <> pg_backend_pid()"
            ))
            await conn.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME}"))
            await conn.execute(text(f"CREATE DATABASE {DB_NAME}"))
    finally:
        await admin.dispose()


async def _drop_db() -> None:
    admin = create_async_engine(ADMIN_URL)
    try:
        async with admin.execution_options(isolation_level="AUTOCOMMIT").connect() as conn:
            await conn.execute(text(
                f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                f"WHERE datname = '{DB_NAME}' AND pid <> pg_backend_pid()"
            ))
            await conn.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME}"))
    finally:
        await admin.dispose()


@pytest_asyncio.fixture
async def fresh_alembic_db() -> str:
    """テスト専用 DB を毎回作り直してから渡す。"""
    await _drop_and_create_db()
    yield ALEMBIC_DB_URL
    await _drop_db()


def _run_alembic(*args: str, db_url: str) -> subprocess.CompletedProcess[str]:
    """alembic CLI を subprocess で実行。env.py が DATABASE_URL を尊重する仕様に依存。"""
    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run(
        ["alembic", "-c", str(ALEMBIC_INI), *args],
        check=True,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_alembic_ini_exists() -> None:
    """alembic.ini の場所解決ヘルパが正しい（テスト基盤の sanity）。"""
    assert ALEMBIC_INI.is_file()


async def test_alembic_upgrade_head(fresh_alembic_db: str) -> None:
    """空 DB に `alembic upgrade head` を実行し、最終リビジョンへ到達できる。"""
    result = _run_alembic("upgrade", "head", db_url=fresh_alembic_db)
    assert result.returncode == 0

    # alembic_version テーブルが作られ、最新 head と一致するリビジョンが記録されている
    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            current = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
            assert current is not None
        # `alembic heads` で最新リビジョンを取得して比較
        heads_out = _run_alembic("heads", db_url=fresh_alembic_db).stdout
        head_rev = heads_out.split()[0]
        assert current == head_rev
    finally:
        await eng.dispose()


async def test_alembic_downgrade_base_after_upgrade(fresh_alembic_db: str) -> None:
    """upgrade head → downgrade base が連続して通ること（双方向の検証）。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)
    result = _run_alembic("downgrade", "base", db_url=fresh_alembic_db)
    assert result.returncode == 0

    # ダウングレード後は alembic_version が空（または行なし）
    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            row = (await conn.execute(text("SELECT version_num FROM alembic_version"))).first()
            assert row is None
    finally:
        await eng.dispose()


def test_alembic_history_lists_all_revisions() -> None:
    """`alembic history` がエラーなく動き、リビジョンチェーンが連続している。"""
    result = subprocess.run(
        ["alembic", "-c", str(ALEMBIC_INI), "history"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    # versions/ 配下の各 .py 1 ファイルにつき 1 リビジョン分の出力が出る
    versions_dir = ALEMBIC_INI.parent / "app" / "migrations" / "versions"
    py_files = [p for p in versions_dir.glob("*.py") if not p.name.startswith("_")]
    # 出力の中に少なくとも各ファイルのリビジョン id（先頭 4 文字 = 0001 等）が含まれる
    out = result.stdout
    for f in py_files:
        rev_prefix = f.stem.split("_", 1)[0]
        assert rev_prefix in out, f"alembic history に {rev_prefix} が含まれない:\n{out}"
