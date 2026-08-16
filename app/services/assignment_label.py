"""
app/services/assignment_label.py — ShiftAssignment の表示ラベル導出を一元化

`get_schedule_assignments` と手動編集 PATCH の戻り値で同一ロジックを共有するためのヘルパー。
ここを直すとグリッド読取と編集レスポンスの両方が同期的に変わる。
"""
from __future__ import annotations

from app.core.constants import LEAVE_TYPE_LABEL
from app.models.schedule import ShiftAssignment


def cell_label(
    assignment: ShiftAssignment,
    leave_map: dict[tuple[int, int], str],
    pid_to_name: dict[int, str],
) -> str:
    """
    ShiftAssignment 1 行のラベルを返す。

    - WORK + pattern_id あり → pattern_name（"A1" 等）、未知の pattern_id は "?"
    - LEAVE → leave_map[(employee_id, day)] を LEAVE_TYPE_LABEL で変換、無ければ "●"
    - それ以外（REST など） → "割当休日"
    """
    if assignment.assignment_type == "WORK" and assignment.pattern_id is not None:
        return pid_to_name.get(assignment.pattern_id, "?")
    if assignment.assignment_type == "LEAVE":
        lt = leave_map.get((assignment.employee_id, assignment.date.day), "REQUESTED")
        return LEAVE_TYPE_LABEL.get(lt, "●")
    return "割当休日"
