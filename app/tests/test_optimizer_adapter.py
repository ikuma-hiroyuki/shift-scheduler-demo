"""
app/optimizer/adapter.py のユニットテスト。

CP-SAT ソルバーは重く非決定的なので、ShiftModelBuilder と diagnose_infeasible は
unittest.mock で置き換え、adapter 層のラベル振り分け・status 分岐のみを検証する。
"""
from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from app.models.schedule import ShiftAssignment
from app.optimizer import adapter
from app.optimizer.cp_sat_model import ShiftModelInput, WorkPattern


def _make_input(patterns: list[WorkPattern] | None = None) -> ShiftModelInput:
    """テスト用の最小 ShiftModelInput を組み立てる。adapter は patterns / year / month しか参照しない。"""
    return ShiftModelInput(
        year=2026,
        month=4,
        employees=[],
        patterns=patterns or [],
        day_requirements={},
        leave_requests={},
        choice_groups=[],
    )


def _pattern(pid: int, name: str, group: str = "A") -> WorkPattern:
    return WorkPattern(
        id=pid,
        group_name=group,
        pattern_name=name,
        shift_type=2,
        shift_start="09:00",
        shift_end="18:00",
    )


# ---------------------------------------------------------------------------
# run_optimizer: status 分岐
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("status", ["INFEASIBLE", "UNKNOWN", "MODEL_INVALID"])
def test_run_optimizer_non_feasible_returns_empty(status: str) -> None:
    """OPTIMAL/FEASIBLE 以外は空リスト + extract_result 呼ばれない。"""
    inp = _make_input([_pattern(1, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = (status, MagicMock())

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder) as builder_cls:
        result_status, assignments = adapter.run_optimizer(inp, schedule_id=42)

    assert result_status == status
    assert assignments == []
    builder_cls.assert_called_once_with(inp)
    fake_builder.build_and_solve.assert_called_once_with(
        time_limit=120.0, workers=4, solver=None,
    )
    fake_builder.extract_result.assert_not_called()


@pytest.mark.parametrize("status", ["OPTIMAL", "FEASIBLE"])
def test_run_optimizer_feasible_extracts_results(status: str) -> None:
    """OPTIMAL/FEASIBLE は extract_result の戻り値を ShiftAssignment 化する。"""
    patterns = [_pattern(10, "A1"), _pattern(20, "B2")]
    inp = _make_input(patterns)

    fake_builder = MagicMock()
    fake_solver = MagicMock()
    fake_builder.build_and_solve.return_value = (status, fake_solver)
    fake_builder.extract_result.return_value = {
        (1, 5): "A1",
        (2, 5): "割当休日",
    }

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        result_status, assignments = adapter.run_optimizer(inp, schedule_id=99)

    assert result_status == status
    fake_builder.extract_result.assert_called_once_with(fake_solver)
    assert len(assignments) == 2
    assert all(isinstance(a, ShiftAssignment) for a in assignments)
    assert all(a.schedule_id == 99 for a in assignments)


def test_run_optimizer_passes_solver_options() -> None:
    """time_limit と workers がそのままソルバーへ渡る。"""
    inp = _make_input()
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("INFEASIBLE", MagicMock())

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        adapter.run_optimizer(inp, schedule_id=1, time_limit=30.0, workers=8)

    fake_builder.build_and_solve.assert_called_once_with(
        time_limit=30.0, workers=8, solver=None,
    )


def test_run_optimizer_forwards_external_solver() -> None:
    """外部 solver を受け取って builder にそのまま渡す（cancel 用途・issue #177）。"""
    inp = _make_input()
    fake_builder = MagicMock()
    sentinel_solver = MagicMock(name="external_solver")
    fake_builder.build_and_solve.return_value = ("INFEASIBLE", sentinel_solver)

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        adapter.run_optimizer(inp, schedule_id=1, solver=sentinel_solver)

    fake_builder.build_and_solve.assert_called_once_with(
        time_limit=120.0, workers=4, solver=sentinel_solver,
    )


# ---------------------------------------------------------------------------
# ラベル → assignment_type 振り分け
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("label", ["●", "○", "有給"])
def test_run_optimizer_leave_labels_become_leave(label: str) -> None:
    """休暇ラベルは assignment_type=LEAVE、pattern_id=None。"""
    inp = _make_input([_pattern(1, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("OPTIMAL", MagicMock())
    fake_builder.extract_result.return_value = {(7, 10): label}

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    assert len(assignments) == 1
    a = assignments[0]
    assert a.assignment_type == "LEAVE"
    assert a.pattern_id is None
    assert a.employee_id == 7
    assert a.date == date(2026, 4, 10)


def test_run_optimizer_assigned_rest_label_becomes_rest() -> None:
    """『割当休日』は assignment_type=REST、pattern_id=None。"""
    inp = _make_input([_pattern(1, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("OPTIMAL", MagicMock())
    fake_builder.extract_result.return_value = {(3, 15): "割当休日"}

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    a = assignments[0]
    assert a.assignment_type == "REST"
    assert a.pattern_id is None


def test_run_optimizer_pattern_label_becomes_work_with_id() -> None:
    """作業パターン名は assignment_type=WORK、pattern_id は逆引きされる。"""
    patterns = [_pattern(10, "A1"), _pattern(20, "B2")]
    inp = _make_input(patterns)
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("FEASIBLE", MagicMock())
    fake_builder.extract_result.return_value = {
        (1, 1): "A1",
        (1, 2): "B2",
    }

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    by_day = {a.date.day: a for a in assignments}
    assert by_day[1].assignment_type == "WORK"
    assert by_day[1].pattern_id == 10
    assert by_day[2].assignment_type == "WORK"
    assert by_day[2].pattern_id == 20


def test_run_optimizer_unknown_pattern_label_yields_none_pattern_id() -> None:
    """未登録の作業パターン名は WORK だが pattern_id=None（防御的フォールバック）。"""
    inp = _make_input([_pattern(10, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("OPTIMAL", MagicMock())
    fake_builder.extract_result.return_value = {(1, 1): "ZZ_unknown"}

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    a = assignments[0]
    assert a.assignment_type == "WORK"
    assert a.pattern_id is None


def test_run_optimizer_mixed_labels_in_same_result() -> None:
    """同一 extract_result 内に LEAVE / REST / WORK が混在しても正しく振り分く。"""
    inp = _make_input([_pattern(10, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("OPTIMAL", MagicMock())
    fake_builder.extract_result.return_value = {
        (1, 1): "A1",
        (1, 2): "割当休日",
        (1, 3): "●",
        (1, 4): "○",
        (1, 5): "有給",
    }

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    by_day = {a.date.day: a.assignment_type for a in assignments}
    assert by_day == {1: "WORK", 2: "REST", 3: "LEAVE", 4: "LEAVE", 5: "LEAVE"}


def test_run_optimizer_constructs_correct_dates() -> None:
    """day 番号は year/month と組み合わせて date になる。"""
    inp = _make_input([_pattern(1, "A1")])
    fake_builder = MagicMock()
    fake_builder.build_and_solve.return_value = ("OPTIMAL", MagicMock())
    fake_builder.extract_result.return_value = {(1, 30): "A1"}

    with patch.object(adapter, "ShiftModelBuilder", return_value=fake_builder):
        _, assignments = adapter.run_optimizer(inp, schedule_id=1)

    assert assignments[0].date == date(2026, 4, 30)


# ---------------------------------------------------------------------------
# run_diagnosis
# ---------------------------------------------------------------------------

def test_run_diagnosis_delegates_to_cp_sat() -> None:
    """run_diagnosis は cp_sat_model.diagnose_infeasible へそのまま委譲する。"""
    inp = _make_input()
    expected = ["H10: 有給・希望休\n  詳細1", "H1: 作業パターン枠充足"]

    with patch.object(adapter, "diagnose_infeasible", return_value=expected) as mock_diag:
        result = adapter.run_diagnosis(inp)

    assert result == expected
    mock_diag.assert_called_once_with(inp)


def test_run_diagnosis_empty_result() -> None:
    """suspects ゼロ件でも空リストを素直に返す。"""
    inp = _make_input()

    with patch.object(adapter, "diagnose_infeasible", return_value=[]):
        result = adapter.run_diagnosis(inp)

    assert result == []
