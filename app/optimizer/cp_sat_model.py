"""
app/optimizer/cp_sat_model.py — CP-SAT シフト最適化モデル（ハード制約 H1〜H13、ソフト制約 S1〜S5）

OR-Tools CP-SAT ベースのソルバーモデル本体。`adapter.py` から呼び出され、
DB ローダー (`loader.py`) が組み立てた `ShiftModelInput` を解く。
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date

from ortools.sat.python import cp_model

from app.optimizer.types import ShortageRow


# ---------------------------------------------------------------------------
# データクラス
# ---------------------------------------------------------------------------

@dataclass
class Employee:
    id: int
    name: str
    role: str                       # CHIEF / DEPUTY / STAFF / FULLPART / MORNINGPART
    available_days: set[int]        # 0=月〜6=日
    available_shift_types: set[int] # 1=早番 2=フル番 3=遅番
    consecutive_workable: bool = True  # True=連勤可能（最大6連勤）/ False=連勤NG（歯抜け選好）
    employee_number: int = 0        # 会社支給の社員番号（参照用）


@dataclass
class WorkPattern:
    id: int
    group_name: str    # 作業パターングループ（A / B / C / D / E など）
    pattern_name: str  # 作業パターン名（A1 / A2 / A3 / B1 / B2 など）
    shift_type: int    # 1=早番 2=フル番 3=遅番
    shift_start: str   # "07:00"
    shift_end: str     # "20:15"

    @property
    def duration_hours(self) -> float:
        sh, sm = map(int, self.shift_start.split(":"))
        eh, em = map(int, self.shift_end.split(":"))
        total_min = (eh * 60 + em) - (sh * 60 + sm)
        rest_min = 75 if total_min >= 480 else (60 if total_min >= 360 else 0)
        return (total_min - rest_min) / 60.0


@dataclass
class DayRequirement:
    pattern_id: int
    required_min: int                # 最小必要人数
    required_max: int | None = None  # None=ちょうど required_min（厳格）。値あり=範囲 min〜max


@dataclass
class SpecialAssignmentRule:
    condition_type: str   # "WEEKDAY" | "LAST_DAY"
    condition_value: int  # 曜日番号（WEEKDAY 時）/ 0（LAST_DAY 時）
    role: str             # "CHIEF" | "DEPUTY"
    pattern_name: str     # 作業パターン名（patterns.csv の pattern_name）


@dataclass
class PatternTrigger:
    """H12: 補助ポジション発生条件
    auxiliary_group_name のグループが使われる日は、
    required_group_names の全グループにも必ず誰かが割り当てられている必要がある。
    """
    auxiliary_group_name: str       # "C"
    required_group_names: list[str] # ["B", "D", "E"]


@dataclass
class ShiftModelInput:
    year: int
    month: int
    employees: list[Employee]
    patterns: list[WorkPattern]
    # day(1-31) → [DayRequirement, ...]
    day_requirements: dict[int, list[DayRequirement]]
    # employee_id → {day → 表示ラベル}
    # ラベル: "●"=希望休, "○"=仮休, "有給"=有給, "割当休日"=通常休（区分なし）
    leave_requests: dict[int, dict[int, str]]
    # ([pattern_ids], min_count, max_count)
    # 各 tuple = (candidate_pattern_ids, min_count, max_count, day_of_week)
    # day_of_week: None=毎日, 0=月〜6=日。指定があれば該当曜日のみに H11 を適用する。
    choice_groups: list[tuple[list[int], int, int, int | None]]
    # (pattern_id_a, pattern_id_b) — 同日に両方使用不可
    incompatibilities: list[tuple[int, int]] = field(default_factory=list)
    # 特別割当ルール（木曜/月末など）
    special_assignments: list[SpecialAssignmentRule] = field(default_factory=list)
    # H12: 補助ポジション発生条件（C は B・D・E 全員埋まり時のみ）
    pattern_triggers: list[PatternTrigger] = field(default_factory=list)
    # role → 月間休日数 (== 役職マスタ値)。issue #235 でデータソースは Role 表に移行 +
    # H3 を equality (== required) に変更。
    # 空 dict default + .get(e.role, 9) defensive (line 204, 217) の二重防御。
    # テストや loader が必ず明示的に渡す前提。Phase 6 で per-department override が
    # 必要になったらここを dict[(dept_id, role), int] 等に拡張する。
    rest_days_by_role: dict[str, int] = field(default_factory=dict)
    # S3: employee_id → {pattern_id → priority(0-10)}
    employee_priorities: dict[int, dict[int, int]] = field(default_factory=dict)
    standard_hours_per_day: float = 8.0
    max_overtime_hours: float = 40.0


# ---------------------------------------------------------------------------
# ソルバー
# ---------------------------------------------------------------------------

class ShiftModelBuilder:

    def __init__(
        self,
        inp: ShiftModelInput,
        *,
        partial_mode: bool = False,
    ):
        """シフトモデルビルダー。

        Args:
            partial_mode: True のとき H1 (シフト枠必要人数) を hard `==` から
                soft `>= required - shortage` に緩和し、不足分にペナルティを掛ける。
                INFEASIBLE 状態で `solve_partial` から呼び出される。
        """
        self.inp = inp
        self.model = cp_model.CpModel()
        self.num_days = calendar.monthrange(inp.year, inp.month)[1]
        self.days = list(range(1, self.num_days + 1))
        self.pattern_map: dict[int, WorkPattern] = {p.id: p for p in inp.patterns}
        self.partial_mode = partial_mode
        # (employee_id, day, pattern_id) → BoolVar
        self.assign: dict[tuple[int, int, int], cp_model.IntVar] = {}
        # (employee_id, day) → BoolVar
        self.rest: dict[tuple[int, int], cp_model.IntVar] = {}
        # partial_mode=True のとき (day, pattern_id) → 不足変数 IntVar
        self.shortage_vars: dict[tuple[int, int], cp_model.IntVar] = {}
        # partial_mode=True のとき day → 管理職不在 BoolVar
        self.manager_gap_vars: dict[int, cp_model.IntVar] = {}
        # partial_mode=True のとき choice_group の不足 slack 変数。
        # 各要素 = (group_idx, day, slack_var, candidate_pattern_ids, min_count)
        self.choice_group_slacks: list[
            tuple[int, int, cp_model.IntVar, list[int], int]
        ] = []
        # ソフト制約の目的関数項（最大化）
        self._objective_terms: list = []

    # ------------------------------------------------------------------
    # 変数生成
    # ------------------------------------------------------------------

    def _create_variables(self) -> None:
        for e in self.inp.employees:
            for d in self.days:
                self.rest[(e.id, d)] = self.model.new_bool_var(f"rest_e{e.id}_d{d}")
                for p in self.inp.patterns:
                    self.assign[(e.id, d, p.id)] = self.model.new_bool_var(
                        f"a_e{e.id}_d{d}_p{p.id}"
                    )

    # ------------------------------------------------------------------
    # H1: 作業パターン枠の充足（必要人数の確保）
    # ------------------------------------------------------------------

    def _h1_pattern_coverage(self) -> None:
        for d in self.days:
            for req in self.inp.day_requirements.get(d, []):
                assigned_sum = sum(
                    self.assign[(e.id, d, req.pattern_id)]
                    for e in self.inp.employees
                )
                if req.required_max is None:
                    # 厳格: ちょうど required_min
                    if self.partial_mode:
                        # SOFT: assigned + shortage == min、shortage に高ペナルティ
                        shortage = self.model.new_int_var(
                            0, req.required_min, f"shortage_d{d}_p{req.pattern_id}"
                        )
                        self.shortage_vars[(d, req.pattern_id)] = shortage
                        self.model.add(assigned_sum + shortage == req.required_min)
                        self._objective_terms.append(-self._SHORTAGE_PENALTY * shortage)
                    else:
                        # HARD: assigned == min
                        self.model.add(assigned_sum == req.required_min)
                else:
                    # 範囲: required_min <= assigned <= required_max
                    # 上限は partial でも常に hard（超過は不足の概念に無関係）
                    self.model.add(assigned_sum <= req.required_max)
                    if self.partial_mode:
                        # SOFT: 下限割れを shortage で許容（上限 hard は維持）
                        shortage = self.model.new_int_var(
                            0, req.required_min, f"shortage_d{d}_p{req.pattern_id}"
                        )
                        self.shortage_vars[(d, req.pattern_id)] = shortage
                        self.model.add(assigned_sum + shortage >= req.required_min)
                        self._objective_terms.append(-self._SHORTAGE_PENALTY * shortage)
                    else:
                        # HARD: assigned >= min
                        self.model.add(assigned_sum >= req.required_min)

    # ------------------------------------------------------------------
    # H2: 1人1日1アサイン（勤務 or 休日のいずれか1つ）
    # ------------------------------------------------------------------

    def _h2_one_assignment_per_day(self) -> None:
        for e in self.inp.employees:
            for d in self.days:
                all_vars = [self.assign[(e.id, d, p.id)] for p in self.inp.patterns]
                all_vars.append(self.rest[(e.id, d)])
                self.model.add_exactly_one(all_vars)

    # ------------------------------------------------------------------
    # H3: 月間休日数（role 別）— issue #235 (cascade C 案)
    #   旧: `>= required` のみ → 上限が無く「マスタ設定値より大幅に多い」状態。
    #   A 案 (`== required`): priority master 不備時に standard / partial 両方詰む。
    #   B 案 (両側 bound + slack=2): partial_mode で H5 soft 化されても H3 上限が
    #     forced rest (希望休/有給/連勤上限/勤務不可曜日) と衝突して詰む。
    #   C 案: 下限 hard / 上限 soft penalty。
    #     - standard solve (partial_mode=False): `[required, required + slack]` 両側 hard
    #     - solve_partial (partial_mode=True):
    #         hard: `rest_sum >= required` (過剰勤務防止)
    #         soft: `over_rest = max(0, rest_sum - required - slack)` をペナルティ化
    #     これで partial_mode は必ず feasible (`>=` 旧版同等) かつ最適化方向は
    #     「マスタ値 + slack を超える休日数」を最小化する。
    # ------------------------------------------------------------------

    REST_DAYS_SLACK: int = 2
    _OVER_REST_PENALTY = 5_000  # SHORTAGE (10_000) より低、FAIRNESS (20) より遥かに高

    def _h3_monthly_rest_days(self) -> None:
        for e in self.inp.employees:
            required = self.inp.rest_days_by_role.get(e.role, 9)
            rest_sum = sum(self.rest[(e.id, d)] for d in self.days)
            self.model.add(rest_sum >= required)
            upper = required + self.REST_DAYS_SLACK
            if self.partial_mode:
                over_rest = self.model.new_int_var(
                    0, self.num_days, f"over_rest_e{e.id}"
                )
                self.model.add(over_rest >= rest_sum - upper)
                self._objective_terms.append(-self._OVER_REST_PENALTY * over_rest)
            else:
                self.model.add(rest_sum <= upper)

    # ------------------------------------------------------------------
    # H4: 残業上限（社員・副主任・主任のみ）
    # ------------------------------------------------------------------

    def _h4_overtime_limit(self) -> None:
        for e in self.inp.employees:
            if e.role not in ("CHIEF", "DEPUTY", "STAFF"):
                continue
            min_rest = self.inp.rest_days_by_role.get(e.role, 9)
            max_work_days = self.num_days - min_rest
            actual_scaled = sum(
                self.assign[(e.id, d, p.id)] * int(self.pattern_map[p.id].duration_hours * 100)
                for d in self.days
                for p in self.inp.patterns
            )
            standard_scaled = int(self.inp.standard_hours_per_day * max_work_days * 100)
            overtime_limit_scaled = int(self.inp.max_overtime_hours * 100)
            self.model.add(actual_scaled - standard_scaled <= overtime_limit_scaled)

    # ------------------------------------------------------------------
    # H5: 管理職（主任・副主任）の毎日出勤保証
    # ------------------------------------------------------------------

    def _h5_manager_daily_coverage(self) -> None:
        managers = [e for e in self.inp.employees if e.role in ("CHIEF", "DEPUTY")]
        for d in self.days:
            manager_assigned = sum(
                self.assign[(e.id, d, p.id)]
                for e in managers
                for p in self.inp.patterns
            )
            if self.partial_mode:
                # SOFT: 管理職全員 ● の日は manager_gap を立てて高ペナルティ
                gap = self.model.new_bool_var(f"mgr_gap_d{d}")
                # manager_assigned + gap >= 1
                self.model.add(manager_assigned + gap >= 1)
                self.manager_gap_vars[d] = gap
                self._objective_terms.append(-self._MANAGER_GAP_PENALTY * gap)
            else:
                self.model.add(manager_assigned >= 1)

    # ------------------------------------------------------------------
    # H6/H7: 特別割当ルール（special_assignments.csv から動的に読み込む）
    #   例: 木曜は主任を A3 に固定、月末は主任を A2 に固定
    #   主任が有給の場合は副主任へフォールバック
    #   LAST_DAY ルールは WEEKDAY ルールより優先（同日競合を防ぐ）
    #   `fired_roles` を role 単位で管理することで、同日に CHIEF / DEPUTY
    #   別の rule が両方発火する（issue #114）
    # ------------------------------------------------------------------

    def _special_assignments(self) -> None:
        pattern_by_name = {p.pattern_name: p for p in self.inp.patterns}
        role_to_emp = {e.role: e for e in self.inp.employees}
        deputies = [e for e in self.inp.employees if e.role == "DEPUTY"]

        def _force_assign(emp: Employee, d: int, pat: WorkPattern) -> None:
            if self.partial_mode:
                # SOFT: 該当 emp が ●/有給 で rest=1 強制されてるなら slack で諦め。
                # 非 ● 日では実質 hard と同等 (slack は最適化で 0 に押される)。
                label = self.inp.leave_requests.get(emp.id, {}).get(d)
                if label in ("●", "有給"):
                    # H10 hard と直接競合するので special を完全に諦める
                    violated = self.model.new_bool_var(
                        f"special_violated_e{emp.id}_d{d}_p{pat.id}"
                    )
                    self.model.add(violated == 1)
                    self._objective_terms.append(-self._SHORTAGE_PENALTY * violated)
                    return
                # 非 ● 日: hard 同等だが念のため slack で吸収可能にしておく
                violated = self.model.new_bool_var(
                    f"special_violated_e{emp.id}_d{d}_p{pat.id}"
                )
                self.model.add(self.rest[(emp.id, d)] == 0).only_enforce_if(violated.negated())
                self.model.add(
                    self.assign[(emp.id, d, pat.id)] == 1
                ).only_enforce_if(violated.negated())
                self._objective_terms.append(-self._SHORTAGE_PENALTY * violated)
            else:
                self.model.add(self.rest[(emp.id, d)] == 0)
                self.model.add(self.assign[(emp.id, d, pat.id)] == 1)

        # LAST_DAY ルールを先に評価することで月末=木曜の競合を解決
        rules_sorted = sorted(
            self.inp.special_assignments,
            key=lambda r: 0 if r.condition_type == "LAST_DAY" else 1,
        )

        for d in self.days:
            date_obj = date(self.inp.year, self.inp.month, d)
            is_last_day = (d == self.num_days)
            fired_roles: set[str] = set()

            for rule in rules_sorted:
                if rule.role in fired_roles:
                    continue
                if rule.condition_type == "LAST_DAY" and not is_last_day:
                    continue
                if rule.condition_type == "WEEKDAY" and date_obj.weekday() != rule.condition_value:
                    continue
                pat = pattern_by_name.get(rule.pattern_name)
                emp = role_to_emp.get(rule.role)
                if pat is None or emp is None:
                    continue
                # 有給が入っている場合は副主任へフォールバック
                leaves = set(self.inp.leave_requests.get(emp.id, {}).keys())
                target = deputies[0] if (d in leaves and deputies) else emp
                _force_assign(target, d, pat)
                fired_roles.add(rule.role)

    # ------------------------------------------------------------------
    # H8: 作業パターン非両立制約（同日に両方の作業パターンを同時使用不可）
    # ------------------------------------------------------------------

    def _h8_pattern_incompatibility(self) -> None:
        for pid_a, pid_b in self.inp.incompatibilities:
            for d in self.days:
                used_a = self.model.new_bool_var(f"used_{pid_a}_d{d}")
                used_b = self.model.new_bool_var(f"used_{pid_b}_d{d}")
                count_a = sum(self.assign[(e.id, d, pid_a)] for e in self.inp.employees)
                count_b = sum(self.assign[(e.id, d, pid_b)] for e in self.inp.employees)
                self.model.add(count_a >= 1).only_enforce_if(used_a)
                self.model.add(count_a == 0).only_enforce_if(used_a.negated())
                self.model.add(count_b >= 1).only_enforce_if(used_b)
                self.model.add(count_b == 0).only_enforce_if(used_b.negated())
                self.model.add(used_a + used_b <= 1)

    # ------------------------------------------------------------------
    # H9: 従業員の勤務可能曜日・番型制約
    # ------------------------------------------------------------------

    def _h9_employee_availability(self) -> None:
        for e in self.inp.employees:
            for d in self.days:
                weekday = date(self.inp.year, self.inp.month, d).weekday()
                if weekday not in e.available_days:
                    # 出勤不可日 → 全作業パターンを 0 に固定（H2 により自動で rest=1）
                    for p in self.inp.patterns:
                        self.model.add(self.assign[(e.id, d, p.id)] == 0)
                else:
                    # 勤務可能日でも番型が合わない作業パターンは禁止
                    for p in self.inp.patterns:
                        if p.shift_type not in e.available_shift_types:
                            self.model.add(self.assign[(e.id, d, p.id)] == 0)

    # ------------------------------------------------------------------
    # H10: 有給・希望休 → 強制 REST（ハード）
    #       仮休(○)    → 出勤にペナルティ（ソフト）
    # ------------------------------------------------------------------

    def _h10_leave_requests(self) -> None:
        for emp_id, days_map in self.inp.leave_requests.items():
            for d, label in days_map.items():
                if d not in self.days:
                    continue
                if label == "有給":
                    # ハード制約: 強制 REST (有給は契約上必ず尊重)
                    for p in self.inp.patterns:
                        self.model.add(self.assign[(emp_id, d, p.id)] == 0)
                    self.model.add(self.rest[(emp_id, d)] == 1)
                elif label == "●":
                    # HARD: 希望休は強制 REST
                    for p in self.inp.patterns:
                        self.model.add(self.assign[(emp_id, d, p.id)] == 0)
                    self.model.add(self.rest[(emp_id, d)] == 1)
                elif label == "○":
                    # ソフト制約: 休みを優先するが solver が出勤に変更可
                    worked = self.model.new_bool_var(f"kari_work_{emp_id}_d{d}")
                    total_assigned = sum(
                        self.assign[(emp_id, d, p.id)] for p in self.inp.patterns
                    )
                    self.model.add(total_assigned >= 1).only_enforce_if(worked)
                    self.model.add(total_assigned == 0).only_enforce_if(worked.negated())
                    self._objective_terms.append(-self._KARI_PENALTY * worked)

    # ------------------------------------------------------------------
    # H11: PatternChoiceGroup（A2 XOR B2 XOR C など）
    # ------------------------------------------------------------------

    def _h11_pattern_choice_group(self) -> None:
        for idx, (candidate_ids, min_count, max_count, dow) in enumerate(self.inp.choice_groups):
            for d in self.days:
                if dow is not None:
                    weekday = date(self.inp.year, self.inp.month, d).weekday()
                    if weekday != dow:
                        continue
                total = sum(
                    self.assign[(e.id, d, pid)]
                    for e in self.inp.employees
                    for pid in candidate_ids
                    if (e.id, d, pid) in self.assign
                )
                if self.partial_mode and min_count > 0:
                    # SOFT: choice group の最低人数を slack 変数で許容、不足ペナルティ
                    slack = self.model.new_int_var(
                        0, min_count, f"choice_grp_slack_{idx}_d{d}"
                    )
                    self.model.add(total + slack >= min_count)
                    self._objective_terms.append(-self._SHORTAGE_PENALTY * slack)
                    self.choice_group_slacks.append(
                        (idx, d, slack, list(candidate_ids), min_count)
                    )
                else:
                    self.model.add(total >= min_count)
                # max は partial_mode でも hard (過剰割当は禁止)
                self.model.add(total <= max_count)

    # ------------------------------------------------------------------
    # H12: PatternTrigger（補助ポジション発生条件）
    # ------------------------------------------------------------------

    def _h12_pattern_trigger(self) -> None:
        """C は B・D・E 全員埋まり時のみ使用可能（一方向の含意）。
        aux_used[d] == 1  →  req_used_GROUP[d] == 1  (全 required_groups に対して)
        """
        if not self.inp.pattern_triggers:
            return

        # group_name → [pattern_id, ...]
        group_to_pids: dict[str, list[int]] = {}
        for p in self.inp.patterns:
            group_to_pids.setdefault(p.group_name, []).append(p.id)

        # (group_name, day) → BoolVar キャッシュ（複数トリガー間で共有）
        _used_cache: dict[tuple[str, int], cp_model.IntVar] = {}

        def _get_group_used(gname: str, d: int) -> cp_model.IntVar | None:
            """グループ gname が日 d に使われているかを示す BoolVar を返す（遅延生成）。"""
            key = (gname, d)
            if key in _used_cache:
                return _used_cache[key]
            pids = group_to_pids.get(gname)
            if not pids:
                return None
            var = self.model.new_bool_var(f"grp_used_{gname}_d{d}")
            total = sum(
                self.assign[(e.id, d, pid)]
                for e in self.inp.employees
                for pid in pids
                if (e.id, d, pid) in self.assign
            )
            self.model.add(total >= 1).only_enforce_if(var)
            self.model.add(total == 0).only_enforce_if(var.negated())
            _used_cache[key] = var
            return var

        for t_idx, trigger in enumerate(self.inp.pattern_triggers):
            if not group_to_pids.get(trigger.auxiliary_group_name):
                continue
            for d in self.days:
                aux_used = _get_group_used(trigger.auxiliary_group_name, d)
                if aux_used is None:
                    continue
                for r_idx, req_gname in enumerate(trigger.required_group_names):
                    req_used = _get_group_used(req_gname, d)
                    if req_used is None:
                        continue
                    if self.partial_mode:
                        # SOFT: aux_used → req_used を slack で破ること許容。
                        # req 候補全員 ● でも aux を使う path が残るが、ペナルティで抑制。
                        violated = self.model.new_bool_var(
                            f"h12_violated_t{t_idx}_r{r_idx}_d{d}"
                        )
                        # aux_used=1 のとき req_used + violated >= 1
                        self.model.add(
                            req_used + violated >= 1
                        ).only_enforce_if(aux_used)
                        self._objective_terms.append(-self._SHORTAGE_PENALTY * violated)
                    else:
                        # aux_used → req_used
                        self.model.add(req_used == 1).only_enforce_if(aux_used)

    # ------------------------------------------------------------------
    # H13: 各作業パターングループは 1 日に最大 1 名まで
    # ------------------------------------------------------------------

    def _h13_group_max_one_per_day(self) -> None:
        """H13: 各作業パターングループは 1 日に最大 1 名まで使用可。
        グループ A なら A1/A2/A3 合計で 1 名以下（複数名配置禁止）。
        """
        group_to_pids: dict[str, list[int]] = {}
        for p in self.inp.patterns:
            group_to_pids.setdefault(p.group_name, []).append(p.id)

        for group_name, pids in group_to_pids.items():
            for d in self.days:
                total = sum(
                    self.assign[(e.id, d, pid)]
                    for e in self.inp.employees
                    for pid in pids
                    if (e.id, d, pid) in self.assign
                )
                self.model.add(total <= 1)

    # ------------------------------------------------------------------
    # H14: 休日前フル番禁止
    #       翌日が休日 (rest=1) の場合、当日 shift_type=2 (フル番) のパターンを禁止する。
    #       ユーザー定義の「休日」(●/○/有給/割当休日) は H2 制約により全て rest=1 に集約される。
    #       祝日・週末は通常勤務扱いのため rest=0 となり、自動的に対象外。
    #       月末日 (d == num_days) は翌月参照不要のため適用外。
    # ------------------------------------------------------------------

    def _h14_no_fullshift_before_holiday(self) -> None:
        full_patterns = [p for p in self.inp.patterns if p.shift_type == 2]
        if not full_patterns:
            return
        for e in self.inp.employees:
            for d in self.days[:-1]:
                for p in full_patterns:
                    self.model.add(
                        self.assign[(e.id, d, p.id)] == 0
                    ).only_enforce_if(self.rest[(e.id, d + 1)])

    # ------------------------------------------------------------------
    # ソフト制約の重み定数
    # ------------------------------------------------------------------

    _FAIRNESS_WEIGHT = 20       # S1: 勤務日数 range 1 日あたりのペナルティ
    _S2_ROLE_EARLY_WEIGHTS = {  # S2: 役職別 早番(shift_type=1) ボーナス
        "CHIEF":  3,
        "DEPUTY": 2,
    }
    _CONSECUTIVE_PENALTY = 2    # S5: consecutive_workable=False 時の連続勤務ペアへのペナルティ
    # S4: consecutive_workable=True 時、k 連勤窓 (k=3,4,5,6) の差分ペナルティ係数。
    # 累積で -(k-2)² となる: k=3→-1, k=4→-4, k=5→-9, k=6→-16
    _CONSECUTIVE_WINDOW_PENALTIES: tuple[int, ...] = (1, 3, 5, 7)
    _MAX_CONSECUTIVE_WORKDAYS = 6  # H15: consecutive_workable=True の最大連勤数
    _KARI_PENALTY = 20          # H10: 仮休(○)日に出勤した場合のペナルティ
    # S3 priority のスケール係数。priority (0-10) に 100 を乗じて最大 1_000 にする。
    # 元の `pri * assign` (max 10) は fairness=20 / kari=20 と桁が近く埋もれていたため、
    # priority マスタを「無視されている」現場フィードバックを解消する目的でスケールアップ。
    # 大小関係: SHORTAGE/MANAGER_GAP=10_000 > priority(max)=1_000 > FAIRNESS=20
    _S3_PRIORITY_SCALE = 100
    # partial_mode=True 時: H1 ポジション不足 1 名あたりのペナルティ。
    # 他のソフト制約 (FAIRNESS=20, KARI=20, CONSECUTIVE 系) より遥かに大きく設定し、
    # 不足を出さない解を最優先する。10_000 なら fairness range 500 日分相当。
    _SHORTAGE_PENALTY = 10_000
    # partial_mode=True 時: H5 管理職全員不在の日のペナルティ。
    # SHORTAGE と同等の重大度として扱う (1 日 1 件しかない invariant)。
    _MANAGER_GAP_PENALTY = 10_000

    # ------------------------------------------------------------------
    # S1: 同 role グループ内の勤務日数公平性（max - min を最小化）
    # ------------------------------------------------------------------

    def _s1_workday_fairness(self) -> None:
        by_role: dict[str, list[Employee]] = {}
        for e in self.inp.employees:
            by_role.setdefault(e.role, []).append(e)

        for role, emps in by_role.items():
            if len(emps) <= 1:
                continue
            work_sums = {
                e.id: sum(1 - self.rest[(e.id, d)] for d in self.days)
                for e in emps
            }
            max_w = self.model.new_int_var(0, self.num_days, f"max_w_{role}")
            min_w = self.model.new_int_var(0, self.num_days, f"min_w_{role}")
            for e in emps:
                self.model.add(max_w >= work_sums[e.id])
                self.model.add(min_w <= work_sums[e.id])
            range_w = self.model.new_int_var(0, self.num_days, f"range_w_{role}")
            self.model.add(range_w == max_w - min_w)
            self._objective_terms.append(-self._FAIRNESS_WEIGHT * range_w)

    # ------------------------------------------------------------------
    # S2: 役職別 早番優先（CHIEF > DEPUTY の順で shift_type=1 を優遇）
    # ------------------------------------------------------------------

    def _s2_role_shift_preference(self) -> None:
        for e in self.inp.employees:
            w = self._S2_ROLE_EARLY_WEIGHTS.get(e.role, 0)
            if w == 0:
                continue
            for d in self.days:
                for p in self.inp.patterns:
                    if p.shift_type == 1:
                        self._objective_terms.append(w * self.assign[(e.id, d, p.id)])

    # ------------------------------------------------------------------
    # S3: 作業パターン優先度に基づく優先割当
    # ------------------------------------------------------------------

    def _s3_pattern_priority(self) -> None:
        scale = self._S3_PRIORITY_SCALE
        for e in self.inp.employees:
            prio = self.inp.employee_priorities.get(e.id, {})
            for d in self.days:
                for p in self.inp.patterns:
                    pri = prio.get(p.id, 0)
                    if pri > 0:
                        self._objective_terms.append(
                            pri * scale * self.assign[(e.id, d, p.id)]
                        )

    # ------------------------------------------------------------------
    # H_PRIORITY_MASTER: 「priority 未設定」(= 0 or 辞書欠落) の (employee, pattern)
    # 組合せを HARD 禁止する。
    #
    # マスタ運用上「priority スコアを付けていない作業パターンは、その従業員に
    # 割り当てるべきでない」という業務ルールを CP-SAT に強制する。
    #
    # partial_mode で choice_group min_count や H5 が soft 化されたとき、ソルバが
    # 「priority 加点 0 でも slack ペナルティ -10_000 よりはマシ」と判断して
    # 未設定割当を選んでしまうのを防ぐ。
    #
    # 副作用リスク (管理職 priority 不備で全月詰む等) は generate_shift の
    # `preflight_priority_master` で生成前に弾く設計。
    # ------------------------------------------------------------------

    def _h_priority_master_required(self) -> None:
        # employee_priorities が完全に空 = priority master 機能を使っていない部門。
        # 後方互換 (priority マスタ未整備の dept でも生成可能) と既存テスト容易性
        # のため、この場合は hard 禁止を skip する。
        # 本番運用では preflight (loader.preflight_priority_master) が candidate
        # ゼロ pattern を弾くので、ここでスキップしてもバイパスにはならない。
        if not self.inp.employee_priorities:
            return
        for e in self.inp.employees:
            prio = self.inp.employee_priorities.get(e.id, {})
            for p in self.inp.patterns:
                if prio.get(p.id, 0) <= 0:
                    for d in self.days:
                        self.model.add(self.assign[(e.id, d, p.id)] == 0)

    # ------------------------------------------------------------------
    # H15: consecutive_workable=True 従業員の最大連勤数 (6 日)
    # ------------------------------------------------------------------

    def _h15_max_consecutive_workdays(self) -> None:
        """7 日窓内に最低 1 つの休みを強制 = 6 連勤上限。
        consecutive_workable=False の従業員は対象外（S5 の線形ペナルティで間接的に抑制）。
        """
        cap = self._MAX_CONSECUTIVE_WORKDAYS
        for e in self.inp.employees:
            if not e.consecutive_workable:
                continue
            for start_idx in range(len(self.days) - cap):
                window_rests = [
                    self.rest[(e.id, self.days[start_idx + offset])]
                    for offset in range(cap + 1)
                ]
                self.model.add_bool_or(window_rests)

    # ------------------------------------------------------------------
    # S4/S5: consecutive_workable による連勤負荷ペナルティ
    #   True : k 連勤窓 BoolVar (k=3..6) で凸ペナルティ -(k-2)² を合成
    #   False: 隣接ペア線形ペナルティ -2 (歯抜け選好)
    # ------------------------------------------------------------------

    def _s4_s5_consecutive_workload(self) -> None:
        for e in self.inp.employees:
            if e.consecutive_workable:
                # S4: 凸ペナルティ。差分係数 (1,3,5,7) を w_k に掛けて合成
                for k_idx, k in enumerate((3, 4, 5, 6)):
                    penalty = self._CONSECUTIVE_WINDOW_PENALTIES[k_idx]
                    for end_idx in range(k - 1, len(self.days)):
                        d_end = self.days[end_idx]
                        work_lits = [
                            self.rest[(e.id, self.days[end_idx - off])].negated()
                            for off in range(k)
                        ]
                        w = self.model.new_bool_var(f"w{k}_e{e.id}_d{d_end}")
                        # w ⇔ AND(work_lits)
                        self.model.add_bool_and(work_lits).only_enforce_if(w)
                        self.model.add_bool_or(
                            [lit.negated() for lit in work_lits]
                        ).only_enforce_if(w.negated())
                        self._objective_terms.append(-penalty * w)
            else:
                # S5: 既存の隣接ペア線形ペナルティ (現状維持)
                for idx, d in enumerate(self.days[:-1]):
                    d_next = self.days[idx + 1]
                    both_work = self.model.new_bool_var(f"bw_{e.id}_{d}")
                    # both_work = True iff 両日とも勤務（rest が 0）
                    self.model.add_bool_and(
                        [self.rest[(e.id, d)].negated(), self.rest[(e.id, d_next)].negated()]
                    ).only_enforce_if(both_work)
                    self.model.add_bool_or(
                        [self.rest[(e.id, d)], self.rest[(e.id, d_next)]]
                    ).only_enforce_if(both_work.negated())
                    self._objective_terms.append(-self._CONSECUTIVE_PENALTY * both_work)

    # ------------------------------------------------------------------
    # ビルド & ソルブ
    # ------------------------------------------------------------------

    def build(self) -> None:
        """制約と目的関数をモデルに組み立てる。solve は呼ばない。"""
        self._create_variables()
        self._h1_pattern_coverage()
        self._h2_one_assignment_per_day()
        self._h3_monthly_rest_days()
        self._h4_overtime_limit()
        self._h5_manager_daily_coverage()
        # _special_assignments (木曜 CHIEF→A3 等の hard 強制) は partial_mode で
        # 内部的に soft 化される (●/有給 日は violated slack で諦め、非 ● 日は
        # 実質 hard 同等)。常に呼び出す。
        self._special_assignments()
        self._h8_pattern_incompatibility()
        self._h9_employee_availability()
        self._h10_leave_requests()
        self._h11_pattern_choice_group()
        self._h12_pattern_trigger()
        self._h13_group_max_one_per_day()
        self._h14_no_fullshift_before_holiday()
        self._h15_max_consecutive_workdays()
        # priority 未設定 = HARD 禁止 (マスタ運用ルール)
        self._h_priority_master_required()
        # ソフト制約（目的関数項を収集）
        self._s2_role_shift_preference()
        self._s3_pattern_priority()
        self._s1_workday_fairness()
        self._s4_s5_consecutive_workload()
        # 目的関数一括設定
        if self._objective_terms:
            self.model.maximize(sum(self._objective_terms))

    def build_and_solve(
        self,
        time_limit: float = 120.0,
        workers: int = 4,
        verbose: bool = False,
        solver: cp_model.CpSolver | None = None,
        random_seed: int | None = None,
    ) -> tuple[str, cp_model.CpSolver]:
        """build + solve を一括実行する。solver を外部から渡すと
        ``solver.stop_search()`` を別スレッドから呼ぶことで途中停止できる。

        random_seed を渡すと CP-SAT の探索が決定的になる (PARTIAL 経路で同 input
        が常に同 result を返す必要がある swap proposal 用)。
        """
        self.build()

        if solver is None:
            solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit
        solver.parameters.num_search_workers = workers
        if random_seed is not None:
            solver.parameters.random_seed = random_seed
        if verbose:
            solver.parameters.log_search_progress = True
        status = solver.solve(self.model)
        return solver.status_name(status), solver

    # ------------------------------------------------------------------
    # 結果抽出
    # ------------------------------------------------------------------

    def extract_result(
        self, solver: cp_model.CpSolver
    ) -> dict[tuple[int, int], str]:
        """(employee_id, day) → 作業パターン名 or 休日ラベル
        休日ラベル: "●"=希望休, "○"=仮休, "有給"=有給, "割当休日"=通常休（区分なし）
        """
        result: dict[tuple[int, int], str] = {}
        for e in self.inp.employees:
            for d in self.days:
                if solver.value(self.rest[(e.id, d)]):
                    # 休日区分が設定されている場合はそのラベルを使用
                    label = self.inp.leave_requests.get(e.id, {}).get(d, "割当休日")
                    result[(e.id, d)] = label
                    continue
                for p in self.inp.patterns:
                    if solver.value(self.assign[(e.id, d, p.id)]):
                        result[(e.id, d)] = p.pattern_name
                        break
        return result

    def extract_shortages(self, solver: cp_model.CpSolver) -> list[ShortageRow]:
        """partial_mode=True で解いた後、不足が出た (day, pattern) を ShortageRow リストで返す。

        `self.shortage_vars` が空 (partial_mode=False) のときは常に空リストを返す。
        """
        rows: list[ShortageRow] = []
        for (d, pid), shortage_var in self.shortage_vars.items():
            missing = int(solver.value(shortage_var))
            if missing <= 0:
                continue
            pat = self.pattern_map.get(pid)
            pattern_name = pat.pattern_name if pat else f"pattern#{pid}"
            assigned = int(sum(
                solver.value(self.assign[(e.id, d, pid)])
                for e in self.inp.employees
            ))
            required = assigned + missing
            rows.append(ShortageRow(
                day=d,
                pattern_id=pid,
                pattern_name=pattern_name,
                required=required,
                assigned=assigned,
                missing=missing,
            ))
        rows.sort(key=lambda r: (r.day, r.pattern_name))
        return rows

    def extract_choice_group_shortages(
        self, solver: cp_model.CpSolver
    ) -> list[ShortageRow]:
        """partial_mode=True で解いた後、choice_group の slack 不足を ShortageRow に変換して返す。

        choice_group は OR 条件 (G早/Gフル/G週 から min_count) のため、グループ全体で 1 件
        の ShortageRow として扱う:
          - pattern_id: 負の値 `-(group_idx + 1)` で識別 (work_patterns FK 衝突回避)
          - pattern_name: 候補 pattern 名を "/" で連結 (例: "G早/Gフル/G週")
          - required: min_count
          - assigned: 候補 pattern に割当された人数の合計
          - missing: max(0, min_count - assigned)

        time_limit 切れで solver が非最適解を返したとき、slack 変数が立っているのに
        実 assigned が min_count を満たすケースがある (例: 井上あゆみ C3フル WORK なのに
        C3/C3フル grp slack=1 立つ)。整合性ガードとして「実 assigned が min_count を
        満たしていれば不足ゼロ」として slack 値を無視する。

        ShortageSlot には永続化しない (FK 制約のため)。`diagnosis_json` 経由でフロントに
        表示される。
        """
        rows: list[ShortageRow] = []
        for group_idx, d, slack, candidate_ids, min_count in self.choice_group_slacks:
            slack_val = int(solver.value(slack))
            if slack_val <= 0:
                continue
            assigned = int(sum(
                solver.value(self.assign[(e.id, d, pid)])
                for e in self.inp.employees
                for pid in candidate_ids
                if (e.id, d, pid) in self.assign
            ))
            # 整合性ガード: 実 assigned が min_count を満たしていれば不足ゼロ
            # (solver 非最適解の slack 変数を信頼しない)。
            actual_missing = max(0, min_count - assigned)
            if actual_missing <= 0:
                continue
            names = [
                self.pattern_map[pid].pattern_name
                for pid in candidate_ids
                if pid in self.pattern_map
            ]
            rows.append(ShortageRow(
                day=d,
                pattern_id=-(group_idx + 1),
                pattern_name="/".join(names),
                required=min_count,
                assigned=assigned,
                missing=actual_missing,
            ))
        rows.sort(key=lambda r: (r.day, r.pattern_name))
        return rows

    def extract_manager_gap_days(self, solver: cp_model.CpSolver) -> list[int]:
        """partial_mode=True で解いた後、管理職全員不在となった日リストを返す。

        H5 が soft 化されたとき、`manager_gap_vars[d] == 1` の日が対象。
        """
        gaps: list[int] = []
        for d, gap_var in self.manager_gap_vars.items():
            if int(solver.value(gap_var)) == 1:
                gaps.append(d)
        gaps.sort()
        return gaps


# ---------------------------------------------------------------------------
# 簡易 INFEASIBLE 診断（制約グループを1つずつ緩めて原因を特定）
# ---------------------------------------------------------------------------

def _detail_leave_conflicts(inp: ShiftModelInput) -> list[str]:
    """H10 が原因の場合、休み希望と必要スロット数の関係から、
    残り従業員で必要枠を満たせない日のみを列挙する (issue #194)。

    旧実装は人数閾値 (3 名 or 25%) で判定していたが、これは
    day_requirements を無視していたため:
      - 大規模店舗 (例: 20 名・必要枠 19) で 4 名希望休が真の INFEASIBLE
        原因でも閾値 5 未満で見逃す (false negative)
      - 4 名規模で必要枠 1・希望休 3 など実際 feasible な日を誤報する
        (false positive)

    本実装は _detail_slot_shortage と同じ容量ベース判定を採用し、
    その日の必要スロット合計が「全従業員 - 希望休人数」を超える日のみ
    報告する。希望休がゼロ件でも他の理由で不足になり得るが、その場合は
    H1 の _detail_slot_shortage で別途報告される (両関数の補完関係)。
    """
    num_days = calendar.monthrange(inp.year, inp.month)[1]
    n_total = len(inp.employees)
    details: list[str] = []
    for d in range(1, num_days + 1):
        resting_names = [
            e.name for e in inp.employees
            if d in inp.leave_requests.get(e.id, {})
        ]
        if not resting_names:
            continue
        reqs = inp.day_requirements.get(d, [])
        total_needed = sum(r.required_min for r in reqs)
        available = n_total - len(resting_names)
        if available >= total_needed:
            continue
        details.append(
            f"    {d}日: 必要枠{total_needed}名 > 利用可能{available}名 "
            f"(希望休: {' / '.join(resting_names)})"
        )
    return details


def _detail_manager_coverage_gaps(inp: ShiftModelInput) -> list[str]:
    """H5 が原因の場合、管理職（CHIEF/DEPUTY）が両者とも休み希望の日を列挙する。"""
    num_days = calendar.monthrange(inp.year, inp.month)[1]
    managers = [e for e in inp.employees if e.role in ("CHIEF", "DEPUTY")]
    if len(managers) < 2:
        return []
    details = []
    for d in range(1, num_days + 1):
        resting = [
            e.name for e in managers
            if d in inp.leave_requests.get(e.id, {})
        ]
        if len(resting) >= len(managers):
            details.append(f"    {d}日: 管理職全員（{' / '.join(resting)}）が休み希望")
    return details


def _detail_slot_shortage(inp: ShiftModelInput) -> list[str]:
    """H1 が原因の場合、必要枠数が利用可能な従業員数を超える日を列挙する。"""
    num_days = calendar.monthrange(inp.year, inp.month)[1]
    pattern_map = {p.id: p for p in inp.patterns}
    details = []
    for d in range(1, num_days + 1):
        reqs = inp.day_requirements.get(d, [])
        total_needed = sum(r.required_min for r in reqs)
        # 当日休み希望の従業員数を引いた利用可能人数
        resting = sum(
            1 for e in inp.employees
            if d in inp.leave_requests.get(e.id, {})
        )
        available = len(inp.employees) - resting
        if total_needed > available:
            details.append(
                f"    {d}日: 必要枠{total_needed}名 > 利用可能{available}名"
            )
    return details


def _detail_h15_consecutive_workable(inp: ShiftModelInput) -> list[str]:
    """H15 (連勤上限 6 日) が原因の場合、連勤可能 True 従業員ごとに
    『6 日 cap が破綻しうる候補』を列挙し、解消手段を案内する。

    具体的には、その従業員が consecutive_workable=True であり、かつ
    その月の出勤要請密度が高い (available_days × 月日数 - 希望休 / 月日数 > 6/7)
    ような候補を flag する。完全な infeasibility 判定ではないが、
    『連勤可能を OFF にすれば緩和される可能性が高い』と案内するヒントとして機能する。
    """
    num_days = calendar.monthrange(inp.year, inp.month)[1]
    details: list[str] = []
    candidates: list[str] = []

    for emp in inp.employees:
        if not emp.consecutive_workable:
            continue
        # 簡易判定: その従業員が休めない日 (希望休 / 利用可能日制限) を引いた
        # 出勤強制日数が 7 日連続以上を含む可能性が高い場合に候補とする。
        leave_days = set(inp.leave_requests.get(emp.id, {}).keys())
        # 利用可能曜日 (0=日曜) — 月日 → 曜日
        available_weekdays = set(emp.available_days)
        forced_work_days = 0
        for d in range(1, num_days + 1):
            if d in leave_days:
                continue
            # 曜日チェック (Python: 月曜=0 → 日曜=6 だが domain は 0=日曜なので変換)
            weekday_iso = (calendar.weekday(inp.year, inp.month, d) + 1) % 7
            if weekday_iso in available_weekdays:
                forced_work_days += 1
        # 出勤可能日数 / 月日数 が 6/7 を超えれば 7 日連勤候補
        if forced_work_days * 7 > num_days * 6:
            candidates.append(emp.name)

    if candidates:
        details.append(
            f"    候補従業員: {', '.join(candidates)}"
        )
        details.append(
            "    解消案: 該当従業員の『連勤可能』を OFF にすると "
            "6 日連勤上限が解除されます (代わりに歯抜け選好の S5 ペナルティが働きます)。"
        )
    else:
        details.append(
            "    解消案: 連勤可能フラグ True の従業員がいるため、"
            "6 日連勤上限が原因の可能性があります。"
            "該当従業員の『連勤可能』を OFF にすると上限が解除されます。"
        )
    return details


_WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"]


def compute_capacity_shortage_summary(inp: ShiftModelInput) -> list[str]:
    """INFEASIBLE 診断の原因ラベルに関わらず、容量ベースで「成立しない日」を列挙する。

    検出する 2 種類のリスク:
      1. 容量不足: `必要枠合計 > 利用可能人数` の日。
         利用可能人数 = 総従業員数 − 希望休(●)人数 − 有給人数 − 勤務不可曜日人数。
         仮休(○)はソフト制約のため available 側に含める。
         「割当休日」ラベル(loader フォールバック)は H10 でも無視されるため available 側。
      2. 管理職全員不在 (H5 違反候補): CHIEF + DEPUTY が 2 名以上いる店舗で、
         全員が当日 leave_request (●/○/有給/割当休日) を持つ日。容量は満たすが
         管理職要件で INFEASIBLE になる典型ケース。

    出力例 (1 日に複数リスクが該当する場合は「 / 」で連結):
        "10日(日): 管理職全員休み (伊藤花子 / 田中一郎)"
        "5日(火): 必要枠4名 > 利用可能2名 (希望休2名) / 管理職全員休み (伊藤花子 / 田中一郎)"

    既存の `_detail_slot_shortage` / `_detail_leave_conflicts` / `_detail_manager_coverage_gaps`
    との関係: 後者は `diagnose_infeasible` が特定の制約 (H1 / H10 / H5) を原因と
    特定した場合のみ呼ばれる詳細関数。本関数は原因ラベルに関わらず常時実行され、
    日別の問題箇所を一覧化する。両者は補完関係。
    """
    num_days = calendar.monthrange(inp.year, inp.month)[1]
    managers = [e for e in inp.employees if e.role in ("CHIEF", "DEPUTY")]
    manager_gap_active = len(managers) >= 2
    lines: list[str] = []
    for d in range(1, num_days + 1):
        weekday = date(inp.year, inp.month, d).weekday()  # 0=月..6=日
        kibo = 0
        yukyu = 0
        unavail_weekday = 0
        for emp in inp.employees:
            label = inp.leave_requests.get(emp.id, {}).get(d)
            if label == "●":
                kibo += 1
            elif label == "有給":
                yukyu += 1
            elif weekday not in emp.available_days:
                unavail_weekday += 1
        available = len(inp.employees) - kibo - yukyu - unavail_weekday
        total_needed = sum(
            r.required_min for r in inp.day_requirements.get(d, [])
        )
        capacity_short = total_needed > available

        manager_resting: list[str] = []
        if manager_gap_active:
            # H5 は assign >= 1 を要求するため、HARD rest (●/有給) のみが違反原因。
            # ○ はソフト制約 (solver が出勤に変更可)、「割当休日」は H10 で無視される。
            manager_resting = [
                e.name for e in managers
                if inp.leave_requests.get(e.id, {}).get(d) in ("●", "有給")
            ]
        manager_gap = manager_gap_active and len(manager_resting) >= len(managers)

        if not capacity_short and not manager_gap:
            continue

        issues: list[str] = []
        if capacity_short:
            breakdown_parts: list[str] = []
            if kibo:
                breakdown_parts.append(f"希望休{kibo}名")
            if yukyu:
                breakdown_parts.append(f"有給{yukyu}名")
            if unavail_weekday:
                breakdown_parts.append(f"勤務不可曜日{unavail_weekday}名")
            breakdown = f" ({' / '.join(breakdown_parts)})" if breakdown_parts else ""
            issues.append(
                f"必要枠{total_needed}名 > 利用可能{available}名{breakdown}"
            )
        if manager_gap:
            issues.append(
                f"管理職全員休み ({' / '.join(manager_resting)})"
            )

        lines.append(
            f"{d}日({_WEEKDAY_JA[weekday]}): " + " / ".join(issues)
        )
    return lines


def diagnose_infeasible(inp: ShiftModelInput) -> list[str]:
    """
    INFEASIBLE 時に呼び出す。制約グループを1つずつ無効化して再ソルブし、
    どのグループが原因かを絞り込む。原因と判定されたグループには追加の詳細情報を付加する。

    Returns: 原因として疑われる制約グループ名（＋詳細）のリスト
    """
    suspects: list[str] = []

    # ラベルはユーザー向け表示用 (内部コード H1/H10 等は外向きに出さない)
    groups = [
        ("シフト枠の必要人数",            "_h1_pattern_coverage"),
        ("月間の休日数",                   "_h3_monthly_rest_days"),
        ("残業上限",                       "_h4_overtime_limit"),
        ("管理職の毎日出勤",               "_h5_manager_daily_coverage"),
        ("曜日・月末の固定シフト",         "_special_assignments"),
        ("従業員の勤務可能日・パターン",   "_h9_employee_availability"),
        ("有給・希望休",                   "_h10_leave_requests"),
        ("作業パターンの曜日別人数",       "_h11_pattern_choice_group"),
        ("補助ポジションの発生条件",       "_h12_pattern_trigger"),
        ("同じパターングループは1日1名まで", "_h13_group_max_one_per_day"),
        ("休日前日のフル勤務禁止",         "_h14_no_fullshift_before_holiday"),
        ("最大連勤数（連勤可能フラグ True 従業員）", "_h15_max_consecutive_workdays"),
    ]

    # 詳細情報を生成する関数のマッピング (キーは groups の表示ラベルと一致)
    detail_funcs = {
        "有給・希望休":          _detail_leave_conflicts,
        "管理職の毎日出勤":      _detail_manager_coverage_gaps,
        "シフト枠の必要人数":    _detail_slot_shortage,
        "最大連勤数（連勤可能フラグ True 従業員）": _detail_h15_consecutive_workable,
    }

    for label, method_name in groups:
        # 元の制約を全部追加した上で、対象グループだけスキップして再ソルブ
        builder = ShiftModelBuilder(inp)
        builder._create_variables()
        for _, other_method in groups:
            if other_method != method_name:
                getattr(builder, other_method)()
        # H2 は必須（変数の整合性）
        builder._h2_one_assignment_per_day()
        builder._h8_pattern_incompatibility()

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 30.0
        status_name = solver.status_name(solver.solve(builder.model))
        if status_name in ("OPTIMAL", "FEASIBLE"):
            detail_fn = detail_funcs.get(label)
            details = detail_fn(inp) if detail_fn else []
            if details:
                suspects.append(label + "\n" + "\n".join(details))
            else:
                suspects.append(label)

    return suspects


# ---------------------------------------------------------------------------
# 部分割当 (PARTIAL 状態) 用ソルバとスワップ提案
# ---------------------------------------------------------------------------

def solve_partial(
    inp: ShiftModelInput,
    *,
    time_limit: float = 60.0,
    random_seed: int | None = None,
    solver: cp_model.CpSolver | None = None,
) -> tuple[str, dict[tuple[int, int], str], list[ShortageRow], list[int]]:
    """H1 (シフト枠必要人数) + H5 (管理職毎日出勤) + H6/H7 (特別割当) + H11
    (choice_group min) + H12 (pattern_trigger 含意) を soft 化して解き、
    出勤可能な人員だけで埋めた解と残った不足を返す。希望休 (●) と有給は通常通り
    HARD 制約として尊重する (whole point)。

    決定性: `workers=1` + `random_seed` 必須で同 input が常に同 result を返す。
    PARTIAL 経路は UI 上に proposal を表示する必要があり、再描画/再生成で
    proposal が変わると user が混乱するため。

    Returns:
        (status_name, result, shortages, manager_gap_days)
        - status_name: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" など
        - result: (employee_id, day) → 作業パターン名 or 休日ラベル
                  ("●", "○", "有給", "割当休日")
        - shortages: 不足スロット (day × pattern)。partial 解でも埋められなかった枠。
        - manager_gap_days: 管理職全員 ● で当日 1 人も働けない日のリスト。

    H10 hard (●・有給) は引き続き hard なので、それのみでは破られない。
    """
    builder = ShiftModelBuilder(inp, partial_mode=True)
    status_name, solver = builder.build_and_solve(
        time_limit=time_limit,
        workers=1,  # 決定性のため固定
        random_seed=random_seed if random_seed is not None else 0,
        solver=solver,
    )
    if status_name not in ("OPTIMAL", "FEASIBLE"):
        return status_name, {}, [], []
    result = builder.extract_result(solver)
    # H1 由来 shortage + choice_group OR 由来 shortage を統合
    shortages = (
        builder.extract_shortages(solver)
        + builder.extract_choice_group_shortages(solver)
    )
    shortages.sort(key=lambda r: (r.day, r.pattern_name))
    manager_gap_days = builder.extract_manager_gap_days(solver)
    return status_name, result, shortages, manager_gap_days
