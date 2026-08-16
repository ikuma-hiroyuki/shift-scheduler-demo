"""H1 必要人数の範囲指定 (issue #247) の制約テスト。

他制約 (H3 休日数 / H13 group capacity 等) の干渉を避けるため、
_create_variables + _h1_pattern_coverage のみを組み立てて H1 単体を検証する。
pattern_id=4 は make_patterns() の B1。
"""
from ortools.sat.python import cp_model

from app.optimizer.cp_sat_model import DayRequirement, Employee, ShiftModelBuilder
from app.tests.cp_sat_helpers import make_input


def _solve_h1_only(inp, *, partial_mode=False, maximize_pattern=None, minimize=False):
    builder = ShiftModelBuilder(inp, partial_mode=partial_mode)
    builder._create_variables()
    builder._h1_pattern_coverage()
    if maximize_pattern is not None:
        expr = sum(builder.assign[(e.id, 1, maximize_pattern)] for e in inp.employees)
        builder.model.minimize(expr) if minimize else builder.model.maximize(expr)
    elif partial_mode:
        builder.model.maximize(sum(builder._objective_terms))
    solver = cp_model.CpSolver()
    status = solver.solve(builder.model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    return solver, builder


def test_h1_range_upper_bound_caps_assignment():
    """range min=1,max=3。4 名いても上限 max=3 で頭打ち（上限 hard）。"""
    inp = make_input(day_requirements={1: [DayRequirement(4, 1, 3)]})
    solver, builder = _solve_h1_only(inp, maximize_pattern=4)
    assigned = sum(solver.value(builder.assign[(e.id, 1, 4)]) for e in inp.employees)
    assert assigned == 3


def test_h1_range_lower_bound_enforced():
    """range min=2,max=4。最小化しても下限 2 を割れない（下限 hard）。"""
    inp = make_input(day_requirements={1: [DayRequirement(4, 2, 4)]})
    solver, builder = _solve_h1_only(inp, maximize_pattern=4, minimize=True)
    assigned = sum(solver.value(builder.assign[(e.id, 1, 4)]) for e in inp.employees)
    assert assigned == 2


def test_h1_strict_unchanged_when_max_none():
    """regression: max=None は従来どおり assigned == min。maximize でも min ちょうど。"""
    inp = make_input(day_requirements={1: [DayRequirement(4, 2)]})
    solver, builder = _solve_h1_only(inp, maximize_pattern=4)
    assigned = sum(solver.value(builder.assign[(e.id, 1, 4)]) for e in inp.employees)
    assert assigned == 2


def test_h1_range_partial_lower_soft_upper_hard():
    """partial: 1 名のみ。range 2..3 → 下限 soft(shortage 発生)、上限は hard。"""
    single = [Employee(1, "一人", "STAFF", set(range(7)), {1, 2, 3}, True)]
    inp = make_input(employees=single, day_requirements={1: [DayRequirement(4, 2, 3)]})
    solver, builder = _solve_h1_only(inp, partial_mode=True)
    assigned = solver.value(builder.assign[(1, 1, 4)])
    shortage = solver.value(builder.shortage_vars[(1, 4)])
    assert assigned <= 3              # 上限 hard
    assert assigned + shortage >= 2  # 下限 soft（shortage で吸収）
