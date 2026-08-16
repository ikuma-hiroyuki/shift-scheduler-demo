"""
app/optimizer/cp_sat_model.py の制約テスト。

ハード制約 H2 / H3 / H5 / H10 / H6 / H7 / H12 / H13 / H14、
ソフト制約 S1 / S2、INFEASIBLE 診断、および統合テストを含む。

旧 poc/tests/test_model.py を移植 (poc 削除に伴う直接テスト復活)。
"""
import calendar
from datetime import date

import pytest

from app.optimizer.cp_sat_model import (
    DayRequirement,
    Employee,
    PatternTrigger,
    ShiftModelBuilder,
    ShiftModelInput,
    SpecialAssignmentRule,
    WorkPattern,
    _detail_leave_conflicts,
    compute_capacity_shortage_summary,
)
from app.tests.cp_sat_helpers import make_input

_TIME_LIMIT = 5.0  # 各テストの最大ソルブ時間（秒）


@pytest.fixture
def tiny_input() -> ShiftModelInput:
    """4名・31日の最小 ShiftModelInput（January 2026）"""
    return make_input()


def solve(inp: ShiftModelInput):
    builder = ShiftModelBuilder(inp)
    status, solver = builder.build_and_solve(time_limit=_TIME_LIMIT, workers=2)
    return status, solver, builder


# ---------------------------------------------------------------------------
# H2: 1人1日1アサイン
# ---------------------------------------------------------------------------

def test_h2_exactly_one_per_day(tiny_input):
    status, solver, builder = solve(tiny_input)
    assert status in ("OPTIMAL", "FEASIBLE")

    for e in tiny_input.employees:
        for d in builder.days:
            total = sum(
                solver.value(builder.assign[(e.id, d, p.id)])
                for p in tiny_input.patterns
            ) + solver.value(builder.rest[(e.id, d)])
            assert total == 1, f"H2 違反: emp={e.id} day={d} total={total}"


# ---------------------------------------------------------------------------
# H3: 月間最低休日数
# ---------------------------------------------------------------------------

def test_h3_monthly_rest_days_bounded(tiny_input):
    """issue #235 cascade B: H3 は `required <= rest <= required + slack`。"""
    from app.optimizer.cp_sat_model import ShiftModelBuilder
    slack = ShiftModelBuilder.REST_DAYS_SLACK
    status, solver, builder = solve(tiny_input)
    assert status in ("OPTIMAL", "FEASIBLE")

    for e in tiny_input.employees:
        rest_count = sum(
            solver.value(builder.rest[(e.id, d)]) for d in builder.days
        )
        required = tiny_input.rest_days_by_role.get(e.role, 9)
        assert required <= rest_count <= required + slack, (
            f"H3 違反: emp={e.id} role={e.role} rest={rest_count} "
            f"not in [{required}, {required + slack}]"
        )


def test_h3_uses_per_role_values_when_provided():
    """issue #235 cascade B: rest_days_by_role の per-role 値が両側 bound を制御。"""
    from app.optimizer.cp_sat_model import ShiftModelBuilder
    slack = ShiftModelBuilder.REST_DAYS_SLACK
    inp = make_input(rest_days_by_role={
        "CHIEF": 10, "DEPUTY": 10, "STAFF": 11, "FULLPART": 7, "MORNINGPART": 8,
    })
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    for e in inp.employees:
        rest_count = sum(
            solver.value(builder.rest[(e.id, d)]) for d in builder.days
        )
        expected = inp.rest_days_by_role[e.role]
        assert expected <= rest_count <= expected + slack, (
            f"H3 違反: emp={e.id} role={e.role} rest={rest_count} "
            f"not in [{expected}, {expected + slack}]"
        )


def test_rest_days_by_role_default_is_empty_dict():
    """issue #235 A2: dataclass default が field(default_factory=dict) で空 dict。
    optimizer 側は .get(role, 9) で defensive fallback で動く。
    """
    from app.optimizer.cp_sat_model import ShiftModelInput

    inp = ShiftModelInput(
        year=2026,
        month=1,
        employees=[],
        patterns=[],
        day_requirements={},
        leave_requests={},
        choice_groups=[],
    )
    # field(default_factory=dict) の確認
    assert inp.rest_days_by_role == {}
    # 旧ハードコード default {"CHIEF": 9, ...} ではないこと
    assert "CHIEF" not in inp.rest_days_by_role


# ---------------------------------------------------------------------------
# H5: 管理職の毎日出勤保証
# ---------------------------------------------------------------------------

def test_h5_manager_present_every_day(tiny_input):
    status, solver, builder = solve(tiny_input)
    assert status in ("OPTIMAL", "FEASIBLE")

    managers = [e for e in tiny_input.employees if e.role in ("CHIEF", "DEPUTY")]
    for d in builder.days:
        manager_work = sum(
            solver.value(builder.assign[(e.id, d, p.id)])
            for e in managers
            for p in tiny_input.patterns
        )
        assert manager_work >= 1, f"H5 違反: 管理職が day={d} に不在"


# ---------------------------------------------------------------------------
# H10: 有給・希望休の強制休日
# ---------------------------------------------------------------------------

def test_h10_leave_forces_rest():
    # CHIEF (id=1) の day 5 に有給を登録
    inp = make_input(leave_requests={1: {5: "有給"}})
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    assert solver.value(builder.rest[(1, 5)]) == 1, "H10 違反: 有給の日が rest=1 になっていない"
    for p in inp.patterns:
        assert solver.value(builder.assign[(1, 5, p.id)]) == 0, (
            f"H10 違反: 有給の日にパターン {p.pattern_name} が割り当てられている"
        )


def test_h10_kibou_is_hard_infeasible_when_all_take_leave():
    """全員が希望休(●)の日は staffing 要件を満たせず INFEASIBLE になること（ハード制約確認）"""
    leave_requests = {1: {5: "●"}, 2: {5: "●"}, 3: {5: "●"}, 4: {5: "●"}}
    inp = make_input(leave_requests=leave_requests)
    status, _, _ = solve(inp)
    assert status == "INFEASIBLE", "希望休ハード制約: 全員●の日は INFEASIBLE のはず"


def test_h10_kari_is_soft_feasible_when_understaffed():
    """全員が仮休(○)の日でも staffing 要件があれば solver が誰かを出勤させること（ソフト制約）"""
    leave_requests = {1: {5: "○"}, 2: {5: "○"}, 3: {5: "○"}, 4: {5: "○"}}
    inp = make_input(leave_requests=leave_requests)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        "仮休ソフト制約: 全員○でも FEASIBLE になるべき（現在ハード制約になっている可能性）"
    )
    # day 5: 誰か 1 人は B1 に割り当てられているはず
    pat_b1 = next(p for p in inp.patterns if p.pattern_name == "B1")
    working_on_day5 = sum(
        solver.value(builder.assign[(e.id, 5, pat_b1.id)])
        for e in inp.employees
    )
    assert working_on_day5 >= 1, "仮休ソフト制約: 人員不足の日には誰かが出勤するべき"


def test_h10_kari_prefers_rest_when_not_needed():
    """仮休(○)の日は staffing が足りる限り本人は休むこと（ペナルティによる優先）"""
    # CHIEF (id=1) だけ仮休 on day 5。残り 3 名で B1=1 を充足できる。
    inp = make_input(leave_requests={1: {5: "○"}})
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")
    chief = next(e for e in inp.employees if e.role == "CHIEF")
    assert solver.value(builder.rest[(chief.id, 5)]) == 1, (
        "仮休ソフト制約: staffing が足りるなら仮休日は本人が休むべき"
    )


# ---------------------------------------------------------------------------
# H6: 特別割当（特定曜日）
# ---------------------------------------------------------------------------

def test_h6_weekday_special_assignment():
    """木曜日（weekday=3）に CHIEF を A3 (id=3) に固定する"""
    year, month = 2026, 1  # 2026-01-01 は木曜日
    rule = SpecialAssignmentRule(
        condition_type="WEEKDAY",
        condition_value=3,   # Thursday
        role="CHIEF",
        pattern_name="A3",
    )
    inp = make_input(year=year, month=month, special_assignments=[rule])
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    chief = next(e for e in inp.employees if e.role == "CHIEF")
    # 1月の木曜日: 1, 8, 15, 22, 29
    thursdays = [
        d for d in range(1, builder.num_days + 1)
        if date(year, month, d).weekday() == 3
    ]
    pat_a3 = next(p for p in inp.patterns if p.pattern_name == "A3")
    for d in thursdays:
        assert solver.value(builder.assign[(chief.id, d, pat_a3.id)]) == 1, (
            f"H6 違反: CHIEF が木曜日 day={d} に A3 でない"
        )


# ---------------------------------------------------------------------------
# H7: 月末ルールが同日の WEEKDAY ルールより優先される
# ---------------------------------------------------------------------------

def test_h7_last_day_overrides_weekday():
    """2026年4月30日（木曜日 = weekday=3）: LAST_DAY(A2) が WEEKDAY(A3) より優先"""
    year, month = 2026, 4  # April 30 is Thursday
    rules = [
        SpecialAssignmentRule("WEEKDAY",  3, "CHIEF", "A3"),
        SpecialAssignmentRule("LAST_DAY", 0, "CHIEF", "A2"),
    ]
    inp = make_input(year=year, month=month, special_assignments=rules)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    last_day = builder.num_days  # 30
    chief = next(e for e in inp.employees if e.role == "CHIEF")
    pat_a2 = next(p for p in inp.patterns if p.pattern_name == "A2")
    pat_a3 = next(p for p in inp.patterns if p.pattern_name == "A3")

    assert solver.value(builder.assign[(chief.id, last_day, pat_a2.id)]) == 1, (
        "H7 違反: 月末=木曜 に LAST_DAY(A2) が優先されていない"
    )
    assert solver.value(builder.assign[(chief.id, last_day, pat_a3.id)]) == 0, (
        "H7 違反: 月末=木曜 に WEEKDAY(A3) が適用されてしまっている"
    )


# ---------------------------------------------------------------------------
# H6/H7: 同日に複数 role のルールが存在する場合は両方発火 (issue #114)
# ---------------------------------------------------------------------------


def test_special_assignment_multiple_roles_same_day():
    """同日に CHIEF と DEPUTY 別々のルールが両方発火する。

    issue #114 で発見: 旧実装は `fired = True; break` で 1 件目のみ発火し
    後続 rule (別 role) を黙殺していた。`fired` を role 単位に分離する修正。
    """
    year, month = 2026, 1  # 2026-01-01 は木曜
    # CHIEF=A3 (Group A), DEPUTY=B1 (Group B) — 異グループに配置することで
    # H13 (1 グループ最大 1 名/日) に抵触しないようにする。
    rules = [
        SpecialAssignmentRule("WEEKDAY", 3, "CHIEF",  "A3"),
        SpecialAssignmentRule("WEEKDAY", 3, "DEPUTY", "B1"),
    ]
    inp = make_input(year=year, month=month, special_assignments=rules)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    chief = next(e for e in inp.employees if e.role == "CHIEF")
    deputy = next(e for e in inp.employees if e.role == "DEPUTY")
    pat_b1 = next(p for p in inp.patterns if p.pattern_name == "B1")
    pat_a3 = next(p for p in inp.patterns if p.pattern_name == "A3")

    thursdays = [
        d for d in range(1, builder.num_days + 1)
        if date(year, month, d).weekday() == 3
    ]
    for d in thursdays:
        assert solver.value(builder.assign[(chief.id, d, pat_a3.id)]) == 1, (
            f"CHIEF が木曜 day={d} に A3 に固定されていない"
        )
        assert solver.value(builder.assign[(deputy.id, d, pat_b1.id)]) == 1, (
            f"DEPUTY が木曜 day={d} に B1 に固定されていない（fired break で黙殺）"
        )


# ---------------------------------------------------------------------------
# S1: 勤務日数公平性
# ---------------------------------------------------------------------------

def test_s1_fairness_minimizes_range():
    """同 role グループで勤務日数の差が小さいこと（range <= 3）"""
    employees = [
        Employee(1, "スタッフA", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(2, "スタッフB", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(3, "主任",     "CHIEF",  set(range(7)), {1, 2},    True),
        Employee(4, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
    ]
    inp = make_input(employees=employees)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    staff = [e for e in inp.employees if e.role == "STAFF"]
    work_days = [
        sum(1 for d in builder.days if solver.value(builder.rest[(e.id, d)]) == 0)
        for e in staff
    ]
    range_days = max(work_days) - min(work_days)
    assert range_days <= 3, (
        f"S1 公平性: STAFF グループの勤務日数 range={range_days} が大きすぎる"
    )


# ---------------------------------------------------------------------------
# S2: 主任・副主任の早番優先
# ---------------------------------------------------------------------------

def test_s2_chief_prefers_early_shift():
    """CHIEF の早番(shift_type=1)日数 >= フル番(shift_type=2)日数"""
    inp = make_input()
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    chief = next(e for e in inp.employees if e.role == "CHIEF")
    early_patterns = [p for p in inp.patterns if p.shift_type == 1]
    full_patterns  = [p for p in inp.patterns if p.shift_type == 2]

    early_days = sum(
        solver.value(builder.assign[(chief.id, d, p.id)])
        for d in builder.days
        for p in early_patterns
    )
    full_days = sum(
        solver.value(builder.assign[(chief.id, d, p.id)])
        for d in builder.days
        for p in full_patterns
    )
    assert early_days >= full_days, (
        f"S2 違反: CHIEF の早番={early_days}日 < フル番={full_days}日"
    )


# ---------------------------------------------------------------------------
# INFEASIBLE: 実現不可能な制約
# ---------------------------------------------------------------------------

def test_infeasible_impossible_requirement():
    """1名しかいないのに同日に同パターンを 2 名要求 → INFEASIBLE"""
    single_emp = [Employee(1, "一人", "STAFF", set(range(7)), {1, 2, 3}, True)]
    # A1 を 2 名必要とするが従業員は 1 名しかいない
    dreqs = {d: [DayRequirement(1, 2)] for d in range(1, 32)}
    inp = make_input(employees=single_emp, day_requirements=dreqs)

    builder = ShiftModelBuilder(inp)
    status, _ = builder.build_and_solve(time_limit=10.0, workers=1)
    assert status == "INFEASIBLE"


# ---------------------------------------------------------------------------
# H10 INFEASIBLE 診断: _detail_leave_conflicts の精度
# ---------------------------------------------------------------------------

def test_detail_leave_conflicts_only_lists_truly_infeasible_days():
    """休み希望が必要枠を超える日のみ列挙する。

    2 名以上の希望休が重なっても、残り従業員で必要枠を満たせる日は
    INFEASIBLE 要因ではないので列挙しない (issue #174 のフォローアップ)。
    """
    # 4 名・全日 B1=1 名必要 (make_input のデフォルト)
    # 1 日: 全 4 名が希望休 → 利用可能 0 < 必要 1 → 列挙される
    # 10 日: emp 1, 2 のみ希望休 → 利用可能 2 >= 必要 1 → 列挙されない
    leave_requests = {
        1: {1: "●", 10: "●"},
        2: {1: "●", 10: "●"},
        3: {1: "●"},
        4: {1: "●"},
    }

    inp = make_input(leave_requests=leave_requests)
    details = _detail_leave_conflicts(inp)

    # 1 日のみ列挙される
    assert len(details) == 1
    assert "1日:" in details[0]
    assert all("10日:" not in d for d in details)


def test_detail_leave_conflicts_skips_single_resting_employee():
    """1 名のみの希望休は同日衝突ではないため列挙しない。"""
    inp = make_input(leave_requests={1: {1: "●"}})
    details = _detail_leave_conflicts(inp)
    assert details == []


def test_detail_leave_conflicts_lists_employee_names_in_message():
    """列挙される日は対象従業員の名前を文言に含む。"""
    leave_requests = {1: {1: "●"}, 2: {1: "●"}, 3: {1: "●"}, 4: {1: "●"}}
    inp = make_input(leave_requests=leave_requests)
    details = _detail_leave_conflicts(inp)
    assert len(details) == 1
    msg = details[0]
    assert "1日:" in msg
    assert "希望休:" in msg
    assert "必要枠" in msg and "利用可能" in msg
    for name in ("主任", "副主任", "スタッフA", "スタッフB"):
        assert name in msg


# issue #194: 容量ベース判定で false negative / false positive を解消
# ---------------------------------------------------------------------------


def test_detail_leave_conflicts_large_store_low_leave_count_no_false_negative():
    """大規模店舗 (10 名・必要枠 9) で 4 名希望休が真の INFEASIBLE 原因の日でも
    旧実装は閾値 max(3, 10*0.25)=3 だったので報告された。新実装は容量ベースで
    available(6) < required(9) を判定すべき。

    旧実装と新実装で同じ結果になるケースだが、容量ベース判定が正しく機能する
    ことの回帰として置く。
    """
    employees = [
        Employee(i, f"E{i}", "STAFF", set(range(7)), {1, 2, 3}, True)
        for i in range(1, 11)
    ]
    # 全日: B1=9 名 必要
    day_requirements = {
        d: [DayRequirement(4, 9)] for d in range(1, 32)
    }
    leave_requests = {1: {5: "●"}, 2: {5: "●"}, 3: {5: "●"}, 4: {5: "●"}}
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    details = _detail_leave_conflicts(inp)
    assert len(details) == 1
    assert "5日:" in details[0]
    # available=6 < required=9 が文言に出る
    assert "9名" in details[0] and "6名" in details[0]


def test_detail_leave_conflicts_small_store_no_false_positive():
    """小規模店 (4 名・必要枠 1) で 3 名重なっても残り 1 名で枠を満たせる日は
    INFEASIBLE 原因ではないので列挙しない (false positive 抑制)。

    旧実装は 3 名閾値で必ず列挙していたが、容量ベース判定では
    available(1) >= required(1) なので除外される。
    """
    leave_requests = {1: {7: "●"}, 2: {7: "●"}, 3: {7: "●"}}
    inp = make_input(leave_requests=leave_requests)  # default: 4 emp, B1=1
    details = _detail_leave_conflicts(inp)
    assert details == [], (
        "小規模店で残り従業員で必要枠を満たせる日は false positive で列挙してはいけない"
    )


def test_detail_leave_conflicts_capacity_boundary():
    """available == required の境界 (利用可能 = 必要) では INFEASIBLE 原因では
    ないので列挙しない。available < required の 1 名差から列挙される。"""
    # 4 名・B1=2 必要
    day_requirements = {d: [DayRequirement(4, 2)] for d in range(1, 32)}
    # 10日: 1 名希望休 → available=3 >= 2 → 除外
    # 11日: 2 名希望休 → available=2 == 2 → 除外 (境界)
    # 12日: 3 名希望休 → available=1 < 2 → 列挙
    leave_requests = {
        1: {10: "●", 11: "●", 12: "●"},
        2: {11: "●", 12: "●"},
        3: {12: "●"},
    }
    inp = make_input(day_requirements=day_requirements, leave_requests=leave_requests)
    details = _detail_leave_conflicts(inp)
    assert len(details) == 1
    assert "12日:" in details[0]


# ---------------------------------------------------------------------------
# compute_capacity_shortage_summary: 容量ベース「不足日サマリ」
# INFEASIBLE 診断の原因ラベルに関わらず常時計算され、希望休/有給/勤務不可曜日の
# 内訳付きで列挙する。
# ---------------------------------------------------------------------------


def test_compute_capacity_shortage_summary_lists_only_infeasible_days():
    """available < required の日のみ列挙する。境界 (available >= required) は除外。"""
    # 4 名・B1=1 必要
    # 1 日: 4 名希望休 → available=0 < 1 → 列挙
    # 10 日: 2 名希望休 → available=2 >= 1 → 除外
    leave_requests = {
        1: {1: "●"},
        2: {1: "●", 10: "●"},
        3: {1: "●", 10: "●"},
        4: {1: "●"},
    }
    inp = make_input(leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    assert len(lines) == 1
    assert "1日" in lines[0]
    assert all("10日" not in line for line in lines)


def test_compute_capacity_shortage_summary_returns_empty_when_capacity_ok():
    """すべての日で容量を満たす場合は空リストを返す。"""
    inp = make_input()  # 4 名・B1=1、休み希望なし → 全日 available=4 >= 1
    lines = compute_capacity_shortage_summary(inp)
    assert lines == []


def test_compute_capacity_shortage_summary_breakdown_kibo_yukyu_weekday():
    """内訳: 希望休・有給・勤務不可曜日の 3 区分を併記する。"""
    # 5 名・B1=4 必要
    # emp5: available_days={0,1,2,3,4} (土=5・日=6 は勤務不可)
    employees = [
        Employee(1, "E1", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(2, "E2", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(3, "E3", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(4, "E4", "STAFF", set(range(7)), {1, 2, 3}, True),
        Employee(5, "E5", "STAFF", {0, 1, 2, 3, 4}, {1, 2, 3}, True),
    ]
    # 全日: B1=4 必要
    day_requirements = {d: [DayRequirement(4, 4)] for d in range(1, 32)}
    # 2026-01-03 = 土曜 (weekday=5) → emp5 が勤務不可
    # 1/3: emp1, emp2 希望休, emp3 有給, emp5 曜日不可 → available=1
    leave_requests = {
        1: {3: "●"},
        2: {3: "●"},
        3: {3: "有給"},
    }
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    # 1/3 のみ列挙されること
    target = [line for line in lines if "3日" in line]
    assert len(target) == 1
    msg = target[0]
    assert "希望休2名" in msg
    assert "有給1名" in msg
    assert "勤務不可曜日1名" in msg
    assert "必要枠4名" in msg
    assert "利用可能1名" in msg


def test_compute_capacity_shortage_summary_kari_kyu_counted_as_available():
    """仮休「○」はソフト制約のため available 側に含める (引かない)。"""
    # 4 名・B1=2 必要
    day_requirements = {d: [DayRequirement(4, 2)] for d in range(1, 32)}
    # 1日: 3 名希望休 ● → available=1 < 2 → 列挙
    # 2日: 3 名仮休 ○ → available=4 >= 2 → 除外
    leave_requests = {
        1: {1: "●", 2: "○"},
        2: {1: "●", 2: "○"},
        3: {1: "●", 2: "○"},
    }
    inp = make_input(day_requirements=day_requirements, leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    assert any("1日" in line for line in lines), "希望休 ● の日は列挙される"
    assert all("2日" not in line for line in lines), "仮休 ○ のみの日は列挙されない"


def test_compute_capacity_shortage_summary_weekday_label_present():
    """出力に曜日表記 (月火水木金土日) が含まれる。"""
    # 2026-01-01 = 木曜
    leave_requests = {1: {1: "●"}, 2: {1: "●"}, 3: {1: "●"}, 4: {1: "●"}}
    inp = make_input(leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    assert len(lines) == 1
    assert "1日(木)" in lines[0]


def test_compute_capacity_shortage_summary_reproduces_14_emp_7_kibo_on_day10():
    """実例再現: 14 名・10日に 7 名希望休 → 必要枠 8 名 > 利用可能 7 名 で列挙。

    画像で報告された症状 (渡辺健太・高橋美咲・中村大輔・小林由美・加藤翔太・伊藤花子・
    田中一郎 の 7 名が同一日に ● を集中) を抽象化した最小再現テスト。
    """
    employees = [
        Employee(i, f"E{i}", "STAFF", set(range(7)), {1, 2}, True)
        for i in range(1, 15)
    ]
    # 全日: B1=8 必要
    day_requirements = {d: [DayRequirement(4, 8)] for d in range(1, 32)}
    # 1..7 番の従業員が 10 日に ● → available=14-7=7 < 8
    leave_requests = {i: {10: "●"} for i in range(1, 8)}
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    target = [line for line in lines if "10日" in line]
    assert len(target) == 1, f"10日が列挙されるべき。出力: {lines}"
    msg = target[0]
    assert "希望休7名" in msg
    assert "必要枠8名" in msg
    assert "利用可能7名" in msg


def test_compute_capacity_shortage_summary_wariatekyu_counted_as_available():
    """「割当休日」ラベルは loader フォールバック値であり、H10 でも無視されるため
    available 側に含める (現状仕様の固定)。"""
    day_requirements = {d: [DayRequirement(4, 4)] for d in range(1, 32)}
    leave_requests = {
        1: {1: "割当休日"},
        2: {1: "割当休日"},
        3: {1: "割当休日"},
    }
    inp = make_input(day_requirements=day_requirements, leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    # 4 名・必要枠 4・「割当休日」3 件 → available=4 >= 4 → 列挙されない
    assert all("1日" not in line for line in lines), (
        f"「割当休日」ラベルは available 側に含めるため列挙してはならない。出力: {lines}"
    )


def test_compute_capacity_shortage_summary_handles_leap_february():
    """2024 年 2 月 (うるう年) で 29 日に shortage が発生する場合に正しく列挙される。"""
    # 4 名・全日 B1=1 必要、2/29 に全 4 名 ● → available=0 < 1
    leave_requests = {i: {29: "●"} for i in range(1, 5)}
    inp = make_input(year=2024, month=2, leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    assert any("29日" in line for line in lines), (
        f"うるう年 2/29 が列挙されるべき。出力: {lines}"
    )


def test_compute_capacity_shortage_summary_no_breakdown_when_pure_headcount_shortage():
    """純粋な人手不足 (希望休/有給/勤務不可曜日いずれも 0) の日は括弧なしフォーマット。"""
    # 3 名・必要枠 5、休み希望なし → available=3 < 5、breakdown は空
    employees = [
        Employee(i, f"E{i}", "STAFF", set(range(7)), {1, 2}, True)
        for i in range(1, 4)
    ]
    day_requirements = {d: [DayRequirement(4, 5)] for d in range(1, 32)}
    inp = make_input(employees=employees, day_requirements=day_requirements)
    lines = compute_capacity_shortage_summary(inp)
    assert len(lines) >= 1
    # 内訳が空のときは括弧部分を出さない
    assert all("(" not in line.split(": ", 1)[1] for line in lines), (
        f"内訳 0 件の日は括弧を出さない。実際: {lines[0]}"
    )


def test_compute_capacity_shortage_summary_lists_multiple_days_in_ascending_order():
    """複数日 shortage が発生する場合、日付昇順で列挙される。"""
    day_requirements = {d: [DayRequirement(4, 4)] for d in range(1, 32)}
    # 5日と20日にそれぞれ全 4 名希望休
    leave_requests = {
        i: {5: "●", 20: "●"} for i in range(1, 5)
    }
    inp = make_input(day_requirements=day_requirements, leave_requests=leave_requests)
    lines = compute_capacity_shortage_summary(inp)
    assert len(lines) == 2
    assert "5日" in lines[0] and "20日" in lines[1]


def test_compute_capacity_shortage_summary_handles_empty_employees():
    """employees=[] の境界: 例外を出さず、必要枠 > 0 の日を列挙する。"""
    day_requirements = {d: [DayRequirement(4, 1)] for d in range(1, 32)}
    inp = make_input(employees=[], day_requirements=day_requirements)
    lines = compute_capacity_shortage_summary(inp)
    # 31 日すべてで available=0 < 1
    assert len(lines) == 31


def test_compute_capacity_shortage_summary_detects_manager_coverage_gap_only():
    """容量は足りていても、管理職(CHIEF/DEPUTY)全員が休み希望なら列挙する (H5 違反候補)。

    実例再現: 14 名・必要枠 4・10日に 8 名休み (うち CHIEF+DEPUTY 両者) → 残り 6 名で
    容量は足りるが、管理職がいない日として列挙されるべき。
    """
    employees = [
        Employee(1, "田中一郎", "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(2, "伊藤花子", "CHIEF", set(range(7)), {1, 2}, True),
    ] + [
        Employee(i, f"S{i}", "STAFF", set(range(7)), {1, 2}, True)
        for i in range(3, 15)
    ]
    day_requirements = {d: [DayRequirement(4, 4)] for d in range(1, 32)}
    # 10日: emp 1 (DEPUTY) + emp 2 (CHIEF) + 5 名のスタッフ ● → 7 名休み, 7 名 available, 必要枠 4
    leave_requests = {i: {10: "●"} for i in range(1, 8)}
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    target = [line for line in lines if "10日" in line]
    assert len(target) == 1, f"10日が列挙されるべき。出力: {lines}"
    msg = target[0]
    assert "管理職全員休み" in msg
    assert "田中一郎" in msg and "伊藤花子" in msg


def test_compute_capacity_shortage_summary_combines_capacity_and_manager_gap():
    """同一日に容量不足 + 管理職全員休みが両方発生する場合、両方の情報を出す。"""
    employees = [
        Employee(1, "DEP", "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(2, "CHI", "CHIEF", set(range(7)), {1, 2}, True),
        Employee(3, "S1", "STAFF", set(range(7)), {1, 2}, True),
    ]
    day_requirements = {d: [DayRequirement(4, 2)] for d in range(1, 32)}
    # 5日: emp1 (DEPUTY) + emp2 (CHIEF) ● → 1 available < 2 必要 (容量不足) + 管理職全員不在
    leave_requests = {1: {5: "●"}, 2: {5: "●"}}
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    target = [line for line in lines if "5日" in line]
    assert len(target) == 1, f"5日が列挙されるべき。出力: {lines}"
    msg = target[0]
    assert "必要枠2名" in msg and "利用可能1名" in msg
    assert "管理職全員休み" in msg


def test_compute_capacity_shortage_summary_manager_kari_kyu_does_not_trigger_gap():
    """管理職全員が「○」(仮休) のみの日は H5 ソフト制約で出勤に変更可能なため、
    manager_gap として列挙してはいけない。

    対照: 「●」/「有給」 (HARD rest) なら列挙される。本テストは HARD/SOFT の
    区別が正しいことを保証する。
    """
    employees = [
        Employee(1, "DEP", "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(2, "CHI", "CHIEF", set(range(7)), {1, 2}, True),
        Employee(3, "S1", "STAFF", set(range(7)), {1, 2}, True),
        Employee(4, "S2", "STAFF", set(range(7)), {1, 2}, True),
    ]
    day_requirements = {d: [DayRequirement(4, 1)] for d in range(1, 32)}
    # 5日: 管理職両者「○」のみ → ソフト制約のため列挙されない
    # 6日: 管理職両者「●」 → HARD rest のため列挙される (対照)
    leave_requests = {
        1: {5: "○", 6: "●"},
        2: {5: "○", 6: "●"},
    }
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    assert all("5日" not in line for line in lines), (
        f"仮休 ○ のみの日は manager_gap として列挙してはいけない。出力: {lines}"
    )
    assert any("6日" in line and "管理職全員休み" in line for line in lines), (
        f"HARD rest ● は manager_gap として列挙される。出力: {lines}"
    )


def test_compute_capacity_shortage_summary_no_manager_gap_when_only_one_manager_role():
    """管理職が 1 名のみの店舗では、管理職全員不在判定は無効 (元の _detail_manager_coverage_gaps と整合)。"""
    employees = [
        Employee(1, "CHI", "CHIEF", set(range(7)), {1, 2}, True),  # 管理職 1 名のみ
        Employee(2, "S1", "STAFF", set(range(7)), {1, 2}, True),
        Employee(3, "S2", "STAFF", set(range(7)), {1, 2}, True),
        Employee(4, "S3", "STAFF", set(range(7)), {1, 2}, True),
    ]
    day_requirements = {d: [DayRequirement(4, 1)] for d in range(1, 32)}
    # 10日: CHIEF のみ ● → 容量足りる (3 available >= 1)、管理職が 1 名しかいないので gap 判定無効
    leave_requests = {1: {10: "●"}}
    inp = make_input(
        employees=employees,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
    )
    lines = compute_capacity_shortage_summary(inp)
    assert all("10日" not in line for line in lines), (
        f"管理職 1 名のみの店舗では 10 日を列挙してはいけない。出力: {lines}"
    )


def test_run_capacity_summary_delegates_to_compute():
    """adapter.run_capacity_summary は compute_capacity_shortage_summary に委譲する。"""
    from app.optimizer.adapter import run_capacity_summary
    leave_requests = {i: {1: "●"} for i in range(1, 5)}
    inp = make_input(leave_requests=leave_requests)
    assert run_capacity_summary(inp) == compute_capacity_shortage_summary(inp)


def test_diagnose_groups_use_user_facing_labels():
    """diagnose_infeasible 内部の groups ラベルが内部コード (H1, H10 等) を含まない。

    ユーザー向けには「作業パターン枠充足」ではなく「シフト枠の必要人数」のような
    平易な文言を出す方針 (issue #174 のフォロー)。groups 定義のソースを検査して
    内部コード prefix を排除し続けることを保証する。
    """
    import inspect
    from app.optimizer import cp_sat_model

    src = inspect.getsource(cp_sat_model.diagnose_infeasible)
    forbidden = ("H1:", "H3:", "H4:", "H5:", "H6", "H7", "H9:", "H10:", "H11:", "H12:", "H13:", "H14:")
    for code in forbidden:
        assert code not in src, (
            f"diagnose_infeasible のラベルに内部コード {code!r} が残っている。"
            "ユーザー向け文言に置き換えてください。"
        )


# ---------------------------------------------------------------------------
# 統合テスト: 最小モデルで OPTIMAL
# ---------------------------------------------------------------------------

def test_integration_minimal_model_is_optimal():
    """4名・B1=1名の最小モデルが OPTIMAL で完了すること"""
    inp = make_input()
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"ステータス: {status}"

    # 全員分の全日が埋まっていること
    result = builder.extract_result(solver)
    for e in inp.employees:
        for d in builder.days:
            assert (e.id, d) in result, f"(emp={e.id}, day={d}) が結果に存在しない"


# ---------------------------------------------------------------------------
# H12: PatternTrigger（補助ポジション発生条件）
# ---------------------------------------------------------------------------

def _make_h12_patterns() -> list[WorkPattern]:
    """H12 テスト用パターンセット: A, B, C(補助), D, E グループ"""
    return [
        WorkPattern(1,  "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(4,  "B", "B1", 1, "07:10", "15:00"),
        WorkPattern(7,  "C", "C",  3, "10:00", "20:20"),
        WorkPattern(8,  "D", "D1", 1, "07:30", "15:30"),
        WorkPattern(10, "E", "E",  1, "07:30", "15:30"),
    ]


def test_h12_c_blocked_when_b_absent():
    """B グループが存在しない日に C を要求 → INFEASIBLE（H12 トリガー違反）"""
    patterns = _make_h12_patterns()
    num_days = calendar.monthrange(2026, 1)[1]
    # 全日: C=1（必須）、A1=1 だが B/D/E の要件なし
    dreqs = {
        d: [DayRequirement(7, 1), DayRequirement(1, 1)]
        for d in range(1, num_days + 1)
    }
    # 従業員 2 名では B/D/E を同時に満たしながら C を使う人員が足りない
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2, 3}, True),
    ]
    trigger = PatternTrigger(
        auxiliary_group_name="C",
        required_group_names=["B", "D", "E"],
    )
    inp = make_input(
        employees=employees,
        patterns=patterns,
        day_requirements=dreqs,
        pattern_triggers=[trigger],
    )
    builder = ShiftModelBuilder(inp)
    status, _ = builder.build_and_solve(time_limit=15.0, workers=1)
    # C は B/D/E 全員埋まり時のみ使用可能だが、B/D/E の要件がなく
    # かつ従業員 2 名では C + B + D + E を同時に充足できないため INFEASIBLE
    assert status == "INFEASIBLE"


def test_h12_c_feasible_when_bde_present():
    """B, D, E が全日充足される状況で C も使用 → FEASIBLE、かつ C 使用日は必ず B も使用"""
    patterns = _make_h12_patterns()
    num_days = calendar.monthrange(2026, 1)[1]
    # 全日: A1=1, B1=1, C=1, D1=1, E=1 が必要
    dreqs = {
        d: [
            DayRequirement(1,  1),  # A1
            DayRequirement(4,  1),  # B1
            DayRequirement(7,  1),  # C
            DayRequirement(8,  1),  # D1
            DayRequirement(10, 1),  # E
        ]
        for d in range(1, num_days + 1)
    }
    # 1 CHIEF + 1 DEPUTY + 6 STAFF = 8名
    # H5（管理職毎日出勤）充足のため CHIEF/DEPUTY を含む
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフ3", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフ4", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(5, "スタッフ5", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(6, "スタッフ6", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(7, "スタッフ7", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(8, "スタッフ8", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    trigger = PatternTrigger(
        auxiliary_group_name="C",
        required_group_names=["B", "D", "E"],
    )
    # issue #235: H3 == 制約下。5 group × 31 = 155 max emp-day。demand 5 group × 31
    # = 155 ぴったり。work 合計を 155 にする rest 設定: CHIEF=14, DEPUTY=13, STAFF=11
    # → work 17+18+20×6 = 155。H5 (CHIEF+DEPUTY rest=27 ≤ 31) OK。
    inp = make_input(
        employees=employees,
        patterns=patterns,
        day_requirements=dreqs,
        pattern_triggers=[trigger],
        rest_days_by_role={"CHIEF": 14, "DEPUTY": 13, "STAFF": 11,
                           "FULLPART": 11, "MORNINGPART": 11},
    )
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"ステータス: {status}"

    # C が使われている全日で、B グループも使われていることを検証
    b_pids = {p.id for p in patterns if p.group_name == "B"}
    c_pids = {p.id for p in patterns if p.group_name == "C"}
    for d in builder.days:
        c_used = any(
            solver.value(builder.assign[(e.id, d, pid)]) == 1
            for e in employees
            for pid in c_pids
            if (e.id, d, pid) in builder.assign
        )
        b_used = any(
            solver.value(builder.assign[(e.id, d, pid)]) == 1
            for e in employees
            for pid in b_pids
            if (e.id, d, pid) in builder.assign
        )
        if c_used:
            assert b_used, f"H12 違反: day={d} に C が使われているが B グループが不在"


# ---------------------------------------------------------------------------
# H13: 各作業パターングループは 1 日に最大 1 名まで
# ---------------------------------------------------------------------------

def test_h13_group_exclusivity_infeasible():
    """A グループに A1=1 + A3=1 を毎日要求 → グループ合計=2 → H13 により INFEASIBLE"""
    patterns = [
        WorkPattern(1, "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(2, "A", "A3", 1, "07:00", "17:00"),
        WorkPattern(3, "B", "B1", 1, "07:10", "15:00"),
    ]
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1}, True),
        Employee(3, "スタッフ", "STAFF", set(range(7)), {1}, True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    # A1=1 かつ A3=1 を毎日要求 → グループ A の合計=2 → H13 違反
    dreqs = {
        d: [DayRequirement(1, 1), DayRequirement(2, 1), DayRequirement(3, 1)]
        for d in range(1, num_days + 1)
    }
    inp = make_input(employees=employees, patterns=patterns, day_requirements=dreqs)
    status, _, _ = solve(inp)
    assert status == "INFEASIBLE", f"H13 が機能していない: {status}"


def test_h13_group_exclusivity_feasible():
    """A グループで 1 日 1 名のみ使用 — 解を検証してグループ合計が 1 以下であること"""
    patterns = [
        WorkPattern(1, "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(2, "A", "A2", 2, "07:00", "20:20"),
        WorkPattern(3, "B", "B1", 1, "07:10", "15:00"),
    ]
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(3, "スタッフ1", "STAFF",  set(range(7)), {1, 2}, True),
        Employee(4, "スタッフ2", "STAFF",  set(range(7)), {1, 2}, True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    # A1 か A2 の どちらかを 1 名、B1=1 が毎日必要
    dreqs = {d: [DayRequirement(3, 1)] for d in range(1, num_days + 1)}
    choice_groups = [([1, 2], 1, 1, None)]  # A グループから 1 名（毎日適用）
    # issue #235: H3 == 制約下、2 group × 31 = 62 max。CHIEF/DEPUTY=15、STAFF=16 で
    # work 16+16+15+15=62 ぴったり feasible。H5 (CHIEF+DEPUTY union 31) も満たす。
    inp = make_input(
        employees=employees,
        patterns=patterns,
        day_requirements=dreqs,
        choice_groups=choice_groups,
        rest_days_by_role={"CHIEF": 15, "DEPUTY": 15, "STAFF": 16,
                           "FULLPART": 16, "MORNINGPART": 16},
    )
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"ステータス: {status}"

    # 全日でグループ A の合計が 1 以下であることを確認
    a1_id, a2_id = 1, 2
    for d in builder.days:
        a1_count = sum(
            solver.value(builder.assign[(e.id, d, a1_id)])
            for e in employees if (e.id, d, a1_id) in builder.assign
        )
        a2_count = sum(
            solver.value(builder.assign[(e.id, d, a2_id)])
            for e in employees if (e.id, d, a2_id) in builder.assign
        )
        assert a1_count + a2_count <= 1, (
            f"H13 違反: day={d} にグループ A が {a1_count + a2_count} 名配置"
        )


# ---------------------------------------------------------------------------
# H14: 休日前フル番禁止
#       翌日が休日 (rest=1) の場合、当日 shift_type=2 のパターンを禁止する
# ---------------------------------------------------------------------------

def test_h14_blocks_fullshift_before_kibou():
    """emp 1 (CHIEF) のみフル番可。day 5 に A2 必須 + emp 1 day 6 = ● → INFEASIBLE。
    emp 1 が day 5 で A2 を取らざるを得ないが、翌日 day 6 が希望休のため H14 で禁止される。"""
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1},    True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1},    True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1},    True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(4, 1)]  # B1 (shift_type=1)
        if d == 5:
            reqs.append(DayRequirement(2, 1))  # A2 (フル番)
        dreqs[d] = reqs
    inp = make_input(
        employees=employees,
        day_requirements=dreqs,
        leave_requests={1: {6: "●"}},
    )
    status, _, _ = solve(inp)
    assert status == "INFEASIBLE", (
        "H14: emp 1 が day 5 で A2 必須 + day 6 が ● (希望休) → 翌日休日のため当日フル番禁止 → INFEASIBLE のはず"
    )


def test_h14_invariant_rest_implies_no_full_prev():
    """解全体で『翌日が rest=1 の前日』にフル番(shift_type=2)が無いことを検証。
    leave_requests + 自動配置 (割当休日) どちらの休日も対象になることを確認。"""
    inp = make_input(leave_requests={1: {6: "●"}, 3: {15: "有給"}})
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"status={status}"

    full_pids = [p.id for p in inp.patterns if p.shift_type == 2]
    days = builder.days
    for e in inp.employees:
        for idx, d in enumerate(days[:-1]):
            d_next = days[idx + 1]
            if solver.value(builder.rest[(e.id, d_next)]) != 1:
                continue
            for pid in full_pids:
                assigned = solver.value(builder.assign[(e.id, d, pid)])
                assert assigned == 0, (
                    f"H14 違反: emp={e.id} day={d} (翌日 day={d_next} が休日) に "
                    f"フル番 pid={pid} が割り当てられている"
                )


def test_h14_last_day_fullshift_allowed():
    """月末日のフル番は H14 適用外（翌月参照不要）。月末 A2 必須でも FEASIBLE になること。"""
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2},    True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(4, 1)]
        if d == num_days:
            reqs.append(DayRequirement(2, 1))  # A2 を月末日に必須
        dreqs[d] = reqs
    inp = make_input(employees=employees, day_requirements=dreqs)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"月末日のフル番は許可されるべき (status={status})"
    )
    a2_total = sum(
        solver.value(builder.assign[(e.id, num_days, 2)])
        for e in employees
    )
    assert a2_total == 1, f"月末 A2 必須が満たされていない (count={a2_total})"


def test_h14_does_not_block_when_next_is_workday():
    """翌日が通常勤務なら制約は発火せず、フル番が割り当てられること。
    ネガティブ: A2 を取った社員の翌日が必ず rest=0 となること。"""
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2},    True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(4, 1)]
        if d == 5:
            reqs.append(DayRequirement(2, 1))  # A2 を day 5 に必須
        dreqs[d] = reqs
    inp = make_input(employees=employees, day_requirements=dreqs)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"status={status}"

    a2_emp = next(
        (e for e in employees if solver.value(builder.assign[(e.id, 5, 2)]) == 1),
        None,
    )
    assert a2_emp is not None, "day 5 に A2 が割り当てられていない（テスト前提崩れ）"
    assert solver.value(builder.rest[(a2_emp.id, 6)]) == 0, (
        f"emp={a2_emp.id} が day 5 に A2 を取ったが翌日 day 6 が rest=1 → H14 違反"
    )


def test_h14_kari_switched_to_work_allows_prev_fullshift():
    """仮休 (○) が staffing 不足で出勤化された日 → 翌日 rest=0 となるため
    当日のフル番が許可されること。H14 が leave_requests 静的判定ではなく
    rest 変数連動 (動的) で動作することを確認する。

    シナリオ: emp 1 (CHIEF, フル番可) day 6 = ○、emp 2/3/4 全員 day 6 = ●。
    H10 で emp 2/3/4 は rest 強制、staffing (B1=1) のため emp 1 が出勤せざるを得ない。
    結果 emp 1 day 6 rest=0 → H14 は emp 1 day 5 の A2 を許可するはず。"""
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1},    True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1},    True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1},    True),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(4, 1)]  # B1=1
        if d == 5:
            reqs.append(DayRequirement(2, 1))  # A2 (フル番) 必須
        dreqs[d] = reqs
    leave_requests = {
        1: {6: "○"},  # 仮休 (ソフト)
        2: {6: "●"},  # 希望休 (ハード)
        3: {6: "●"},
        4: {6: "●"},
    }
    inp = make_input(
        employees=employees,
        day_requirements=dreqs,
        leave_requests=leave_requests,
    )
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"status={status}"

    # 前提: emp 1 は ○ だが staffing 不足のため出勤化される
    assert solver.value(builder.rest[(1, 6)]) == 0, (
        "前提崩れ: emp 1 day 6 が ○ で他全員 ● → staffing 充足のため出勤するはず"
    )
    # H14 動的判定: emp 1 day 6 が出勤 (rest=0) → 当日 day 5 のフル番 A2 許可
    assert solver.value(builder.assign[(1, 5, 2)]) == 1, (
        "H14: emp 1 day 6 が出勤化 (rest=0) → day 5 の A2 (フル番) が "
        "rest 変数連動の含意制約で許可されるはず"
    )


# ---------------------------------------------------------------------------
# 木曜日 C 必発ルール（day_templates.csv: weekday=3, C=1）
# ---------------------------------------------------------------------------

def test_thursday_c_always_present():
    """木曜日に C=1 を要求し、かつ H12 トリガーで B・D・E も必発となることを検証"""
    # 2026-01 の木曜: 1, 8, 15, 22, 29 日
    year, month = 2026, 1
    num_days = calendar.monthrange(year, month)[1]

    patterns = [
        WorkPattern(1,  "A", "A1", 1, "07:00", "15:30"),
        WorkPattern(4,  "B", "B1", 1, "07:10", "15:00"),
        WorkPattern(7,  "C", "C",  3, "10:00", "20:20"),
        WorkPattern(8,  "D", "D1", 1, "07:30", "15:30"),
        WorkPattern(10, "E", "E",  1, "07:30", "15:30"),
    ]

    # 全日: A1=1, B1=1 を基本要件として確保。木曜のみ C=1, D1=1, E=1 を追加
    thursdays = {
        d for d in range(1, num_days + 1)
        if date(year, month, d).weekday() == 3
    }
    dreqs: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        reqs = [DayRequirement(1, 1), DayRequirement(4, 1)]
        if d in thursdays:
            reqs += [DayRequirement(7, 1), DayRequirement(8, 1), DayRequirement(10, 1)]
        dreqs[d] = reqs

    # 1 CHIEF + 1 DEPUTY + 6 STAFF = 8名（木曜: 5ポジション同時充足に十分）
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフ3", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフ4", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(5, "スタッフ5", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(6, "スタッフ6", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(7, "スタッフ7", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(8, "スタッフ8", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    trigger = PatternTrigger(auxiliary_group_name="C", required_group_names=["B", "D", "E"])
    # issue #235: H3 == 制約下、5 group × 31 = 155 max。8 emp × 22 = 176 > 155。
    # CHIEF=15/DEPUTY=16/STAFF=12 で rest 103、work 145 ≤ 155 で feasible。
    inp = make_input(
        year=year, month=month,
        employees=employees,
        patterns=patterns,
        day_requirements=dreqs,
        pattern_triggers=[trigger],
        rest_days_by_role={"CHIEF": 15, "DEPUTY": 16, "STAFF": 12,
                           "FULLPART": 12, "MORNINGPART": 12},
    )
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE"), f"ステータス: {status}"

    c_pids  = {p.id for p in patterns if p.group_name == "C"}
    b_pids  = {p.id for p in patterns if p.group_name == "B"}
    de_pids = {p.id for p in patterns if p.group_name in ("D", "E")}

    def group_count(d: int, pids: set[int]) -> int:
        return sum(
            solver.value(builder.assign[(e.id, d, pid)])
            for e in employees
            for pid in pids
            if (e.id, d, pid) in builder.assign
        )

    for d in thursdays:
        c_cnt = group_count(d, c_pids)
        assert c_cnt == 1, f"木曜 day={d}: C={c_cnt}（1 必須）"
        for gname, pids in (("B", b_pids), ("D/E", de_pids)):
            assert group_count(d, pids) >= 1, f"木曜 day={d}: {gname} が不在（H12 違反）"


# ---------------------------------------------------------------------------
# H15: 最大連勤数（consecutive_workable=True）/ S4 凸ペナルティ / S5 線形ペナルティ
# ---------------------------------------------------------------------------


def _max_consecutive_work_run(rests: list[int]) -> int:
    """rest=0 の連続区間の最大長を返す（連続勤務日数）。"""
    longest = current = 0
    for r in rests:
        if r == 0:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def test_h15_consecutive_workable_true_caps_at_6_days():
    """consecutive_workable=True の従業員は最大 6 連勤に収まる。"""
    employees = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    inp = make_input(employees=employees)
    status, solver, builder = solve(inp)
    assert status in ("OPTIMAL", "FEASIBLE")

    for e in employees:
        rests = [solver.value(builder.rest[(e.id, d)]) for d in builder.days]
        run = _max_consecutive_work_run(rests)
        assert run <= 6, f"emp={e.id} ({e.name}) で {run} 連勤発生（H15 違反）"


def test_h15_does_not_apply_to_consecutive_workable_false():
    """consecutive_workable=False の従業員には H15 hard cap は適用されない（S5 のみで抑制）。

    実際の挙動として、線形 -2/ペアの S5 ペナルティのみで最適化されるため、
    通常は短い連勤に集まるが、6 連勤超のシナリオも構造上は許容される。
    本テストでは「hard cap が無いこと」を、H15 メソッドが False の従業員に
    対してまったく BoolOr 制約を作らないという形で確認する（モデル比較）。
    """
    from app.optimizer.cp_sat_model import ShiftModelBuilder

    emps_all_false = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2, 3}, False),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, False),
        Employee(3, "スタッフ", "STAFF",  set(range(7)), {1, 2, 3}, False),
        Employee(4, "スタッフ", "STAFF",  set(range(7)), {1, 2, 3}, False),
    ]
    emps_all_true = [
        Employee(1, "主任",     "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",   "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフ", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフ", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]

    builder_false = ShiftModelBuilder(make_input(employees=emps_all_false))
    builder_false._create_variables()
    builder_false._h15_max_consecutive_workdays()
    proto_false = builder_false.model.proto

    builder_true = ShiftModelBuilder(make_input(employees=emps_all_true))
    builder_true._create_variables()
    builder_true._h15_max_consecutive_workdays()
    proto_true = builder_true.model.proto

    # False の従業員には H15 制約が一切追加されないため、proto.constraints は空
    assert len(proto_false.constraints) == 0, (
        "consecutive_workable=False の従業員に H15 制約が追加されている"
    )
    # True 側は 7 日窓ごとに BoolOr 制約が追加されている（4 名 × (31-6)=25 窓 = 100 制約）
    assert len(proto_true.constraints) == len(emps_all_true) * (31 - 6), (
        "consecutive_workable=True の H15 制約数が想定と異なる: "
        f"{len(proto_true.constraints)}"
    )


def test_window_penalties_match_squared_diff():
    """_CONSECUTIVE_WINDOW_PENALTIES の累積和が -(k-2)² に一致する（メタ整合性）。"""
    from app.optimizer.cp_sat_model import ShiftModelBuilder

    weights = ShiftModelBuilder._CONSECUTIVE_WINDOW_PENALTIES
    assert weights == (1, 3, 5, 7), f"差分系列が想定外: {weights}"

    cumulative = 0
    for i, k in enumerate((3, 4, 5, 6)):
        cumulative += weights[i]
        expected = (k - 2) ** 2
        assert cumulative == expected, (
            f"k={k} の累積ペナルティ {cumulative} != (k-2)² = {expected}"
        )


def test_s5_linear_penalty_unchanged_for_consecutive_workable_false():
    """consecutive_workable=False の S5 線形 -2/ペアロジックが現状維持されていることを
    定数 _CONSECUTIVE_PENALTY の値で保証する（回帰）。"""
    from app.optimizer.cp_sat_model import ShiftModelBuilder

    assert ShiftModelBuilder._CONSECUTIVE_PENALTY == 2, (
        "S5 ペナルティ重みが変更されている（False 側はノータッチが要件）"
    )


# ---------------------------------------------------------------------------
# issue #193: H15 INFEASIBLE 診断補強 — _detail_h15_consecutive_workable
# ---------------------------------------------------------------------------


def test_detail_h15_returns_hint_when_consecutive_workable_employees_exist():
    """consecutive_workable=True 従業員が存在する INFEASIBLE シナリオで、
    _detail_h15_consecutive_workable は『連勤可能を OFF にせよ』ヒントを返す。
    ユーザーが H15 が原因の INFEASIBLE を解消する手がかりを得るために必要。"""
    from app.optimizer.cp_sat_model import _detail_h15_consecutive_workable

    employees = [
        Employee(1, "主任", "CHIEF", set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフ", "STAFF", set(range(7)), {1, 2, 3}, False),
    ]
    inp = make_input(employees=employees)
    details = _detail_h15_consecutive_workable(inp)
    joined = "\n".join(details)
    assert "連勤可能" in joined and "OFF" in joined
    # consecutive_workable=False の従業員は対象外なので候補に出ない
    assert "スタッフ" not in joined


def test_detail_h15_includes_high_density_employees_as_candidates():
    """その月の出勤強制日数が 6/7 を超える consecutive_workable=True 従業員は
    候補リストに名前が出る (フォースされやすいので H15 cap で詰みやすい)。"""
    from app.optimizer.cp_sat_model import _detail_h15_consecutive_workable

    employees = [
        # 全曜日勤務可能 + 希望休なし → 強制出勤密度 31/31 = 100% (>6/7)
        Employee(1, "高密度", "CHIEF", set(range(7)), {1, 2, 3}, True),
    ]
    inp = make_input(employees=employees)
    details = _detail_h15_consecutive_workable(inp)
    joined = "\n".join(details)
    assert "高密度" in joined
    assert "OFF" in joined


def test_detail_h15_returns_generic_hint_when_no_consecutive_workable_true():
    """consecutive_workable=True が誰もいなければ、汎用ヒントは出ても候補は空。"""
    from app.optimizer.cp_sat_model import _detail_h15_consecutive_workable

    employees = [
        Employee(1, "主任", "CHIEF", set(range(7)), {1, 2, 3}, False),
        Employee(2, "スタッフ", "STAFF", set(range(7)), {1, 2, 3}, False),
    ]
    inp = make_input(employees=employees)
    details = _detail_h15_consecutive_workable(inp)
    # candidates 空でも OFF ヒントは出す (誰かが True に変わったら可能性)
    assert any("OFF" in line for line in details)
    assert all("主任" not in line and "スタッフ" not in line for line in details)


def test_diagnose_infeasible_wires_h15_detail():
    """diagnose_infeasible の detail_funcs に H15 が登録されていることを確認。
    実際の INFEASIBLE シナリオは構築が複雑なので、wiring 側の回帰のみ。"""
    import inspect
    from app.optimizer import cp_sat_model

    src = inspect.getsource(cp_sat_model.diagnose_infeasible)
    assert "_detail_h15_consecutive_workable" in src, (
        "diagnose_infeasible が _detail_h15_consecutive_workable を参照していない"
    )


# ---------------------------------------------------------------------------
# solve_partial (PARTIAL 状態用)
# ---------------------------------------------------------------------------

from app.optimizer.cp_sat_model import solve_partial  # noqa: E402


def test_solve_partial_returns_shortages_when_kibo_overlaps():
    """希望休が複数重なって標準解では INFEASIBLE になる日がある場合、
    solve_partial は出勤可能者だけで埋めた解 + 残った不足を ShortageRow リストで返す。"""
    # CHIEF + DEPUTY + STAFF1 + STAFF2 + STAFF3 の 5 名
    # day 5 に DEPUTY + STAFF1 + STAFF2 + STAFF3 の 4 名が ●、CHIEF だけ残る
    # B1=1, C1=1, D1=1, E1=1 必須 = 1 日 4 名必要だが 1 名しか働けない
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(5, "スタッフC", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    patterns = [
        WorkPattern(11, "B", "B1", 1, "07:10", "15:00"),
        WorkPattern(12, "C", "C1", 1, "08:00", "16:00"),
        WorkPattern(13, "D", "D1", 1, "09:00", "17:00"),
        WorkPattern(14, "E", "E1", 1, "10:00", "18:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    day_reqs = {
        d: [
            DayRequirement(11, 1),
            DayRequirement(12, 1),
            DayRequirement(13, 1),
            DayRequirement(14, 1),
        ]
        for d in range(1, num_days + 1)
    }
    # day 5 のみ 4 名 ● (CHIEF 以外全員)
    leave_requests = {
        2: {5: "●"},
        3: {5: "●"},
        4: {5: "●"},
        5: {5: "●"},
    }
    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests=leave_requests,
        choice_groups=[], pattern_triggers=[], employee_priorities={},
    )

    status, result, shortages, manager_gap_days = solve_partial(inp, time_limit=10.0)
    assert status in ("OPTIMAL", "FEASIBLE"), f"partial 解は得られるべき、status={status}"

    # day 5 の不足は 3 件 (4 必要 - 1 名分しか埋まらない)
    day5_shortages = [s for s in shortages if s.day == 5]
    total_missing_day5 = sum(s.missing for s in day5_shortages)
    assert total_missing_day5 == 3, (
        f"day 5 で 3 ポジ不足のはず、shortages={day5_shortages}"
    )
    # ● 日の従業員は休みのまま (label="●")
    for emp_id in (2, 3, 4, 5):
        assert result.get((emp_id, 5)) == "●", (
            f"emp={emp_id} day=5 が ● のままでない: result={result.get((emp_id, 5))}"
        )


def test_solve_partial_keeps_kibo_hard():
    """partial_mode でも希望休 (●) と有給は HARD のまま破られない。"""
    inp = make_input(leave_requests={
        1: {5: "●"},
        2: {6: "有給"},
    })
    status, result, shortages, manager_gap_days = solve_partial(inp, time_limit=5.0)
    assert status in ("OPTIMAL", "FEASIBLE")
    assert result[(1, 5)] == "●", "● 日が破られた"
    assert result[(2, 6)] == "有給", "有給 日が破られた"


def test_solve_partial_zero_shortage_on_feasible_input():
    """FEASIBLE な入力に対して solve_partial は不足ゼロを返す。"""
    inp = make_input()
    status, result, shortages, manager_gap_days = solve_partial(inp, time_limit=5.0)
    assert status in ("OPTIMAL", "FEASIBLE")
    assert shortages == [], f"FEASIBLE 入力で不足が出た: {shortages}"


def test_solve_partial_handles_all_managers_kibo_with_manager_gap():
    """管理職 (CHIEF + DEPUTY) 全員が同日 ● でも、solve_partial は H5 を soft 化して
    FEASIBLE を返し、manager_gap_days に該当日が入る。標準 solve では INFEASIBLE
    だった「管理職全員休み」シナリオが PARTIAL 経路で救えることを示す回帰テスト。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(5, "スタッフC", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    # day 5 に管理職 2 名 + 4 名 (STAFF B/C + 他) が ●、CHIEF と DEPUTY も ●
    leave_requests = {
        1: {5: "●"},  # CHIEF
        2: {5: "●"},  # DEPUTY
        4: {5: "●"},  # STAFF B
        5: {5: "●"},  # STAFF C
    }
    inp = make_input(employees=employees, leave_requests=leave_requests)

    status, result, shortages, manager_gap_days = solve_partial(inp, time_limit=10.0)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"H5 soft 化された partial solve は管理職全員 ● でも FEASIBLE を返すはず、status={status}"
    )
    # day 5 は管理職穴として記録される
    assert 5 in manager_gap_days, (
        f"day 5 は manager_gap_days に含まれるはず: {manager_gap_days}"
    )
    # ● 設定の従業員は引き続き ● ラベル (H10 は hard のまま)
    for emp_id in (1, 2, 4, 5):
        assert result.get((emp_id, 5)) == "●", (
            f"emp={emp_id} の day 5 ● が破られている: {result.get((emp_id, 5))}"
        )


def test_solve_partial_handles_h11_choice_group_min_count_with_kibo():
    """H11 choice_group min_count > 0 がある状態で候補メンバー全員 ● でも
    solve_partial は FEASIBLE を返し、不足を ShortageRow/slack で表面化する。

    実 prod 回帰: tiny_input には choice_groups がなくこの経路が未試行。
    鮮魚部門等は曜日別 min_count を持ち、5/10 (日) で候補全員 ● → H11 hard
    違反で solve_partial INFEASIBLE → 「稼働表作成失敗」表示が継続するバグの根因。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    # choice_groups: 日曜 (weekday=6) に pattern 4 (B1) を min 1 名必須
    # day 5 (2026/1/5 = 月曜) ではなく day 4 (2026/1/4 = 日曜) を使う
    # 2026/1/4 = 日曜なので weekday=6
    choice_groups = [([4], 1, 4, 6)]  # B1, min=1, max=4, dow=日曜
    # day 4 (日曜) に B1 候補全員 ●
    leave_requests = {
        1: {4: "●"}, 2: {4: "●"}, 3: {4: "●"}, 4: {4: "●"},
    }
    inp = make_input(
        employees=employees,
        choice_groups=choice_groups,
        leave_requests=leave_requests,
    )

    status, result, shortages, manager_gap_days = solve_partial(inp, time_limit=10.0)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"H11 soft 化された partial solve は min_count 違反でも FEASIBLE のはず、status={status}"
    )
    # day 4 で全員 ● が維持される (H10 hard)
    for emp_id in (1, 2, 3, 4):
        assert result.get((emp_id, 4)) == "●", (
            f"emp={emp_id} の day 4 ● が破られた: {result.get((emp_id, 4))}"
        )


def test_solve_partial_handles_h12_pattern_trigger_with_kibo():
    """H12 pattern_trigger (aux → req 含意) が partial_mode で soft 化されることを確認。

    aux パターン (C) と req グループ (B) があり、req 候補全員 ● でも solve_partial は
    FEASIBLE を返す (aux 非使用 or violated 経由)。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    patterns = [
        WorkPattern(11, "B", "B1", 1, "07:00", "15:00"),  # req group
        WorkPattern(12, "C", "C1", 1, "08:00", "16:00"),  # aux group
    ]
    triggers = [PatternTrigger(auxiliary_group_name="C", required_group_names=["B"])]
    leave_requests = {3: {5: "●"}, 4: {5: "●"}}  # B 候補 (STAFF A/B) 全員 ●

    num_days = calendar.monthrange(2026, 1)[1]
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    # issue #235: H3 == 制約下、2 group × 31 = 62 max。4 emp × 22 = 88 > 62。
    # CHIEF=15/DEPUTY=16、STAFF=16 で work 16+15+15+15=61 ≤ 62 feasible。
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 16, "STAFF": 16,
                         "FULLPART": 16, "MORNINGPART": 16}
    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests=leave_requests,
        choice_groups=[], pattern_triggers=triggers, employee_priorities={},
        rest_days_by_role=rest_days_by_role,
    )

    status, _, _, _ = solve_partial(inp, time_limit=10.0)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"H12 soft 化された partial solve は req 全員 ● でも FEASIBLE のはず、status={status}"
    )


def test_solve_partial_handles_special_assignment_chief_kibo():
    """H6/H7 _special_assignments が partial_mode で soft 化されることを確認。

    CHIEF を Thu (weekday=3) に A3 強制割当 + Thu の CHIEF が ● → 通常 INFEASIBLE。
    soft 化で violated slack に吸収され FEASIBLE 返却。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    rule = SpecialAssignmentRule(
        condition_type="WEEKDAY", condition_value=3, role="CHIEF", pattern_name="A3"
    )
    # 2026-01-01 は木曜 (weekday=3) なので day 1 で発火、その日 CHIEF を ● にする
    leave_requests = {1: {1: "●"}}
    inp = make_input(
        employees=employees,
        special_assignments=[rule],
        leave_requests=leave_requests,
    )

    status, result, _, _ = solve_partial(inp, time_limit=10.0)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"H6/H7 soft 化で Thu CHIEF ● でも FEASIBLE のはず、status={status}"
    )
    # CHIEF の day 1 ● は維持
    assert result.get((1, 1)) == "●", (
        f"CHIEF day 1 ● が破られた: {result.get((1, 1))}"
    )


def test_solve_partial_is_deterministic_across_runs():
    """同 input で 2 回 solve_partial を呼ぶと完全に同じ結果を返す (workers=1 + seed)。

    UI 上の swap proposals が再描画/再 fetch で変わると user 混乱するため、
    決定性は重要な不変条件。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2, 3}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2, 3}, True),
        Employee(3, "スタッフA", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(4, "スタッフB", "STAFF",  set(range(7)), {1, 2, 3}, True),
        Employee(5, "スタッフC", "STAFF",  set(range(7)), {1, 2, 3}, True),
    ]
    leave_requests = {1: {5: "●"}, 2: {5: "●"}, 3: {5: "●"}, 4: {5: "●"}}
    inp = make_input(employees=employees, leave_requests=leave_requests)

    # time_limit を大きめに取って solver が OPTIMAL に到達してから比較。
    # full suite で CPU 負荷が高いとき短すぎる time_limit だと search path が変わる。
    s1, r1, sh1, mg1 = solve_partial(inp, time_limit=30.0, random_seed=42)
    s2, r2, sh2, mg2 = solve_partial(inp, time_limit=30.0, random_seed=42)

    assert s1 == s2, f"status 不一致: {s1} vs {s2}"
    assert r1 == r2, "assignment result 不一致"
    assert [(s.day, s.pattern_id, s.missing) for s in sh1] == \
           [(s.day, s.pattern_id, s.missing) for s in sh2], "shortages 不一致"
    assert mg1 == mg2, f"manager_gap_days 不一致: {mg1} vs {mg2}"


def test_solve_partial_prod_shape_seafood():
    """prod (鮮魚部門) 相当の構成で 5/10 (日) に管理職 2 + スタッフ 4 ● シナリオ。

    今回のリグレッション (H11 choice_group で INFEASIBLE 化) を直接捕捉する統合テスト。
    14 名 + 複数 role + choice_groups + pattern_triggers + special_assignments を組み合わせ。
    """
    employees = [
        Employee(1,  "主任",       "CHIEF",       set(range(7)), {1, 2, 3}, True),
        Employee(2,  "副主任",     "DEPUTY",      set(range(7)), {1, 2, 3}, True),
        Employee(3,  "一般A",      "STAFF",       set(range(7)), {1, 2, 3}, True),
        Employee(4,  "一般B",      "STAFF",       set(range(7)), {1, 2, 3}, True),
        Employee(5,  "フルパートA", "FULLPART",    set(range(7)), {1, 2},    True),
        Employee(6,  "フルパートB", "FULLPART",    set(range(7)), {1, 2},    True),
        Employee(7,  "フルパートC", "FULLPART",    set(range(7)), {1, 2},    True),
        Employee(8,  "フルパートD", "FULLPART",    set(range(7)), {1, 2},    True),
        Employee(9,  "早朝A",      "MORNINGPART", set(range(7)), {1},       True),
        Employee(10, "早朝B",      "MORNINGPART", set(range(7)), {1},       True),
        Employee(11, "早朝C",      "MORNINGPART", set(range(7)), {1},       True),
        Employee(12, "早朝D",      "MORNINGPART", set(range(7)), {1},       True),
        Employee(13, "早朝E",      "MORNINGPART", set(range(7)), {1},       True),
        Employee(14, "早朝F",      "MORNINGPART", set(range(7)), {1},       True),
    ]
    patterns = [
        WorkPattern(11, "B", "B1", 1, "07:00", "15:00"),
        WorkPattern(12, "C", "C1", 1, "08:00", "16:00"),
        WorkPattern(13, "D", "D1", 1, "09:00", "17:00"),
    ]
    num_days = calendar.monthrange(2026, 5)[1]
    day_reqs = {
        d: [DayRequirement(11, 1), DayRequirement(12, 1), DayRequirement(13, 1)]
        for d in range(1, num_days + 1)
    }
    # 日曜 (weekday=6) に B1 を min 1 必須 (H11)。2026-05-10 が日曜
    choice_groups = [([11], 1, 5, 6)]
    # 5/10 に管理職 2 + 一般 2 + フルパ 2 = 6 名 ●
    leave_requests = {
        1: {10: "●"}, 2: {10: "●"},
        3: {10: "●"}, 4: {10: "●"},
        5: {10: "●"}, 6: {10: "●"},
    }
    # issue #235: H3 == 制約下。3 group × 31 = 93 demand/capacity ぴったり。
    # 14 emp の sum(work) = 93 となる rest 設定:
    #   CHIEF=15 (work 16), DEPUTY=16 (work 15): H5 union 31 OK, 計 31
    #   STAFF=30 (work 1 ×2 = 2)
    #   FULLPART=25 (work 6 ×4 = 24)
    #   MORNINGPART=25 (work 6 ×6 = 36)
    #   合計 work = 31+2+24+36 = 93 ✓
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 16, "STAFF": 30,
                         "FULLPART": 25, "MORNINGPART": 25}
    inp = ShiftModelInput(
        year=2026, month=5, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests=leave_requests,
        choice_groups=choice_groups, pattern_triggers=[],
        employee_priorities={},
        rest_days_by_role=rest_days_by_role,
    )

    status, result, shortages, manager_gap_days = solve_partial(
        inp, time_limit=20.0, random_seed=999,
    )
    # 最重要 assert: solve_partial が FEASIBLE を返す (リグレッション捕捉)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"prod 相当 seafood シナリオで partial solve が INFEASIBLE: status={status}. "
        "H11/H5/special_assignments のいずれかが hard で残っている可能性。"
    )
    # 5/10 は管理職 ● → manager_gap に入る
    assert 10 in manager_gap_days, (
        f"5/10 は管理職 2 名 ● で manager_gap_days に入るはず: {manager_gap_days}"
    )
    # ● 設定の従業員は ● ラベル維持
    for emp_id in (1, 2, 3, 4, 5, 6):
        assert result.get((emp_id, 10)) == "●", (
            f"emp={emp_id} の 5/10 ● が破られた: {result.get((emp_id, 10))}"
        )


# ---------------------------------------------------------------------------
# S3 priority weight スケールアップ (priority * 100)
# ---------------------------------------------------------------------------

def test_s3_priority_high_score_wins_over_low_score():
    """同 pattern に複数 candidate が居る場合、priority が高い従業員が選ばれる。
    weight が pri * 100 にスケールアップされたことで、fairness (20) より priority を
    確実に優先できることを示す回帰テスト。
    """
    # 2 名のみ。両者とも全パターン priority 持ち (preflight 通過 + 全 pattern
    # 割当可能で issue #235 == 制約下でも feasible)。
    # day_requirements は B1 (id=4) を 1 名/日 = 31 日 = 31 person-days
    # 2 名で十分カバー可能。
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2}, True),
    ]
    # 主任は B1 priority=10、副主任は B1 priority=1
    # → 主任が選ばれる方が圧倒的に高得点
    # その他 pattern (A1/A2/A3/C1/D1) は両者同等 priority=5 で割当可能化 (== H3 充足のため)
    employee_priorities = {
        1: {4: 10, 1: 5, 2: 5, 3: 5, 5: 5, 6: 5},  # 主任 → B1=10, 他=5
        2: {4: 1,  1: 5, 2: 5, 3: 5, 5: 5, 6: 5},  # 副主任 → B1=1, 他=5
    }
    inp = make_input(employees=employees, employee_priorities=employee_priorities)

    builder = ShiftModelBuilder(inp)
    status, solver = builder.build_and_solve(time_limit=10.0, workers=1, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE")
    result = builder.extract_result(solver)

    chief_b1_days = sum(
        1 for d in range(1, 32) if result.get((1, d)) == "B1"
    )
    deputy_b1_days = sum(
        1 for d in range(1, 32) if result.get((2, d)) == "B1"
    )
    # fairness 制約があるので完全に主任独占ではないが、priority が効いていれば
    # 主任が副主任より明確に多くの B1 を取るはず
    assert chief_b1_days > deputy_b1_days, (
        f"priority=10 の主任が priority=1 の副主任より多く B1 を取るはず "
        f"(主任 B1={chief_b1_days}, 副主任 B1={deputy_b1_days})"
    )


def test_s3_priority_scale_factor_constant():
    """priority 係数がスケール定数として明示されている。
    将来の調整時に「pri * 100」のマジックナンバーではなく定数経由で変更できる。
    """
    assert hasattr(ShiftModelBuilder, "_S3_PRIORITY_SCALE"), (
        "_S3_PRIORITY_SCALE クラス変数が定義されているべき"
    )
    assert ShiftModelBuilder._S3_PRIORITY_SCALE == 100, (
        f"スケール係数は 100 で固定 (priority max 10 → スコア最大 1000、"
        f"fairness=20 より大幅に上、SHORTAGE=10_000 より低い)。"
        f"現在値: {ShiftModelBuilder._S3_PRIORITY_SCALE}"
    )


# ---------------------------------------------------------------------------
# 5/10 造半日 バグ回帰: choice_group min_count > 0 で priority 未設定の人に
# 候補 pattern が割り当てられないこと
# ---------------------------------------------------------------------------

def test_priority_unset_pattern_never_assigned_under_choice_group_shortage():
    """choice_group min_count=1 (slack 不足ペナルティ -10_000) でも、priority>0 を
    持たない employee は当該 pattern に割り当てられないこと。

    5/10 シナリオ回帰: 造フル/造半日 choice_group の candidate 全員 ● の日に
    priority 未設定の吉田さくらが 造半日 に割り当てられたバグ。priority 未設定 =
    hard 禁止 (`assign[(e,d,p)] == 0`) で防ぐ。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(3, "Aさん",     "STAFF",  set(range(7)), {1, 2}, True),
        Employee(4, "Bさん",     "STAFF",  set(range(7)), {1, 2}, True),
    ]
    patterns = [
        WorkPattern(11, "X", "X1", 1, "07:00", "15:00"),  # 主任 priority 持ち
        WorkPattern(12, "Y", "Y1", 1, "08:00", "16:00"),  # choice_group 候補 A
        WorkPattern(13, "Y", "Y2", 1, "09:00", "17:00"),  # choice_group 候補 B
        # issue #235: H3 == 制約下、X+Y のみだと 2 group × 31 = 62 emp-day で
        # 4 emp × work_each を吸収不可。filler group Z 追加。
        WorkPattern(91, "Z", "Z1", 1, "07:00", "15:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    # X1 のみ day_requirements (主任 + 副主任で回せる)
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    # choice_group: Y1 or Y2 を毎日 1名必須 (max 1)
    # 候補 pattern_ids = [12, 13]
    choice_groups = [([12, 13], 1, 1, None)]
    # day 5 に Y1/Y2 priority 持ち全員 ● → slack 立てる以外なし。
    # Aさんに Y1 priority 設定、Bさんには Y1/Y2 priority 未設定
    employee_priorities = {
        1: {11: 10},  # 主任 X1=10
        2: {11: 10},  # 副主任 X1=10
        3: {11: 5, 12: 10},  # Aさん X1+Y1
        # Bさん: priority 完全未設定 (X1/Y1/Y2 すべて 0)
    }
    # day 5 に Aさん が ● → Y1/Y2 candidate (Aさん のみ) は不在
    leave_requests = {3: {5: "●"}}

    # issue #235: H3 == + H5 + H13 + priority hard ban を全部満たす設定。
    # filler group Z1 を patterns に追加済 (capacity 拡張)。
    # 各 emp に Z1 priority 付与 (work day 吸収)。Y1/Y2 priority は変更維持 (test 焦点)。
    # H5: CHIEF/DEPUTY rest 15 で合計 30 <= 31。STAFF=16 で feasible。
    for eid in (1, 2, 3, 4):
        employee_priorities.setdefault(eid, {})[91] = 5  # Z1 priority 全員に付与
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 15, "STAFF": 16,
                         "FULLPART": 16, "MORNINGPART": 16}

    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests=leave_requests,
        choice_groups=choice_groups, pattern_triggers=[],
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
    )

    # partial_mode で choice_group min_count を soft 化
    builder = ShiftModelBuilder(inp, partial_mode=True)
    status, solver = builder.build_and_solve(time_limit=15.0, workers=1, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE")
    result = builder.extract_result(solver)

    # Bさん (id=4, priority 完全未設定) には Y1/Y2 が day 5 に割り当てられないはず
    bsan_label_day5 = result.get((4, 5), "")
    assert bsan_label_day5 not in ("Y1", "Y2"), (
        f"priority 未設定の Bさんに Y1/Y2 が割り当てられた (バグ): {bsan_label_day5}"
    )
    # 主任 + 副主任には X1 priority 持ちなので X1 のみ割当される
    chief_label_day5 = result.get((1, 5), "")
    deputy_label_day5 = result.get((2, 5), "")
    for label in (chief_label_day5, deputy_label_day5):
        assert label not in ("Y1", "Y2"), (
            f"X1 のみ priority 持ちのはずなのに Y1/Y2 が割当られた: {label}"
        )


def test_priority_unset_hard_ban_does_not_break_optimal_when_master_complete():
    """priority master が「要求 pattern に 1 人以上 candidate あり」を満たす場合、
    priority 未設定の employee は他 pattern に普通に割当されること (hard 禁止が
    過剰防衛にならない回帰テスト)。
    """
    employees = [
        Employee(1, "主任",      "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任",    "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(3, "Aさん",     "STAFF",  set(range(7)), {1, 2}, True),
        Employee(4, "Bさん",     "STAFF",  set(range(7)), {1, 2}, True),
    ]
    patterns = [
        WorkPattern(11, "X", "X1", 1, "07:00", "15:00"),
        # issue #235: H3 == 制約下、X 単一 group では 4 emp の work 吸収不可
        # (H13 で X max 31 emp-day)。filler group Z1 を追加して capacity 拡張。
        WorkPattern(91, "Z", "Z1", 1, "07:00", "15:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    # 全員 X1 priority 持ち = 4 candidate。Z1 にも priority 付与 (==H3 充足のため)。
    employee_priorities = {
        1: {11: 10, 91: 5}, 2: {11: 10, 91: 5},
        3: {11: 5, 91: 5},  4: {11: 5, 91: 5},
    }
    # H5: CHIEF+DEPUTY rest 合計 <= 31。CHIEF/DEPUTY=15、STAFF=16 で feasible。
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 15, "STAFF": 16,
                         "FULLPART": 16, "MORNINGPART": 16}
    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests={},
        choice_groups=[], pattern_triggers=[],
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
    )

    builder = ShiftModelBuilder(inp)
    status, solver = builder.build_and_solve(time_limit=10.0, workers=1, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE"), (
        f"全員 priority 持ち + day_requirements 1名/日 = 31 person-days で feasible のはず: {status}"
    )


# ---------------------------------------------------------------------------
# Phase G: choice_group の不足を ShortageRow として返す
# ---------------------------------------------------------------------------

def test_extract_choice_group_shortages_returns_or_group_shortage():
    """choice_group min_count>0 の OR グループ候補が誰も埋められない日に、
    extract_choice_group_shortages がグループ全体の ShortageRow を返すこと。
    pattern_id は負値、pattern_name は候補連結 "/" 区切り。
    """
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2}, True),
    ]
    patterns = [
        WorkPattern(11, "X", "X1", 1, "07:00", "15:00"),
        WorkPattern(21, "Y", "Y1", 1, "08:00", "16:00"),
        WorkPattern(22, "Y", "Y2", 1, "09:00", "17:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    # X1 のみ day_requirements (主任 + 副主任で回せる)
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    # choice_group: Y1/Y2 を毎日 min 1名 必須
    choice_groups = [([21, 22], 1, 1, None)]
    # 主任 / 副主任: X1 priority のみ (Y1/Y2 priority なし)
    employee_priorities = {
        1: {11: 10},
        2: {11: 10},
    }
    # issue #235: H3 == + H5 + H13 + priority hard ban を満たす設定。
    # X1 max 31 emp-day (H13)、Y は priority なしで埋まらない、CHIEF+DEPUTY work
    # union 31 必須 (H5)。CHIEF=15/DEPUTY=16 (work 16+15=31 ぴったり) で feasible。
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 16, "STAFF": 25,
                         "FULLPART": 25, "MORNINGPART": 25}

    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests={},
        choice_groups=choice_groups, pattern_triggers=[],
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
    )
    builder = ShiftModelBuilder(inp, partial_mode=True)
    status, solver = builder.build_and_solve(time_limit=15.0, workers=1, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE")

    cg_shortages = builder.extract_choice_group_shortages(solver)
    # Y1/Y2 priority 持ちが居ない → 全 31 日 choice_group 不足
    assert len(cg_shortages) == num_days
    sample = cg_shortages[0]
    assert sample.pattern_id < 0, "choice_group shortage は pattern_id 負値"
    assert "Y1" in sample.pattern_name and "Y2" in sample.pattern_name
    assert sample.required == 1
    assert sample.assigned == 0
    assert sample.missing == 1


def test_solve_partial_merges_choice_group_shortage_into_result():
    """solve_partial の返り値 shortages に choice_group 由来も統合されること。"""
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2}, True),
    ]
    patterns = [
        WorkPattern(11, "X", "X1", 1, "07:00", "15:00"),
        WorkPattern(21, "Y", "Y1", 1, "08:00", "16:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    choice_groups = [([21], 1, 1, None)]  # Y1 single-pattern choice_group
    employee_priorities = {1: {11: 10}, 2: {11: 10}}
    # issue #235: H3 == 制約下、X1 max 31 emp-day + H5 union 31 → CHIEF=15/DEPUTY=16。
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 16, "STAFF": 25,
                         "FULLPART": 25, "MORNINGPART": 25}

    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests={},
        choice_groups=choice_groups, pattern_triggers=[],
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
    )
    status, result, shortages, _ = solve_partial(inp, time_limit=15.0, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE")
    # choice_group の Y1 が priority 持ちゼロ → 全日 choice_group 不足
    cg_only = [s for s in shortages if s.pattern_id < 0]
    assert len(cg_only) > 0, "choice_group 由来不足が shortages に含まれるはず"


def test_extract_choice_group_shortages_ignores_stale_slack_when_assigned_covers():
    """time_limit 切れで solver が slack を立てたままだが実 assigned が min_count
    を満たしているケース。整合性ガードで不足ゼロとして除外されること。

    回帰: 5/4 井上あゆみ C3フル WORK なのに C3/C3フル グループ shortage=1 (assigned=1)
    が表示されたバグ。
    """
    employees = [
        Employee(1, "主任",   "CHIEF",  set(range(7)), {1, 2}, True),
        Employee(2, "副主任", "DEPUTY", set(range(7)), {1, 2}, True),
        Employee(3, "Aさん",  "STAFF",  set(range(7)), {1, 2}, True),
    ]
    patterns = [
        WorkPattern(11, "X", "X1", 1, "07:00", "15:00"),
        WorkPattern(21, "Y", "Y1", 1, "08:00", "16:00"),
    ]
    num_days = calendar.monthrange(2026, 1)[1]
    day_reqs = {d: [DayRequirement(11, 1)] for d in range(1, num_days + 1)}
    choice_groups = [([21], 1, 1, None)]  # Y1 を毎日 min 1名
    # 全員 X1 + Y1 priority 持ち = candidate 十分
    employee_priorities = {
        1: {11: 10, 21: 5},
        2: {11: 10, 21: 5},
        3: {11: 5, 21: 10},
    }
    # issue #235: H3 == 制約下、3 emp × work_each ≤ X+Y group capacity (62)。
    # CHIEF=15/DEPUTY=16 (H5 union 31)、STAFF=16 (work 15)。total 16+15+15=46 ≤ 62。
    rest_days_by_role = {"CHIEF": 15, "DEPUTY": 16, "STAFF": 16,
                         "FULLPART": 16, "MORNINGPART": 16}
    inp = ShiftModelInput(
        year=2026, month=1, employees=employees, patterns=patterns,
        day_requirements=day_reqs, leave_requests={},
        choice_groups=choice_groups, pattern_triggers=[],
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
    )
    builder = ShiftModelBuilder(inp, partial_mode=True)
    status, solver = builder.build_and_solve(time_limit=10.0, workers=1, random_seed=0)
    assert status in ("OPTIMAL", "FEASIBLE")

    cg_shortages = builder.extract_choice_group_shortages(solver)
    # priority 持ちが居て埋まる → 全日 assigned >= min_count → shortage は出ない
    for sr in cg_shortages:
        # 念の為: 不足が出るなら assigned < required のはず
        assert sr.assigned < sr.required, (
            f"assigned >= required の slack を不足扱いしてはいけない: {sr}"
        )
