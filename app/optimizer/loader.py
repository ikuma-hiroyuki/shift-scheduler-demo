"""
app/optimizer/loader.py — DB レコード → ShiftModelInput 変換

DBの各モデルを app.optimizer.cp_sat_model の ShiftModelInput に変換する。
"""
from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import LEAVE_TYPE_LABEL
from app.models.choice_group import PatternChoiceGroup, PatternIncompatibility
from app.models.day_template import DayOverride, DayTemplate
from app.models.department import WorkRuleConfig
from app.models.employee import Employee, EmployeePatternPriority
from app.models.leave_request import LeaveRequest
from app.models.pattern_rule import PatternTrigger, SpecialAssignmentRule
from app.models.role import Role
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.optimizer.cp_sat_model import (
    DayRequirement,
    Employee as CpEmployee,
    PatternTrigger as CpPatternTrigger,
    ShiftModelInput,
    SpecialAssignmentRule as CpSpecialAssignmentRule,
    WorkPattern as CpWorkPattern,
)
from app.services import holiday_service


class PriorityMasterError(ValueError):
    """priority マスタの整合性チェック (preflight) で検出した不備。

    day_requirements で要求される pattern に対して priority > 0 を持つ
    employee が department 内に 1 人も居ない場合に発生する。
    現場マスタ「スコア未設定なのに割当」問題を生成開始前に弾くためのガード。
    """


def preflight_priority_master(inp: ShiftModelInput) -> None:
    """ShiftModelInput が利用する pattern 群について、priority > 0 を持つ
    candidate が 1 人以上居ることを検証する。candidate ゼロの pattern が
    あれば PriorityMasterError を上げる。

    対象は「単独で必須」な pattern のみ:
      - day_requirements (DayTemplate / DayOverride 経由で要求される pattern)
        → 各 pattern 単独で必須なので、各 pattern に candidate>0 が必要
      - choice_groups (min_count > 0) は OR 条件なので、グループ全体で
        candidate>0 を確認する。グループ内のどれか 1 つでも priority>0 を
        持つ employee が居れば preflight 通過。

    special_assignments は preflight から除外:
      partial_mode で soft 化される (●/有給 日は violated slack で諦め可)
      ため、hard 必須扱いで弾くと「マスタ整っているのに INFEASIBLE」になる。

    `build_shift_model_input` からは呼ばない (テスト容易性のため)。
    生成ワーカー (shift_tasks.generate_shift) が build 直後に明示呼び出しする。

    Raises:
        PriorityMasterError: candidate ゼロの pattern (単独必須) または
            グループ全体で candidate ゼロの choice_group が見つかった場合。
    """
    pid_to_name = {p.id: p.pattern_name for p in inp.patterns}

    # day_requirements: 各 pattern 単独で必須
    required_solo_pattern_ids: set[int] = set()
    for reqs in inp.day_requirements.values():
        for req in reqs:
            if req.required_min > 0:
                required_solo_pattern_ids.add(req.pattern_id)

    # employee_priorities を pattern_id → count に集約
    candidate_counts: dict[int, int] = {}
    for prio_map in inp.employee_priorities.values():
        for pid, pri in prio_map.items():
            if pri > 0:
                candidate_counts[pid] = candidate_counts.get(pid, 0) + 1

    missing_names: list[str] = []

    # 単独必須 pattern: 各々で candidate 0 を弾く
    for pid in required_solo_pattern_ids:
        if candidate_counts.get(pid, 0) == 0:
            missing_names.append(pid_to_name.get(pid, f"pattern#{pid}"))

    # choice_groups: OR 条件、グループ全体で candidate 0 を弾く
    for candidate_ids, min_count, _max_count, _dow in inp.choice_groups:
        if min_count <= 0:
            continue
        total = sum(candidate_counts.get(pid, 0) for pid in candidate_ids)
        if total == 0:
            names = sorted(
                pid_to_name.get(pid, f"pattern#{pid}") for pid in candidate_ids
            )
            missing_names.append("/".join(names) + " (グループ)")

    if not missing_names:
        return

    raise PriorityMasterError(
        "priority_master_incomplete: 要求 pattern に priority 設定済み "
        "employee が居ません: " + ", ".join(sorted(set(missing_names)))
    )


async def build_shift_model_input(
    db: AsyncSession,
    department_id: int,
    year: int,
    month: int,
) -> ShiftModelInput:
    """department_id の全マスタを DB から読み込んで ShiftModelInput を構築する。"""

    # ---- WorkPatternGroup + WorkPattern ----
    grp_result = await db.execute(
        select(WorkPatternGroup)
        .where(WorkPatternGroup.department_id == department_id)
        .options(selectinload(WorkPatternGroup.patterns))
    )
    groups: list[WorkPatternGroup] = list(grp_result.scalars().all())

    cp_patterns: list[CpWorkPattern] = []
    group_id_to_name: dict[int, str] = {}
    for g in groups:
        group_id_to_name[g.id] = g.name
        for p in g.patterns:
            cp_patterns.append(CpWorkPattern(
                id=p.id,
                group_name=g.name,
                pattern_name=p.pattern_name,
                shift_type=p.shift_type,
                shift_start=p.shift_start,
                shift_end=p.shift_end,
            ))

    pattern_id_set = {p.id for p in cp_patterns}
    pattern_id_to_name = {p.id: p.pattern_name for p in cp_patterns}

    # ---- Employee ----
    emp_result = await db.execute(
        select(Employee)
        .where(Employee.department_id == department_id)
        .options(selectinload(Employee.pattern_priorities))
    )
    db_employees: list[Employee] = list(emp_result.scalars().all())

    cp_employees: list[CpEmployee] = []
    for e in db_employees:
        available_days = {int(d) for d in e.available_days.split(",") if d.strip()}
        available_shift_types = {int(s) for s in e.available_shift_types.split(",") if s.strip()}
        cp_employees.append(CpEmployee(
            id=e.id,
            name=e.name,
            role=e.role,
            available_days=available_days,
            available_shift_types=available_shift_types,
            consecutive_workable=e.consecutive_workable,
            employee_number=e.employee_number,
        ))

    # ---- LeaveRequest → leave_requests ----
    lr_result = await db.execute(
        select(LeaveRequest)
        .where(
            LeaveRequest.year == year,
            LeaveRequest.month == month,
        )
        .join(Employee, LeaveRequest.employee_id == Employee.id)
        .where(Employee.department_id == department_id)
    )
    leave_requests: dict[int, dict[int, str]] = {}
    for lr in lr_result.scalars().all():
        label = LEAVE_TYPE_LABEL.get(lr.leave_type, "割当休日")
        leave_requests.setdefault(lr.employee_id, {})[lr.day] = label

    # ---- DayTemplate → day_requirements ----
    dt_result = await db.execute(
        select(DayTemplate).where(DayTemplate.department_id == department_id)
    )
    tpl_tuples = [
        (t.day_of_week, t.pattern_id, t.required_min, t.required_max)
        for t in dt_result.scalars().all()
        if t.pattern_id in pattern_id_set
    ]

    # ---- DayOverride → 特定日上書きマップ ----
    # 同部門・対象月内のオーバーライドのみ取得し、(date, pattern_id) → (required_min, required_max)
    # の索引を作る。曜日テンプレ評価後に当該日のパターン別必要人数を上書きする。
    # 月フィルタは EXTRACT で DB 側に押し下げ（将来 override テーブルが
    # 大規模化したときに 1 月分だけスキャンするため）。
    override_result = await db.execute(
        select(DayOverride).where(
            DayOverride.department_id == department_id,
            extract("year", DayOverride.specific_date) == year,
            extract("month", DayOverride.specific_date) == month,
        )
    )
    day_override_map: dict[date, dict[int, tuple[int, int | None]]] = {}
    for ov in override_result.scalars().all():
        if ov.pattern_id not in pattern_id_set:
            continue
        day_override_map.setdefault(ov.specific_date, {})[ov.pattern_id] = (
            ov.required_min,
            ov.required_max,
        )

    num_days = calendar.monthrange(year, month)[1]
    holiday_records = await holiday_service.list_holidays(db, year, month)
    holidays: dict[int, str] = {h.holiday_date.day: h.name for h in holiday_records}
    has_holiday_tpl = any(tw == 7 for tw, _, _, _ in tpl_tuples)

    day_requirements: dict[int, list[DayRequirement]] = {}
    for d in range(1, num_days + 1):
        date_obj = date(year, month, d)
        weekday = date_obj.weekday()
        is_holiday = d in holidays
        is_last_day = (d == num_days)
        use_holiday_tpl = is_holiday and has_holiday_tpl
        by_pattern: dict[int, tuple[int, int | None]] = {}
        for tmpl_weekday, pid, rmin, rmax in tpl_tuples:
            if use_holiday_tpl:
                if tmpl_weekday == 7:
                    by_pattern[pid] = (rmin, rmax)
            elif is_last_day:
                if tmpl_weekday == -1:
                    by_pattern[pid] = (rmin, rmax)
            else:
                if tmpl_weekday == weekday:
                    by_pattern[pid] = (rmin, rmax)
                elif tmpl_weekday == -1 and pid not in by_pattern:
                    by_pattern[pid] = (rmin, rmax)
        # 特定日上書きは曜日テンプレより優先
        if date_obj in day_override_map:
            by_pattern.update(day_override_map[date_obj])
        day_requirements[d] = [
            DayRequirement(pid, mn, mx) for pid, (mn, mx) in by_pattern.items()
        ]

    # ---- PatternChoiceGroup → choice_groups ----
    cg_result = await db.execute(
        select(PatternChoiceGroup)
        .where(PatternChoiceGroup.department_id == department_id)
        .options(selectinload(PatternChoiceGroup.candidates))
    )
    # 4 番目の要素 day_of_week は null=毎日、0=月〜6=日。
    # H11 制約は dow が一致する日のみ（または毎日）に適用する。
    choice_groups: list[tuple[list[int], int, int, int | None]] = []
    for cg in cg_result.scalars().all():
        candidate_ids = [c.pattern_id for c in cg.candidates if c.pattern_id in pattern_id_set]
        if candidate_ids:
            choice_groups.append(
                (candidate_ids, cg.min_count, cg.max_count, cg.day_of_week)
            )

    # ---- PatternIncompatibility → incompatibilities ----
    inc_result = await db.execute(
        select(PatternIncompatibility)
        .where(PatternIncompatibility.department_id == department_id)
    )
    incompatibilities: list[tuple[int, int]] = [
        (inc.pattern_id_a, inc.pattern_id_b)
        for inc in inc_result.scalars().all()
        if inc.pattern_id_a in pattern_id_set and inc.pattern_id_b in pattern_id_set
    ]

    # ---- SpecialAssignmentRule ----
    sar_result = await db.execute(
        select(SpecialAssignmentRule)
        .where(SpecialAssignmentRule.department_id == department_id)
    )
    special_assignments: list[CpSpecialAssignmentRule] = []
    for sar in sar_result.scalars().all():
        pname = pattern_id_to_name.get(sar.pattern_id)
        if pname is None:
            continue
        special_assignments.append(CpSpecialAssignmentRule(
            condition_type=sar.condition_type,
            condition_value=sar.condition_value if sar.condition_value is not None else 0,
            role=sar.required_role,
            pattern_name=pname,
        ))

    # ---- PatternTrigger ----
    pt_result = await db.execute(
        select(PatternTrigger)
        .where(PatternTrigger.department_id == department_id)
        .options(selectinload(PatternTrigger.required_groups))
    )
    pattern_triggers: list[CpPatternTrigger] = []
    for pt in pt_result.scalars().all():
        aux_name = group_id_to_name.get(pt.auxiliary_group_id)
        if aux_name is None:
            continue
        req_names = [
            group_id_to_name[rg.group_id]
            for rg in pt.required_groups
            if rg.group_id in group_id_to_name
        ]
        if req_names:
            pattern_triggers.append(CpPatternTrigger(
                auxiliary_group_name=aux_name,
                required_group_names=req_names,
            ))

    # ---- EmployeePatternPriority → employee_priorities ----
    employee_priorities: dict[int, dict[int, int]] = {}
    for e in db_employees:
        for pp in e.pattern_priorities:
            if pp.pattern_id in pattern_id_set and pp.priority > 0:
                employee_priorities.setdefault(e.id, {})[pp.pattern_id] = pp.priority

    # ---- Role 表 → rest_days_by_role (issue #235) ----
    # データフロー: roles 表 → 1 query で全 role fetch → Role.rest_days_for(num_days)
    # で num_days に対応するバケツの値を選択 → ShiftModelInput.rest_days_by_role
    # を構築。N+1 回避のため select() 単発で全件取得。
    roles_result = await db.execute(select(Role))
    roles = list(roles_result.scalars().all())
    rest_days_by_role: dict[str, int] = {
        r.code: r.rest_days_for(num_days) for r in roles
    }

    # ---- WorkRuleConfig → 残 2 列 (standard_hours / max_overtime) ----
    wrc_result = await db.execute(
        select(WorkRuleConfig).where(WorkRuleConfig.department_id == department_id)
    )
    config = wrc_result.scalar_one_or_none()
    if config is not None:
        standard_hours = config.standard_work_hours_per_day
        max_overtime = config.max_overtime_hours_staff
    else:
        standard_hours = 8.0
        max_overtime = 40.0

    return ShiftModelInput(
        year=year,
        month=month,
        employees=cp_employees,
        patterns=cp_patterns,
        day_requirements=day_requirements,
        leave_requests=leave_requests,
        choice_groups=choice_groups,
        incompatibilities=incompatibilities,
        special_assignments=special_assignments,
        pattern_triggers=pattern_triggers,
        employee_priorities=employee_priorities,
        rest_days_by_role=rest_days_by_role,
        standard_hours_per_day=standard_hours,
        max_overtime_hours=max_overtime,
    )
