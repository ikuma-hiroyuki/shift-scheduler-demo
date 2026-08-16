"""テスト用ヘルパー — CSV ファイル不要のミニマル ShiftModelInput ビルダー"""
import calendar

from app.optimizer.cp_sat_model import (
    DayRequirement,
    Employee,
    PatternTrigger,
    ShiftModelInput,
    SpecialAssignmentRule,
    WorkPattern,
)


def make_patterns() -> list[WorkPattern]:
    """テスト用パターン群。

    issue #235 で H3 を == required に変更したことに伴い、H13 (各 group 1 日 1 名)
    のキャパシティ上、4 emp × 22 work-day = 88 emp-work-day を吸収するには
    最低 3 group 必要 (3 × 31 = 93 ≥ 88)。安全マージンで C と D の 2 group を追加。
    A1〜A3 と B1 はそのまま (既存テストの参照名は維持)。
    """
    return [
        WorkPattern(1, "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(2, "A", "A2", 2, "07:00", "20:20"),
        WorkPattern(3, "A", "A3", 1, "07:00", "17:00"),
        WorkPattern(4, "B", "B1", 1, "07:10", "15:00"),
        WorkPattern(5, "C", "C1", 1, "07:00", "15:00"),  # 追加 (issue #235)
        WorkPattern(6, "D", "D1", 1, "07:00", "15:00"),  # 追加 (issue #235)
    ]


def make_employees() -> list[Employee]:
    return [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2},    True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]


def make_day_requirements(num_days: int) -> dict[int, list[DayRequirement]]:
    """全日: B1=1名 必須。A グループは choice_groups または special_assignments で管理。"""
    return {
        d: [DayRequirement(4, 1)]
        for d in range(1, num_days + 1)
    }


def make_input(
    *,
    year: int = 2026,
    month: int = 1,
    employees: list[Employee] | None = None,
    patterns: list[WorkPattern] | None = None,
    day_requirements: dict[int, list[DayRequirement]] | None = None,
    leave_requests: dict[int, dict[int, str]] | None = None,
    choice_groups: list[tuple[list[int], int, int]] | None = None,
    special_assignments: list[SpecialAssignmentRule] | None = None,
    employee_priorities: dict[int, dict[int, int]] | None = None,
    pattern_triggers: list[PatternTrigger] | None = None,
    rest_days_by_role: dict[str, int] | None = None,
) -> ShiftModelInput:
    """issue #235 で `rest_days_by_role` dataclass default が
    `field(default_factory=dict)` に変わるため、helper 側で明示注入の既定値を持つ。
    旧ハードコード default (CHIEF/DEPUTY/STAFF=9, FULLPART=7, MORNINGPART=8) を
    helper の default として再現し、既存テストの後方互換を保つ。
    """
    num_days = calendar.monthrange(year, month)[1]
    pats = patterns if patterns is not None else make_patterns()
    emps = employees if employees is not None else make_employees()
    dreqs = day_requirements if day_requirements is not None else make_day_requirements(num_days)
    rdr = rest_days_by_role if rest_days_by_role is not None else {
        "CHIEF": 9, "DEPUTY": 9, "STAFF": 9, "FULLPART": 7, "MORNINGPART": 8,
    }
    return ShiftModelInput(
        year=year,
        month=month,
        employees=emps,
        patterns=pats,
        day_requirements=dreqs,
        leave_requests=leave_requests or {},
        choice_groups=choice_groups or [],
        special_assignments=special_assignments or [],
        pattern_triggers=pattern_triggers or [],
        employee_priorities=employee_priorities or {},
        rest_days_by_role=rdr,
    )
