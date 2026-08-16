"""作業パターングループの preset 色 (backend 側 single source of truth)。

frontend は `frontend/src/constants/groupPalette.ts` に同等の定義を持つ。
両者の値は `app/tests/test_preset_color_sync.py` で drift 検知される。

migration `app/migrations/versions/0006_add_color_to_work_pattern_groups.py` は
historical snapshot として inline 定義を残す (revision の不変性を保つため)。
将来 preset を増減する際は本ファイル + frontend + 新しい alter migration の 3 箇所更新。
"""

# Tailwind `*-100` 系と一致する明色 9 色。
GROUP_COLOR_PRESETS: tuple[str, ...] = (
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

DEFAULT_GROUP_COLOR: str = GROUP_COLOR_PRESETS[0]
