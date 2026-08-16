"""preset 色定義が backend constants / migration `0006` で drift していないことを assert。

backend `app.constants.group_colors` を single source of truth とし、historical
migration の `_PRESET_HEX` (snapshot) と一致することを検証する。

frontend `frontend/src/constants/groupPalette.ts` との同期は Vitest 側
(`groupPalette.test.ts`) でハードコード reference との比較により確認する
(app コンテナから frontend ディレクトリは可視範囲外のため pytest からの
直接比較は行わない)。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.constants.group_colors import GROUP_COLOR_PRESETS


REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_migration_module(rel_path: str):
    """alembic migration ファイル(数字始まりで通常 import 不可)を path 経由で load。"""
    full_path = REPO_ROOT / rel_path
    spec = importlib.util.spec_from_file_location("_migration_under_test", full_path)
    assert spec and spec.loader, f"failed to spec migration: {full_path}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_0006_preset_hex_matches_constants() -> None:
    """migration `_PRESET_HEX` が constants と一致する。"""
    mod = _load_migration_module(
        "app/migrations/versions/0006_add_color_to_work_pattern_groups.py"
    )
    assert tuple(mod._PRESET_HEX) == GROUP_COLOR_PRESETS
