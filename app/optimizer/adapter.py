"""
app/optimizer/adapter.py — ShiftModelInput を受け取ってソルバーを実行し
結果を ShiftAssignment レコードのリストに変換する。
"""
from __future__ import annotations

from datetime import date

from ortools.sat.python import cp_model

from app.models.schedule import ShiftAssignment
from app.optimizer.cp_sat_model import (
    ShiftModelBuilder,
    ShiftModelInput,
    compute_capacity_shortage_summary,
    diagnose_infeasible,
    solve_partial,
)
from app.optimizer.types import ShortageRow

_REST_LABELS = {"割当休日", "●", "○", "有給"}
_LEAVE_LABELS = {"●", "○", "有給"}


def run_optimizer(
    inp: ShiftModelInput,
    schedule_id: int,
    time_limit: float = 120.0,
    workers: int = 4,
    solver: cp_model.CpSolver | None = None,
) -> tuple[str, list[ShiftAssignment]]:
    """
    CP-SAT ソルバーを実行して結果を ShiftAssignment リストに変換する。

    Args:
        solver: 外部で生成した CpSolver。``solver.stop_search()`` を別スレッドから
            呼ぶと途中停止できる（cancel 用途）。

    Returns:
        (status_name, assignments)
        status_name: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" など
        assignments: ShiftAssignment のリスト（解なし時は空リスト）
    """
    builder = ShiftModelBuilder(inp)
    status_name, solver = builder.build_and_solve(
        time_limit=time_limit,
        workers=workers,
        solver=solver,
    )

    if status_name not in ("OPTIMAL", "FEASIBLE"):
        return status_name, []

    result = builder.extract_result(solver)

    # pattern_name → pattern_id (DB) の逆引きマップ
    pattern_name_to_id = {p.pattern_name: p.id for p in inp.patterns}

    assignments: list[ShiftAssignment] = []
    for (emp_id, day), label in result.items():
        date_obj = date(inp.year, inp.month, day)
        if label in _REST_LABELS:
            atype = "LEAVE" if label in _LEAVE_LABELS else "REST"
            assignments.append(ShiftAssignment(
                schedule_id=schedule_id,
                employee_id=emp_id,
                date=date_obj,
                assignment_type=atype,
                pattern_id=None,
            ))
        else:
            pid = pattern_name_to_id.get(label)
            assignments.append(ShiftAssignment(
                schedule_id=schedule_id,
                employee_id=emp_id,
                date=date_obj,
                assignment_type="WORK",
                pattern_id=pid,
            ))

    return status_name, assignments


def run_diagnosis(inp: ShiftModelInput) -> list[str]:
    """INFEASIBLE 時に原因制約グループを診断して返す。"""
    return diagnose_infeasible(inp)


def run_capacity_summary(inp: ShiftModelInput) -> list[str]:
    """INFEASIBLE 診断の原因に関わらず、容量ベースで「成立しない日」を列挙する。"""
    return compute_capacity_shortage_summary(inp)


def run_partial_solve(
    inp: ShiftModelInput,
    schedule_id: int,
    time_limit: float = 60.0,
    *,
    solver: cp_model.CpSolver | None = None,
) -> tuple[str, list[ShiftAssignment], list[ShortageRow], list[int]]:
    """H1/H5/H6・H7/H11/H12 を soft 化した部分割当ソルバを実行し、ShiftAssignment
    レコードと不足スロット + 管理職不在日リストを返す。
    決定性のため `random_seed=schedule_id` を渡す (同 schedule の再生成で同一解)。
    外部 solver を渡すと stop_search() による途中停止が可能になる。
    """
    status_name, result, shortages, manager_gap_days = solve_partial(
        inp,
        time_limit=time_limit,
        random_seed=schedule_id,
        solver=solver,
    )
    if status_name not in ("OPTIMAL", "FEASIBLE"):
        return status_name, [], [], []

    pattern_name_to_id = {p.pattern_name: p.id for p in inp.patterns}
    assignments: list[ShiftAssignment] = []
    for (emp_id, day), label in result.items():
        date_obj = date(inp.year, inp.month, day)
        if label in _REST_LABELS:
            atype = "LEAVE" if label in _LEAVE_LABELS else "REST"
            assignments.append(ShiftAssignment(
                schedule_id=schedule_id,
                employee_id=emp_id,
                date=date_obj,
                assignment_type=atype,
                pattern_id=None,
            ))
        else:
            pid = pattern_name_to_id.get(label)
            assignments.append(ShiftAssignment(
                schedule_id=schedule_id,
                employee_id=emp_id,
                date=date_obj,
                assignment_type="WORK",
                pattern_id=pid,
            ))
    return status_name, assignments, shortages, manager_gap_days
