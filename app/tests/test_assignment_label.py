"""
assignment_label.cell_label の単体テスト。
"""
from __future__ import annotations

from datetime import date

from app.models.schedule import ShiftAssignment
from app.services.assignment_label import cell_label


def _make(assignment_type: str, day: int = 1, pattern_id: int | None = None, employee_id: int = 1):
    return ShiftAssignment(
        schedule_id=1,
        employee_id=employee_id,
        date=date(2026, 4, day),
        assignment_type=assignment_type,
        pattern_id=pattern_id,
    )


def test_work_with_known_pattern():
    a = _make("WORK", day=1, pattern_id=10)
    assert cell_label(a, leave_map={}, pid_to_name={10: "A1"}) == "A1"


def test_work_with_unknown_pattern():
    a = _make("WORK", day=1, pattern_id=99)
    assert cell_label(a, leave_map={}, pid_to_name={10: "A1"}) == "?"


def test_leave_requested():
    a = _make("LEAVE", day=5, employee_id=2)
    assert cell_label(a, leave_map={(2, 5): "REQUESTED"}, pid_to_name={}) == "●"


def test_leave_tentative():
    a = _make("LEAVE", day=6, employee_id=2)
    assert cell_label(a, leave_map={(2, 6): "TENTATIVE"}, pid_to_name={}) == "○"


def test_leave_mandatory():
    a = _make("LEAVE", day=7, employee_id=3)
    assert cell_label(a, leave_map={(3, 7): "MANDATORY"}, pid_to_name={}) == "有給"


def test_leave_missing_in_map_falls_back():
    a = _make("LEAVE", day=8)
    # leave_map に無し → REQUESTED 扱い → "●"
    assert cell_label(a, leave_map={}, pid_to_name={}) == "●"


def test_leave_unknown_type():
    a = _make("LEAVE", day=9, employee_id=4)
    # マップ外の leave_type → "●" にフォールバック
    assert cell_label(a, leave_map={(4, 9): "UNKNOWN_TYPE"}, pid_to_name={}) == "●"


def test_rest_assignment():
    a = _make("REST", day=2)
    assert cell_label(a, leave_map={}, pid_to_name={}) == "割当休日"


def test_work_without_pattern_id_treated_as_rest():
    a = _make("WORK", day=3, pattern_id=None)
    # pattern_id None の WORK は REST 同様 "割当休日"
    assert cell_label(a, leave_map={}, pid_to_name={}) == "割当休日"
