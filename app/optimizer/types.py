"""部分割当 (PARTIAL 状態) で授受するデータ型。

`solve_partial` の戻り値で使い、フロントの ShortagePopover /
ShiftGrid 不足行も同じ shape を期待する。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class ShortageRow:
    """不足ポジ 1 件 (1 日 × 1 作業パターン)。

    `required` は最小必要人数 (required_min)。不足は下限割れのみで、
    `missing` = `required - assigned`。`solve_partial` が CP-SAT の
    shortage 変数の値を読み取って組み立てる。
    """

    day: int
    pattern_id: int
    pattern_name: str
    required: int
    assigned: int
    missing: int

    def to_dict(self) -> dict:
        return asdict(self)
