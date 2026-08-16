"""Migration 0006 (work_pattern_groups.color) backfill 結果を検証する。

upgrade 前の状態に既存グループを投入 → upgrade → preset cycling が
`(department_id, sort_order ASC, id ASC)` の順番で循環適用されていることを assert。
multi-department で per-department に独立循環することも検証する。
"""
from __future__ import annotations

import subprocess

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.constants.group_colors import GROUP_COLOR_PRESETS
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
async def test_0006_backfill_cycles_preset_per_department(fresh_alembic_db: str) -> None:
    # 1. revision 0005 まで上げる(color 列追加前の状態)
    _run_alembic("upgrade", "0005", db_url=fresh_alembic_db)

    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.begin() as conn:
            # 2. 2 部門 × 11 グループ(preset 9 を 1 周超え)を投入
            await conn.execute(
                text(
                    "INSERT INTO departments (id, name) VALUES "
                    "(1, 'A店'), (2, 'B店')"
                )
            )
            for dept_id in (1, 2):
                for sort_order in range(11):
                    await conn.execute(
                        text(
                            "INSERT INTO work_pattern_groups "
                            "(department_id, name, sort_order, is_auxiliary) "
                            "VALUES (:d, :n, :s, false)"
                        ),
                        {
                            "d": dept_id,
                            "n": f"G{sort_order:02d}",
                            "s": sort_order,
                        },
                    )
    finally:
        await eng.dispose()

    # 3. head まで上げる(0006 backfill 実行)
    _run_alembic("upgrade", "head", db_url=fresh_alembic_db)

    # 4. 各グループの color が per-department で preset を循環していること
    eng = create_async_engine(fresh_alembic_db)
    try:
        async with eng.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT department_id, sort_order, color "
                        "FROM work_pattern_groups "
                        "ORDER BY department_id, sort_order, id"
                    )
                )
            ).all()
        assert len(rows) == 22  # 2 dept × 11 groups
        for dept_id, sort_order, color in rows:
            expected = GROUP_COLOR_PRESETS[sort_order % len(GROUP_COLOR_PRESETS)]
            assert color == expected, (
                f"dept={dept_id} sort_order={sort_order}: "
                f"expected {expected}, got {color}"
            )
    finally:
        await eng.dispose()
