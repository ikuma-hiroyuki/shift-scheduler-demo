"""Migration 0010 (Role.rest_days_28_29/30/31 追加 + WorkRuleConfig 3 列削除) の検証。

issue #235 ねらい:
- 既存 5 役職 row に default 値が backfill されること
- NOT NULL 制約が backfill 後に有効化されること
- downgrade で work_rule_configs に 3 列が復活し、roles から 3 列が消えること
- upgrade → downgrade → upgrade のラウンドトリップで失敗しないこと

4-step migration:
  1. ALTER TABLE roles ADD COLUMN rest_days_28_29/30/31 INT NULL
  2. UPDATE roles SET ... per code
  3. ALTER TABLE roles ALTER COLUMN ... NOT NULL
  4. ALTER TABLE work_rule_configs DROP COLUMN rest_days_staff_30/31/fullpart
"""
from __future__ import annotations

import subprocess

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.tests.test_alembic_migrations import (
    ALEMBIC_INI,
    fresh_alembic_db,  # noqa: F401 — pytest fixture re-export
)


def _run_alembic(*args: str, db_url: str) -> subprocess.CompletedProcess[str]:
    import os

    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run(
        ["alembic", "-c", str(ALEMBIC_INI), *args],
        check=True,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


@pytest.mark.asyncio
async def test_0010_upgrade_backfills_default_rest_days(fresh_alembic_db: str) -> None:
    """upgrade で既存 5 役職に正しい default 値が backfill される。"""
    # 1. revision 0009 まで上げる (roles テーブルは存在、rest_days_* 列は無い)
    _run_alembic("upgrade", "0009", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.begin() as conn:
            # 0009 までは 0004 で seed されている 5 default role が存在
            await conn.execute(
                text(
                    "INSERT INTO roles (code, name, order_index) VALUES "
                    "('CHIEF', '主任', 0), "
                    "('DEPUTY', '副主任', 1), "
                    "('STAFF', '一般', 2), "
                    "('FULLPART', 'フルパート', 3), "
                    "('MORNINGPART', '早朝パート', 4) "
                    "ON CONFLICT (code) DO NOTHING"
                )
            )
            # カスタム role も 1 件追加 (fallback default 9/9/10 確認用)
            await conn.execute(
                text(
                    "INSERT INTO roles (code, name, order_index) VALUES "
                    "('CUSTOM', 'カスタム', 5)"
                )
            )
    finally:
        await eng.dispose()

    # 2. head まで上げる (0010 backfill 実行)
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    # 3. backfill 結果検証
    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT code, rest_days_28_29, rest_days_30, rest_days_31 "
                        "FROM roles ORDER BY order_index"
                    )
                )
            ).all()

        by_code = {r[0]: (r[1], r[2], r[3]) for r in rows}
        assert by_code["CHIEF"] == (9, 9, 10), f"CHIEF: {by_code['CHIEF']}"
        assert by_code["DEPUTY"] == (9, 9, 10)
        assert by_code["STAFF"] == (9, 9, 10)
        assert by_code["FULLPART"] == (7, 7, 7)
        assert by_code["MORNINGPART"] == (7, 7, 7)
        # カスタム role は fallback default (9, 9, 10)
        assert by_code["CUSTOM"] == (9, 9, 10)
    finally:
        await eng.dispose()


@pytest.mark.asyncio
async def test_0010_upgrade_enforces_not_null(fresh_alembic_db: str) -> None:
    """upgrade 後 rest_days_* に NULL を入れる INSERT は失敗する。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.begin() as conn:
            with pytest.raises(Exception) as exc_info:
                await conn.execute(
                    text(
                        "INSERT INTO roles (code, name, order_index, "
                        "rest_days_28_29, rest_days_30, rest_days_31) "
                        "VALUES ('NULLTEST', 'NULL試験', 99, NULL, 9, 10)"
                    )
                )
            # postgres は NOT NULL 違反で IntegrityError 系
            assert "null" in str(exc_info.value).lower() or "violates" in str(exc_info.value).lower()
    finally:
        await eng.dispose()


@pytest.mark.asyncio
async def test_0010_upgrade_drops_workruleconfig_columns(fresh_alembic_db: str) -> None:
    """upgrade 後 work_rule_configs から 3 列が削除されている。残 2 列のみ。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'work_rule_configs' "
                        "AND column_name LIKE 'rest_days%'"
                    )
                )
            ).all()
        assert rows == [], f"work_rule_configs に rest_days_* 列が残存: {rows}"

        async with eng.connect() as conn:
            remaining = (
                await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'work_rule_configs'"
                    )
                )
            ).all()
        col_names = {r[0] for r in remaining}
        # 残るべき列
        assert "standard_work_hours_per_day" in col_names
        assert "max_overtime_hours_staff" in col_names
        # 削除されるべき列
        assert "rest_days_staff_30" not in col_names
        assert "rest_days_staff_31" not in col_names
        assert "rest_days_fullpart" not in col_names
    finally:
        await eng.dispose()


@pytest.mark.asyncio
async def test_0010_downgrade_restores_workruleconfig_columns(fresh_alembic_db: str) -> None:
    """downgrade で work_rule_configs に 3 列復活、roles から 3 列削除。"""
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)
    _run_alembic("downgrade", "0009", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            # roles から 3 列が消えている
            rows = (
                await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'roles' AND column_name LIKE 'rest_days%'"
                    )
                )
            ).all()
        assert rows == [], f"downgrade 後 roles に rest_days_* 列残存: {rows}"

        async with eng.connect() as conn:
            # work_rule_configs に 3 列が復活
            rows = (
                await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'work_rule_configs' "
                        "AND column_name LIKE 'rest_days%'"
                    )
                )
            ).all()
        col_names = {r[0] for r in rows}
        assert "rest_days_staff_30" in col_names
        assert "rest_days_staff_31" in col_names
        assert "rest_days_fullpart" in col_names
    finally:
        await eng.dispose()


@pytest.mark.asyncio
async def test_0010_roundtrip_preserves_seed_defaults(fresh_alembic_db: str) -> None:
    """upgrade → downgrade → upgrade ラウンドトリップで seed default 値が保たれる。"""
    _run_alembic("upgrade", "0009", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO roles (code, name, order_index) VALUES "
                    "('CHIEF', '主任', 0), "
                    "('DEPUTY', '副主任', 1), "
                    "('STAFF', '一般', 2), "
                    "('FULLPART', 'フルパート', 3), "
                    "('MORNINGPART', '早朝パート', 4) "
                    "ON CONFLICT (code) DO NOTHING"
                )
            )
    finally:
        await eng.dispose()

    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)
    _run_alembic("downgrade", "0009", db_url=fresh_alembic_db)
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT code, rest_days_28_29, rest_days_30, rest_days_31 "
                        "FROM roles WHERE code IN ('CHIEF', 'MORNINGPART') "
                        "ORDER BY code"
                    )
                )
            ).all()
        by_code = {r[0]: (r[1], r[2], r[3]) for r in rows}
        assert by_code["CHIEF"] == (9, 9, 10)
        assert by_code["MORNINGPART"] == (7, 7, 7)
    finally:
        await eng.dispose()
