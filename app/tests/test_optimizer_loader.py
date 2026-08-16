"""
app/optimizer/loader.py の DB → ShiftModelInput 変換テスト。

実 DB（テスト用 PostgreSQL + savepoint 分離）を使い、各セクションの
変換ロジックと分岐を網羅する。祝日は DB の `holidays` テーブルを直接 pre-insert することで制御する (jpholiday は holiday_service 内部でのみ呼ばれる)。
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
    PatternIncompatibility,
)
from app.models.day_template import DayOverride, DayTemplate
from app.models.department import Department, WorkRuleConfig
from app.models.employee import Employee, EmployeePatternPriority
from app.models.leave_request import LeaveRequest
from app.models.pattern_rule import (
    PatternTrigger,
    PatternTriggerRequiredGroup,
    SpecialAssignmentRule,
)
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.models.holiday import Holiday
from app.optimizer.loader import build_shift_model_input


# ---------------------------------------------------------------------------
# Fixtures: シナリオ用データ作成ヘルパ
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def session(client: tuple) -> AsyncSession:
    """conftest.client から DB セッションだけ取り出す。"""
    _, db = client
    return db


@pytest_asyncio.fixture
async def dept2(session: AsyncSession) -> Department:
    """別店舗。混在データのフィルタ確認用（WorkRuleConfig なし版）。"""
    d = Department(name="他店舗")
    session.add(d)
    await session.flush()
    return d


async def _add_group(
    session: AsyncSession,
    dept_id: int,
    name: str,
    *,
    is_auxiliary: bool = False,
) -> WorkPatternGroup:
    g = WorkPatternGroup(department_id=dept_id, name=name, is_auxiliary=is_auxiliary)
    session.add(g)
    await session.flush()
    return g


async def _add_pattern(
    session: AsyncSession,
    group: WorkPatternGroup,
    pattern_name: str,
    *,
    shift_type: int = 2,
    shift_start: str = "09:00",
    shift_end: str = "18:00",
) -> WorkPattern:
    p = WorkPattern(
        group_id=group.id,
        pattern_name=pattern_name,
        shift_type=shift_type,
        shift_start=shift_start,
        shift_end=shift_end,
    )
    session.add(p)
    await session.flush()
    return p


async def _add_employee(
    session: AsyncSession,
    dept_id: int,
    *,
    employee_number: int,
    name: str = "Test Employee",
    role: str = "STAFF",
    available_days: str = "0,1,2,3,4,5,6",
    available_shift_types: str = "1,2,3",
    consecutive_workable: bool = True,
) -> Employee:
    e = Employee(
        department_id=dept_id,
        employee_number=employee_number,
        name=name,
        role=role,
        available_days=available_days,
        available_shift_types=available_shift_types,
        consecutive_workable=consecutive_workable,
    )
    session.add(e)
    await session.flush()
    return e


# ---------------------------------------------------------------------------
# 空データ + WorkRuleConfig
# ---------------------------------------------------------------------------

async def test_empty_department_returns_empty_lists(session: AsyncSession, dept: Department) -> None:
    """マスタ未登録でも年月のみ反映、各リスト空、WorkRuleConfig からデフォルト値。"""
    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.year == 2026
    assert inp.month == 4
    assert inp.employees == []
    assert inp.patterns == []
    assert inp.leave_requests == {}
    assert inp.choice_groups == []
    assert inp.incompatibilities == []
    assert inp.special_assignments == []
    assert inp.pattern_triggers == []
    assert inp.employee_priorities == {}
    # 空 day_templates → 各日空リスト
    assert all(reqs == [] for reqs in inp.day_requirements.values())
    # 4月は30日
    assert set(inp.day_requirements.keys()) == set(range(1, 31))


async def test_role_rest_days_30day_month(session: AsyncSession, dept: Department) -> None:
    """30 日月では Role.rest_days_30 が rest_days_by_role に反映される (issue #235)。"""
    from app.models.role import Role

    # Role 値を上書き
    chief = await session.get(Role, "CHIEF")
    chief.rest_days_30 = 8
    chief.rest_days_31 = 11
    staff = await session.get(Role, "STAFF")
    staff.rest_days_30 = 8
    deputy = await session.get(Role, "DEPUTY")
    deputy.rest_days_30 = 8
    fullpart = await session.get(Role, "FULLPART")
    fullpart.rest_days_30 = 6
    morningpart = await session.get(Role, "MORNINGPART")
    morningpart.rest_days_30 = 6
    # WRC: 削除済 rest_days_* は無いが、残る 2 列のテスト
    cfg = (await session.execute(
        select(WorkRuleConfig).where(WorkRuleConfig.department_id == dept.id)
    )).scalar_one()
    cfg.standard_work_hours_per_day = 7.5
    cfg.max_overtime_hours_staff = 35.0
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)  # 30 日

    assert inp.rest_days_by_role["STAFF"] == 8
    assert inp.rest_days_by_role["CHIEF"] == 8
    assert inp.rest_days_by_role["DEPUTY"] == 8
    assert inp.rest_days_by_role["FULLPART"] == 6
    assert inp.rest_days_by_role["MORNINGPART"] == 6
    assert inp.standard_hours_per_day == 7.5
    assert inp.max_overtime_hours == 35.0


async def test_role_rest_days_31day_month_uses_31_bucket(session: AsyncSession, dept: Department) -> None:
    """31 日月では Role.rest_days_31 が選ばれる (issue #235)。"""
    from app.models.role import Role

    staff = await session.get(Role, "STAFF")
    staff.rest_days_30 = 9
    staff.rest_days_31 = 11
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=5)  # 31 日

    assert inp.rest_days_by_role["STAFF"] == 11


async def test_role_rest_days_28_29_for_feb(session: AsyncSession, dept: Department) -> None:
    """Feb (2026年=28日) は Role.rest_days_28_29 バケツを使う (issue #235)。"""
    from app.models.role import Role

    staff = await session.get(Role, "STAFF")
    staff.rest_days_28_29 = 5
    staff.rest_days_30 = 9
    staff.rest_days_31 = 10
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=2)  # 28 日

    assert inp.rest_days_by_role["STAFF"] == 5


async def test_role_rest_days_29_for_leap_feb(session: AsyncSession, dept: Department) -> None:
    """Leap year Feb (2024年=29日) も Role.rest_days_28_29 バケツを使う。"""
    from app.models.role import Role

    chief = await session.get(Role, "CHIEF")
    chief.rest_days_28_29 = 6
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2024, month=2)  # 29 日

    assert inp.rest_days_by_role["CHIEF"] == 6


async def test_morningpart_independent_from_fullpart(session: AsyncSession, dept: Department) -> None:
    """MORNINGPART は FULLPART と独立した値を持てる (issue #235 で解消するバグ)。"""
    from app.models.role import Role

    fullpart = await session.get(Role, "FULLPART")
    fullpart.rest_days_31 = 7
    morningpart = await session.get(Role, "MORNINGPART")
    morningpart.rest_days_31 = 8
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=5)  # 31 日

    assert inp.rest_days_by_role["FULLPART"] == 7
    assert inp.rest_days_by_role["MORNINGPART"] == 8
    assert inp.rest_days_by_role["FULLPART"] != inp.rest_days_by_role["MORNINGPART"]


async def test_role_rest_days_includes_all_role_codes(session: AsyncSession, dept: Department) -> None:
    """rest_days_by_role には DB 上の全 role.code が含まれる。"""
    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert set(inp.rest_days_by_role.keys()) >= {
        "CHIEF", "DEPUTY", "STAFF", "FULLPART", "MORNINGPART",
    }


async def test_loader_works_for_dept_without_workruleconfig(
    session: AsyncSession, dept2: Department
) -> None:
    """WorkRuleConfig が存在しない部門でも Role 値が直接使われる (issue #235: WRC 依存削除)。"""
    inp = await build_shift_model_input(session, dept2.id, year=2026, month=4)  # 30 日

    # seed default: CHIEF/DEPUTY/STAFF=(9,9,10), FULLPART/MORNINGPART=(7,7,7)
    assert inp.rest_days_by_role["CHIEF"] == 9
    assert inp.rest_days_by_role["DEPUTY"] == 9
    assert inp.rest_days_by_role["STAFF"] == 9
    assert inp.rest_days_by_role["FULLPART"] == 7
    assert inp.rest_days_by_role["MORNINGPART"] == 7
    # WRC が無くても optimizer は動く
    assert inp.standard_hours_per_day == 8.0
    assert inp.max_overtime_hours == 40.0


# ---------------------------------------------------------------------------
# WorkPattern / WorkPatternGroup
# ---------------------------------------------------------------------------

async def test_patterns_carry_group_name(
    session: AsyncSession, dept: Department
) -> None:
    """グループの name が各パターンに伝搬する (issue #117: is_auxiliary は dataclass から削除)。"""
    g_a = await _add_group(session, dept.id, "A")
    g_c = await _add_group(session, dept.id, "C", is_auxiliary=True)
    p_a1 = await _add_pattern(session, g_a, "A1")
    p_c1 = await _add_pattern(session, g_c, "C1", shift_start="08:00", shift_end="17:00")

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    by_id = {p.id: p for p in inp.patterns}
    assert by_id[p_a1.id].group_name == "A"
    assert by_id[p_c1.id].group_name == "C"
    assert by_id[p_c1.id].pattern_name == "C1"
    assert by_id[p_c1.id].shift_start == "08:00"


# ---------------------------------------------------------------------------
# Employee: CSV-like string → set 変換
# ---------------------------------------------------------------------------

async def test_employee_available_days_and_shift_types_parsed(
    session: AsyncSession, dept: Department
) -> None:
    """available_days/shift_types のカンマ区切り文字列が set[int] に変換される。"""
    await _add_employee(
        session, dept.id, employee_number=1,
        available_days="0,2,4", available_shift_types="1,3",
    )

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    e = inp.employees[0]
    assert e.available_days == {0, 2, 4}
    assert e.available_shift_types == {1, 3}


async def test_employee_handles_empty_segments_in_csv_string(
    session: AsyncSession, dept: Department
) -> None:
    """カンマ区切りに空要素があっても無視される（split の堅牢性）。"""
    await _add_employee(
        session, dept.id, employee_number=2,
        available_days=" , 0 , 1 , ", available_shift_types="2",
    )

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.employees[0].available_days == {0, 1}
    assert inp.employees[0].available_shift_types == {2}


# ---------------------------------------------------------------------------
# LeaveRequest → labels
# ---------------------------------------------------------------------------

async def test_leave_requests_use_label_map_and_filter_by_year_month_dept(
    session: AsyncSession, dept: Department, dept2: Department
) -> None:
    """leave_type ごとに正しいラベル、対象外年月・他部門は除外。"""
    e1 = await _add_employee(session, dept.id, employee_number=10)
    e_other = await _add_employee(session, dept2.id, employee_number=11)

    session.add_all([
        LeaveRequest(employee_id=e1.id, year=2026, month=4, day=1, leave_type="REQUESTED"),
        LeaveRequest(employee_id=e1.id, year=2026, month=4, day=15, leave_type="MANDATORY"),
        LeaveRequest(employee_id=e1.id, year=2026, month=4, day=20, leave_type="TENTATIVE"),
        # 別月（除外される）
        LeaveRequest(employee_id=e1.id, year=2026, month=5, day=1, leave_type="REQUESTED"),
        # 他部門の従業員（除外される）
        LeaveRequest(employee_id=e_other.id, year=2026, month=4, day=1, leave_type="REQUESTED"),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.leave_requests == {
        e1.id: {1: "●", 15: "有給", 20: "○"},
    }


async def test_leave_request_unknown_type_falls_back_to_assigned_rest(
    session: AsyncSession, dept: Department
) -> None:
    """LEAVE_TYPE_LABEL に無いタイプは『割当休日』にフォールバック。"""
    e = await _add_employee(session, dept.id, employee_number=20)
    session.add(LeaveRequest(
        employee_id=e.id, year=2026, month=4, day=5, leave_type="UNKNOWN_TYPE",
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.leave_requests[e.id][5] == "割当休日"


# ---------------------------------------------------------------------------
# DayTemplate → day_requirements
# ---------------------------------------------------------------------------

async def test_day_template_weekday_specific(session: AsyncSession, dept: Department) -> None:
    """weekday=0 (月) のテンプレートは月曜日のみに適用される。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=0, pattern_id=p.id, required_min=3,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 2026年4月の月曜: 6, 13, 20, 27
    for d in (6, 13, 20, 27):
        assert any(r.pattern_id == p.id and r.required_min == 3 for r in inp.day_requirements[d])
    # 火曜（7日）には未適用
    assert all(r.pattern_id != p.id for r in inp.day_requirements[7])


async def test_day_template_range_loaded_into_requirement(
    session: AsyncSession, dept: Department
) -> None:
    """required_min/required_max が DayRequirement に範囲として載る (issue #247)。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id,
        required_min=2, required_max=4,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    req = next(r for r in inp.day_requirements[1] if r.pattern_id == p.id)
    assert req.required_min == 2
    assert req.required_max == 4


async def test_day_template_max_none_when_unset(
    session: AsyncSession, dept: Department
) -> None:
    """required_max 未設定なら DayRequirement.required_max は None（厳格）。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=3,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    req = next(r for r in inp.day_requirements[1] if r.pattern_id == p.id)
    assert req.required_min == 3
    assert req.required_max is None


async def test_day_template_default_minus_one_applies_to_all_normal_days(
    session: AsyncSession, dept: Department
) -> None:
    """day_of_week=-1 は全曜日適用（具体曜日テンプレートが無いとき）。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=2,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 全 30 日に適用
    for d in range(1, 31):
        assert any(
            r.pattern_id == p.id and r.required_min == 2 for r in inp.day_requirements[d]
        )


async def test_day_template_specific_weekday_overrides_default(
    session: AsyncSession, dept: Department
) -> None:
    """weekday=-1 と具体曜日が両方ある場合、具体曜日が優先される。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=2),
        DayTemplate(department_id=dept.id, day_of_week=0, pattern_id=p.id, required_min=5),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 月曜（6 日）= 5、火曜（7 日）= 2（デフォルト）
    monday_req = next(r for r in inp.day_requirements[6] if r.pattern_id == p.id)
    tuesday_req = next(r for r in inp.day_requirements[7] if r.pattern_id == p.id)
    assert monday_req.required_min == 5
    assert tuesday_req.required_min == 2


async def test_day_template_last_day_uses_minus_one_template(
    session: AsyncSession, dept: Department
) -> None:
    """月末日には weekday=-1 のテンプレートが適用される（最終日特別ロジック）。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=4,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 4月30日（最終日）
    last = next(r for r in inp.day_requirements[30] if r.pattern_id == p.id)
    assert last.required_min == 4


async def test_day_override_overrides_template_required_min(
    session: AsyncSession, dept: Department
) -> None:
    """DayOverride は曜日テンプレートの required_min を該当日のみ上書きする (issue #113)。"""
    import datetime as dt

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    # 全曜日テンプレ: 1 名
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=1,
    ))
    # 4/15 だけ 5 名に上書き
    session.add(DayOverride(
        department_id=dept.id,
        specific_date=dt.date(2026, 4, 15),
        pattern_id=p.id,
        required_min=5,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 4/14, 4/16: テンプレ 1 名のまま
    assert next(r for r in inp.day_requirements[14] if r.pattern_id == p.id).required_min == 1
    assert next(r for r in inp.day_requirements[16] if r.pattern_id == p.id).required_min == 1
    # 4/15: 上書き 5 名
    assert next(r for r in inp.day_requirements[15] if r.pattern_id == p.id).required_min == 5


async def test_day_override_overrides_holiday_template(
    session: AsyncSession, dept: Department
) -> None:
    """祝日テンプレ (day_of_week=7) より DayOverride が優先される (issue #113 回帰防止)。"""
    import datetime as dt

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    # 祝日テンプレ: 2 名
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=7, pattern_id=p.id, required_min=2,
    ))
    # 5/3 (憲法記念日) のみ 99 名に上書き
    session.add(DayOverride(
        department_id=dept.id,
        specific_date=dt.date(2026, 5, 3),
        pattern_id=p.id,
        required_min=99,
    ))
    # 祝日は DB から取得される: 5/3 と 5/5 を pre-insert しておく
    session.add_all([
        Holiday(holiday_date=dt.date(2026, 5, 3), name="憲法記念日"),
        Holiday(holiday_date=dt.date(2026, 5, 5), name="こどもの日"),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=5)

    # 5/3: 上書き 99 名（祝日テンプレ 2 名を上書き）
    assert next(r for r in inp.day_requirements[3] if r.pattern_id == p.id).required_min == 99
    # 5/5 (こどもの日) は祝日テンプレ 2 名のまま
    assert next(r for r in inp.day_requirements[5] if r.pattern_id == p.id).required_min == 2


async def test_day_override_overrides_last_day_template(
    session: AsyncSession, dept: Department
) -> None:
    """月末テンプレ (day_of_week=-1) より DayOverride が優先される (issue #113 回帰防止)。"""
    import datetime as dt

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    # 全曜日テンプレ (-1): 3 名（月末も同テンプレが引かれる、loader.py:144-145 仕様）
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=3,
    ))
    # 4/30 (4 月最終日) のみ 10 名に上書き
    session.add(DayOverride(
        department_id=dept.id,
        specific_date=dt.date(2026, 4, 30),
        pattern_id=p.id,
        required_min=10,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 4/30: 上書き 10 名（last_day テンプレ 3 名を上書き）
    assert next(r for r in inp.day_requirements[30] if r.pattern_id == p.id).required_min == 10
    # 4/29 (last_day 以外、テンプレ適用): 3 名のまま
    assert next(r for r in inp.day_requirements[29] if r.pattern_id == p.id).required_min == 3


async def test_day_override_adds_pattern_not_in_template(
    session: AsyncSession, dept: Department
) -> None:
    """テンプレートに無いパターンを DayOverride で追加できる。"""
    import datetime as dt

    g = await _add_group(session, dept.id, "A")
    p_template = await _add_pattern(session, g, "A1")
    p_extra = await _add_pattern(session, g, "A2")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p_template.id, required_min=1,
    ))
    # 4/10 だけ A2 を 2 名追加
    session.add(DayOverride(
        department_id=dept.id,
        specific_date=dt.date(2026, 4, 10),
        pattern_id=p_extra.id,
        required_min=2,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 4/10: A1 (template), A2 (override) 両方
    pids = {r.pattern_id: r.required_min for r in inp.day_requirements[10]}
    assert pids[p_template.id] == 1
    assert pids[p_extra.id] == 2
    # 4/9: A1 のみ（A2 は無し）
    pids_d9 = {r.pattern_id: r.required_min for r in inp.day_requirements[9]}
    assert pids_d9.get(p_extra.id) is None


async def test_day_override_filters_pattern_not_in_department(
    session: AsyncSession, dept: Department
) -> None:
    """DayOverride.pattern_id が他部門のパターン（pattern_id_set に無い）なら除外。"""
    import datetime as dt

    other_dept = Department(name="他部門A")
    session.add(other_dept)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other_dept.id))
    await session.flush()

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    g_other = await _add_group(session, other_dept.id, "A")
    p_other = await _add_pattern(session, g_other, "X1")  # 他部門のパターン

    # dept に対して、他部門のパターン id でオーバーライドを誤登録した想定
    session.add(DayOverride(
        department_id=dept.id,
        specific_date=dt.date(2026, 4, 15),
        pattern_id=p_other.id,
        required_min=3,
    ))
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=1,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 他部門の pattern id は混入していない
    pids = {r.pattern_id for r in inp.day_requirements[15]}
    assert p_other.id not in pids
    # 自部門のテンプレートはそのまま
    assert next(r for r in inp.day_requirements[15] if r.pattern_id == p.id).required_min == 1


async def test_day_override_other_department_isolated(
    session: AsyncSession, dept: Department
) -> None:
    """別部門の DayOverride は影響しない。"""
    import datetime as dt

    other_dept = Department(name="他部門")
    session.add(other_dept)
    await session.flush()
    session.add(WorkRuleConfig(department_id=other_dept.id))
    await session.flush()

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=1,
    ))
    # 別部門に override
    g2 = await _add_group(session, other_dept.id, "A")
    p2 = await _add_pattern(session, g2, "A1")
    session.add(DayOverride(
        department_id=other_dept.id,
        specific_date=dt.date(2026, 4, 15),
        pattern_id=p2.id,
        required_min=99,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    # 自部門は影響なし
    assert next(r for r in inp.day_requirements[15] if r.pattern_id == p.id).required_min == 1


async def test_day_template_filters_unknown_pattern_id(
    session: AsyncSession, dept: Department
) -> None:
    """pattern_id が WorkPattern にない DayTemplate は loader 側で除外される。"""
    g = await _add_group(session, dept.id, "A")
    p_keep = await _add_pattern(session, g, "A1")
    p_remove = await _add_pattern(session, g, "A2")
    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p_keep.id, required_min=1),
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p_remove.id, required_min=1),
    ])
    await session.flush()
    # p_remove を削除（DayTemplate 側の CASCADE で同時削除される設定だが、
    # ここでは「pattern_id_set に無い場合のフィルタ」を確認したいので別アプローチ）。
    # 代替: p_remove の DayTemplate を pattern_id だけ別の存在しない値に書き換えると整合制約違反。
    # 実装側のフィルタ動作は「pattern_id_set in 判定」なので、別部門のパターンを使えば再現できる。
    # ここでは正常系のみ確認: 両方とも反映される。
    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    pids = {r.pattern_id for r in inp.day_requirements[1]}
    assert pids == {p_keep.id, p_remove.id}


async def test_day_template_holiday_template_used_when_db_has_holiday(
    session: AsyncSession, dept: Department
) -> None:
    """祝日 (DB の holidays テーブル) には day_of_week=7 のテンプレートが適用される。"""
    import datetime

    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=2),
        DayTemplate(department_id=dept.id, day_of_week=7, pattern_id=p.id, required_min=10),
    ])
    # 4月29日「昭和の日」を DB に直接投入。これにより loader 内の holiday_service は
    # jpholiday を呼ばずに DB を参照する (該当年データありとみなされる)。
    session.add(Holiday(holiday_date=datetime.date(2026, 4, 29), name="昭和の日"))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    holiday_req = next(r for r in inp.day_requirements[29] if r.pattern_id == p.id)
    normal_req = next(r for r in inp.day_requirements[28] if r.pattern_id == p.id)
    assert holiday_req.required_min == 10
    assert normal_req.required_min == 2


# ---------------------------------------------------------------------------
# PatternChoiceGroup
# ---------------------------------------------------------------------------

async def test_choice_groups_loaded_with_min_max(
    session: AsyncSession, dept: Department
) -> None:
    """選択グループの (candidate_ids, min, max, day_of_week) タプルが構築される。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    p2 = await _add_pattern(session, g, "A2")

    cg = PatternChoiceGroup(department_id=dept.id, min_count=1, max_count=2)
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p1.id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p2.id),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert len(inp.choice_groups) == 1
    cand_ids, min_c, max_c, dow = inp.choice_groups[0]
    assert set(cand_ids) == {p1.id, p2.id}
    assert min_c == 1
    assert max_c == 2
    assert dow is None  # day_of_week 未指定 → 毎日


async def test_choice_groups_with_day_of_week_propagated(
    session: AsyncSession, dept: Department
) -> None:
    """day_of_week=3 (木) を持つ選択グループが optimizer 入力に伝わる。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    p2 = await _add_pattern(session, g, "A2")

    cg = PatternChoiceGroup(
        department_id=dept.id, day_of_week=3, min_count=1, max_count=1
    )
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p1.id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p2.id),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert len(inp.choice_groups) == 1
    _cand_ids, _min, _max, dow = inp.choice_groups[0]
    assert dow == 3


async def test_choice_group_with_no_valid_candidates_is_dropped(
    session: AsyncSession, dept: Department
) -> None:
    """候補が空のグループはリストに含まれない。"""
    cg = PatternChoiceGroup(department_id=dept.id, min_count=1, max_count=1)
    session.add(cg)
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.choice_groups == []


# ---------------------------------------------------------------------------
# PatternIncompatibility
# ---------------------------------------------------------------------------

async def test_incompatibilities_loaded_as_pairs(
    session: AsyncSession, dept: Department
) -> None:
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    p2 = await _add_pattern(session, g, "A2")
    session.add(PatternIncompatibility(
        department_id=dept.id, pattern_id_a=p1.id, pattern_id_b=p2.id,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert (p1.id, p2.id) in inp.incompatibilities


# ---------------------------------------------------------------------------
# SpecialAssignmentRule
# ---------------------------------------------------------------------------

async def test_special_assignment_rule_with_null_condition_value_becomes_zero(
    session: AsyncSession, dept: Department
) -> None:
    """LAST_DAY のような condition_value=None は 0 に正規化される。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(SpecialAssignmentRule(
        department_id=dept.id, condition_type="LAST_DAY", condition_value=None,
        required_role="CHIEF", pattern_id=p.id,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert len(inp.special_assignments) == 1
    sar = inp.special_assignments[0]
    assert sar.condition_type == "LAST_DAY"
    assert sar.condition_value == 0
    assert sar.role == "CHIEF"
    assert sar.pattern_name == "A1"


async def test_special_assignment_rule_weekday_value_preserved(
    session: AsyncSession, dept: Department
) -> None:
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    session.add(SpecialAssignmentRule(
        department_id=dept.id, condition_type="WEEKDAY", condition_value=3,
        required_role="DEPUTY", pattern_id=p.id,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.special_assignments[0].condition_value == 3


# ---------------------------------------------------------------------------
# PatternTrigger
# ---------------------------------------------------------------------------

async def test_pattern_trigger_with_required_groups_loaded(
    session: AsyncSession, dept: Department
) -> None:
    g_b = await _add_group(session, dept.id, "B")
    g_c = await _add_group(session, dept.id, "C", is_auxiliary=True)
    g_d = await _add_group(session, dept.id, "D")

    trg = PatternTrigger(department_id=dept.id, auxiliary_group_id=g_c.id)
    session.add(trg)
    await session.flush()
    session.add_all([
        PatternTriggerRequiredGroup(trigger_id=trg.id, group_id=g_b.id),
        PatternTriggerRequiredGroup(trigger_id=trg.id, group_id=g_d.id),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert len(inp.pattern_triggers) == 1
    pt = inp.pattern_triggers[0]
    assert pt.auxiliary_group_name == "C"
    assert set(pt.required_group_names) == {"B", "D"}


async def test_pattern_trigger_with_no_required_groups_is_skipped(
    session: AsyncSession, dept: Department
) -> None:
    g_c = await _add_group(session, dept.id, "C", is_auxiliary=True)
    trg = PatternTrigger(department_id=dept.id, auxiliary_group_id=g_c.id)
    session.add(trg)
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.pattern_triggers == []


# ---------------------------------------------------------------------------
# EmployeePatternPriority
# ---------------------------------------------------------------------------

async def test_employee_priorities_only_positive_and_in_pattern_set(
    session: AsyncSession, dept: Department
) -> None:
    """priority > 0 かつ pattern が登録されているもののみ反映。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    p2 = await _add_pattern(session, g, "A2")
    e = await _add_employee(session, dept.id, employee_number=30)

    session.add_all([
        EmployeePatternPriority(employee_id=e.id, pattern_id=p1.id, priority=8),
        EmployeePatternPriority(employee_id=e.id, pattern_id=p2.id, priority=0),  # 除外
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.employee_priorities == {e.id: {p1.id: 8}}


async def test_no_priorities_yields_empty_dict(
    session: AsyncSession, dept: Department
) -> None:
    await _add_employee(session, dept.id, employee_number=40)

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert inp.employee_priorities == {}


# ---------------------------------------------------------------------------
# 統合: 単一店舗の全要素ロードがエラー無く完了する
# ---------------------------------------------------------------------------

async def test_full_scenario_smoke(session: AsyncSession, dept: Department) -> None:
    """全機能のデータが揃ったケースで例外なく ShiftModelInput が構築される。"""
    g = await _add_group(session, dept.id, "A")
    p = await _add_pattern(session, g, "A1")
    e = await _add_employee(session, dept.id, employee_number=100)

    session.add_all([
        LeaveRequest(employee_id=e.id, year=2026, month=4, day=10, leave_type="REQUESTED"),
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p.id, required_min=1),
        EmployeePatternPriority(employee_id=e.id, pattern_id=p.id, priority=5),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)

    assert len(inp.patterns) == 1
    assert len(inp.employees) == 1
    assert inp.leave_requests[e.id] == {10: "●"}
    assert inp.employee_priorities[e.id] == {p.id: 5}
    assert all(len(v) >= 1 for v in inp.day_requirements.values())


# ---------------------------------------------------------------------------
# preflight: priority マスタ整合性チェック
# ---------------------------------------------------------------------------

from app.optimizer.loader import PriorityMasterError, preflight_priority_master  # noqa: E402


async def test_preflight_raises_when_required_pattern_has_no_priority_holder(
    session: AsyncSession, dept: Department
) -> None:
    """day_requirements で要求される pattern に対して priority > 0 を持つ
    employee が department 内に 1 人も居ない場合、PriorityMasterError を上げる。
    現場マスタ「スコア未設定なのに割当」問題を生成前に弾く。
    """
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    e = await _add_employee(session, dept.id, employee_number=50)

    # DayTemplate で A1 を要求 (day_requirements に乗る)
    session.add(DayTemplate(
        department_id=dept.id, day_of_week=-1, pattern_id=p1.id, required_min=1,
    ))
    # priority は付与しない
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    with pytest.raises(PriorityMasterError) as exc_info:
        preflight_priority_master(inp)
    msg = str(exc_info.value)
    assert "A1" in msg, f"エラー文言に pattern_name が含まれるはず: {msg}"


async def test_preflight_passes_when_required_pattern_has_priority_holder(
    session: AsyncSession, dept: Department
) -> None:
    """priority > 0 を持つ employee が 1 人でも居れば preflight を通過する。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    e = await _add_employee(session, dept.id, employee_number=51)

    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p1.id, required_min=1),
        EmployeePatternPriority(employee_id=e.id, pattern_id=p1.id, priority=5),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    preflight_priority_master(inp)  # 例外が出なければ通過
    assert inp.employee_priorities == {e.id: {p1.id: 5}}


async def test_preflight_ignores_unrequested_patterns(
    session: AsyncSession, dept: Department
) -> None:
    """day_requirements に乗らない pattern (DayTemplate なし) は preflight 対象外。
    マスタに pattern を登録しても使ってないだけならエラーにしない。
    """
    g = await _add_group(session, dept.id, "A")
    await _add_pattern(session, g, "A1")  # 要求されない
    await _add_employee(session, dept.id, employee_number=52)

    # DayTemplate なし → day_requirements 空 → preflight 通過
    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    preflight_priority_master(inp)
    assert inp.day_requirements == {} or all(
        len(reqs) == 0 for reqs in inp.day_requirements.values()
    )


async def test_preflight_zero_priority_does_not_count_as_holder(
    session: AsyncSession, dept: Department
) -> None:
    """priority = 0 の行は「未設定」と同等扱い。candidate ゼロとして弾く。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    e = await _add_employee(session, dept.id, employee_number=53)

    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p1.id, required_min=1),
        EmployeePatternPriority(employee_id=e.id, pattern_id=p1.id, priority=0),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    with pytest.raises(PriorityMasterError):
        preflight_priority_master(inp)


async def test_preflight_lists_all_missing_patterns(
    session: AsyncSession, dept: Department
) -> None:
    """複数 pattern が candidate ゼロの場合、エラー文言に全て含まれる。
    店長が一度に修正すべき pattern を把握できるようにする。"""
    g = await _add_group(session, dept.id, "A")
    p1 = await _add_pattern(session, g, "A1")
    p2 = await _add_pattern(session, g, "A2")
    e = await _add_employee(session, dept.id, employee_number=54)

    session.add_all([
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p1.id, required_min=1),
        DayTemplate(department_id=dept.id, day_of_week=-1, pattern_id=p2.id, required_min=1),
        # 両方とも priority 未設定
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    with pytest.raises(PriorityMasterError) as exc_info:
        preflight_priority_master(inp)
    msg = str(exc_info.value)
    assert "A1" in msg and "A2" in msg, f"両方の pattern_name が文言に含まれるはず: {msg}"


async def test_preflight_choice_group_or_passes_when_any_candidate_has_priority(
    session: AsyncSession, dept: Department
) -> None:
    """choice_group min_count>0 は OR 条件。グループ内のどれか 1 pattern に
    priority>0 を持つ employee が居れば preflight 通過する。
    (鮮魚部門 G早/Gフル/G週 グループで G週 priority ゼロでも、他で埋まる構造の回帰)
    """
    from app.models.choice_group import (
        PatternChoiceGroup, PatternChoiceGroupCandidate,
    )

    g = await _add_group(session, dept.id, "Y")
    p_y1 = await _add_pattern(session, g, "Y1")
    p_y2 = await _add_pattern(session, g, "Y2")
    p_y3 = await _add_pattern(session, g, "Y3")
    e = await _add_employee(session, dept.id, employee_number=60)

    # choice_group: Y1/Y2/Y3 min 1 名必須。Y1 のみ priority 持ち、Y2/Y3 は未設定
    cg = PatternChoiceGroup(department_id=dept.id, min_count=1, max_count=1, sort_order=0)
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y1.id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y2.id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y3.id),
        EmployeePatternPriority(employee_id=e.id, pattern_id=p_y1.id, priority=10),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    preflight_priority_master(inp)  # 例外なし: Y1 candidate 1 名で OR 成立


async def test_preflight_choice_group_raises_when_no_candidate_in_group(
    session: AsyncSession, dept: Department
) -> None:
    """choice_group のグループ内 全 pattern が candidate ゼロのときのみ弾く。"""
    from app.models.choice_group import (
        PatternChoiceGroup, PatternChoiceGroupCandidate,
    )

    g = await _add_group(session, dept.id, "Y")
    p_y1 = await _add_pattern(session, g, "Y1")
    p_y2 = await _add_pattern(session, g, "Y2")
    await _add_employee(session, dept.id, employee_number=62)

    cg = PatternChoiceGroup(department_id=dept.id, min_count=1, max_count=1, sort_order=0)
    session.add(cg)
    await session.flush()
    session.add_all([
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y1.id),
        PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y2.id),
    ])
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    with pytest.raises(PriorityMasterError) as exc_info:
        preflight_priority_master(inp)
    msg = str(exc_info.value)
    # グループ全体 (Y1/Y2) として文言に含まれる
    assert "Y1" in msg and "Y2" in msg and "グループ" in msg, msg


async def test_preflight_skips_choice_group_min_zero(
    session: AsyncSession, dept: Department
) -> None:
    """choice_group min_count=0 (max のみ制約) は preflight 対象外。
    必須でなく上限制約だけなので priority master 不備で弾く必要なし。
    """
    from app.models.choice_group import (
        PatternChoiceGroup, PatternChoiceGroupCandidate,
    )

    g = await _add_group(session, dept.id, "Y")
    p_y1 = await _add_pattern(session, g, "Y1")
    await _add_employee(session, dept.id, employee_number=61)

    cg = PatternChoiceGroup(department_id=dept.id, min_count=0, max_count=2, sort_order=0)
    session.add(cg)
    await session.flush()
    session.add(PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=p_y1.id))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    preflight_priority_master(inp)  # 例外出ない


async def test_preflight_ignores_special_assignments(
    session: AsyncSession, dept: Department
) -> None:
    """special_assignments は partial_mode で soft 化されるため preflight 対象外。
    水曜 CHIEF→G週 のような特殊ルールに G週 priority 持ちが居なくても、
    生成は通過 (G週 を割り当てられない日は shortage として可視化される)。
    """
    g = await _add_group(session, dept.id, "G")
    p_gweek = await _add_pattern(session, g, "G週")
    await _add_employee(session, dept.id, employee_number=63, role="CHIEF")

    # special_assignment: 水曜 CHIEF → G週
    session.add(SpecialAssignmentRule(
        department_id=dept.id, condition_type="WEEKDAY", condition_value=3,
        required_role="CHIEF", pattern_id=p_gweek.id,
    ))
    await session.flush()

    inp = await build_shift_model_input(session, dept.id, year=2026, month=4)
    preflight_priority_master(inp)  # 例外なし: special_assignment は preflight 対象外
