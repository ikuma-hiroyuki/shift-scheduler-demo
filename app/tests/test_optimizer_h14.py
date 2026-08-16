"""H14: 休日前フル番禁止 — adapter.run_optimizer 経由の E2E 統合テスト。

PoC のソルバーが正しく Web 側 (adapter) から呼び出されたときに H14 が効くことを、
実 CP-SAT ソルバーで確認する。DB は使用しない（ShiftModelInput を直接構築）。
"""
from __future__ import annotations

import calendar

from app.optimizer.adapter import run_optimizer
from app.optimizer.cp_sat_model import (
    DayRequirement,
    Employee,
    ShiftModelInput,
    WorkPattern,
)


def _patterns() -> list[WorkPattern]:
    return [
        WorkPattern(1, "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(2, "A", "A2", 2, "07:00", "20:20"),
        WorkPattern(4, "B", "B1", 1, "07:10", "15:00"),
    ]


def _employees() -> list[Employee]:
    return [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2},    True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]


def test_h14_enforced_via_adapter_run_optimizer():
    """run_optimizer 経由で H14 が効くことを確認。
    emp 1 の day 6 を希望休にし、day 5 にフル番 (A2) 必須とする。
    H14 により emp 1 は day 5 で A2 を取れず、別の社員が A2 を取り、
    その社員の day 6 は勤務日 (rest=0) になるはず。"""
    num_days = calendar.monthrange(2026, 1)[1]
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(4, 1)]  # B1 を毎日 1 名
        if d == 5:
            reqs.append(DayRequirement(2, 1))  # A2 (フル番) を day 5 に必須
        dreqs[d] = reqs

    # issue #235: H3 == 制約下、2 group × 31 = 62 max。4 emp × 22 work = 88 > 62。
    # CHIEF=15/DEPUTY=15、STAFF=16 で work 16+16+15+15=62 ぴったり feasible。
    inp = ShiftModelInput(
        year=2026,
        month=1,
        employees=_employees(),
        patterns=_patterns(),
        day_requirements=dreqs,
        leave_requests={1: {6: "●"}},
        choice_groups=[],
        rest_days_by_role={"CHIEF": 15, "DEPUTY": 15, "STAFF": 16,
                           "FULLPART": 16, "MORNINGPART": 16},
    )

    status, assignments = run_optimizer(inp, schedule_id=1, time_limit=5.0, workers=2)
    assert status in ("OPTIMAL", "FEASIBLE"), f"status={status}"

    # day 5 に A2 (pattern_id=2) を取った社員を特定
    a2_day5 = [
        a for a in assignments
        if a.date.day == 5 and a.assignment_type == "WORK" and a.pattern_id == 2
    ]
    assert len(a2_day5) == 1, f"day 5 の A2 割当数 = {len(a2_day5)} (1 のはず)"
    a2_emp_id = a2_day5[0].employee_id
    assert a2_emp_id != 1, (
        "H14 違反: emp 1 は day 6 が ● (希望休 → 翌日休日) のため "
        "day 5 でフル番 A2 を取れないはずだが取得している"
    )

    # H14 の効果として、A2 を取った社員の day 6 は勤務日になっているはず
    next_day = next(
        (a for a in assignments if a.employee_id == a2_emp_id and a.date.day == 6),
        None,
    )
    assert next_day is not None, f"emp={a2_emp_id} の day 6 の割当が見つからない"
    assert next_day.assignment_type == "WORK", (
        f"H14 違反: emp={a2_emp_id} は day 5 に A2 を取ったが "
        f"day 6 が assignment_type={next_day.assignment_type} (WORK のはず)"
    )
