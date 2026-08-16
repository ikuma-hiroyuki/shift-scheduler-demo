"""
シードスクリプト: app/scripts/seed_data/ の CSV ファイルを DB に投入する。

使用方法:
    docker compose exec app python -m app.scripts.seed
    # または開発時（ローカル DB）:
    DATABASE_URL=postgresql+asyncpg://demomart:demomart@localhost:5432/demomart \
        python -m app.scripts.seed
"""

import asyncio
import csv
import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.constants.group_colors import GROUP_COLOR_PRESETS
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
)
from app.models.day_template import DayTemplate
from app.models.department import Department, WorkRuleConfig
from app.models.role import Role
from app.models.employee import Employee, EmployeePatternPriority
from app.models.leave_request import LeaveRequest  # noqa: F401 — ensure model registered
from app.models.pattern_rule import (
    PatternTrigger,
    PatternTriggerRequiredGroup,
    SpecialAssignmentRule,
)
from app.models.schedule import ShiftAssignment, ShiftSchedule  # noqa: F401
from app.models.user import User
from app.models.work_pattern import WorkPattern, WorkPatternGroup

# app/scripts/seed_data/ の絶対パス
DATA_DIR = Path(__file__).resolve().parent / "seed_data"


def _available_days_str(raw: str) -> str:
    """'0123456' → '0,1,2,3,4,5,6'"""
    return ",".join(list(raw.strip()))


def _available_shift_types_str(raw: str) -> str:
    """'123' → '1,2,3'"""
    return ",".join(list(raw.strip()))


async def seed(session: AsyncSession) -> None:
    print("--- シードデータ投入開始 ---")

    # ------------------------------------------------------------------ #
    # 0. 役職マスタ（migration で初期投入されるが、既存環境向けの保険）
    # ------------------------------------------------------------------ #
    role_count = (await session.execute(select(func.count()).select_from(Role))).scalar_one()
    if role_count == 0:
        roles_csv = DATA_DIR / "roles.csv"
        count = 0
        with open(roles_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                session.add(
                    Role(
                        code=row["code"],
                        name=row["name"],
                        order_index=int(row["order_index"]),
                        rest_days_28_29=int(row["rest_days_28_29"]),
                        rest_days_30=int(row["rest_days_30"]),
                        rest_days_31=int(row["rest_days_31"]),
                    )
                )
                count += 1
        await session.flush()
        print(f"  役職マスタ投入: {count} 件")
    else:
        print(f"  役職マスタスキップ (既存 {role_count} 件)")

    # ------------------------------------------------------------------ #
    # 1. 部門 + 労務ルール設定
    # ------------------------------------------------------------------ #
    dept_result = await session.execute(select(Department).where(Department.name == "鮮魚部門"))
    dept = dept_result.scalar_one_or_none()
    if dept is None:
        dept = Department(name="鮮魚部門")
        session.add(dept)
        await session.flush()
        session.add(
            WorkRuleConfig(
                department_id=dept.id,
                standard_work_hours_per_day=8.0,
                max_overtime_hours_staff=40.0,
            )
        )
        await session.flush()
        print(f"  部門作成: {dept.name} (id={dept.id})")
    else:
        print(f"  部門スキップ (既存): {dept.name}")

    # ------------------------------------------------------------------ #
    # 2. 作業パターングループ + 作業パターン
    # ------------------------------------------------------------------ #
    patterns_csv = DATA_DIR / "patterns.csv"
    group_name_to_id: dict[str, int] = {}
    pattern_name_to_id: dict[str, int] = {}
    # pattern CSV id (1-based) → DB id のマッピング（choice_groups で使用）
    csv_pattern_id_to_db_id: dict[int, int] = {}
    # group_id → 次に採番する pattern.sort_order
    next_pattern_order: dict[int, int] = {}
    # department_id → そこに既に割当済みのグループ数 (color 循環の per-dept index)
    # migration 0006 と同じ per-department 循環で、multi-store になっても整合する
    next_color_index_by_dept: dict[int, int] = {}

    with open(patterns_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            gname = row["group_name"]
            if gname not in group_name_to_id:
                result = await session.execute(
                    select(WorkPatternGroup).where(
                        WorkPatternGroup.department_id == dept.id,
                        WorkPatternGroup.name == gname,
                    )
                )
                grp = result.scalar_one_or_none()
                if grp is None:
                    sort_idx = len(group_name_to_id)
                    color_idx = next_color_index_by_dept.get(dept.id, 0)
                    grp = WorkPatternGroup(
                        department_id=dept.id,
                        name=gname,
                        sort_order=sort_idx,
                        is_auxiliary=bool(int(row["is_auxiliary"])),
                        color=GROUP_COLOR_PRESETS[
                            color_idx % len(GROUP_COLOR_PRESETS)
                        ],
                    )
                    session.add(grp)
                    await session.flush()
                    next_color_index_by_dept[dept.id] = color_idx + 1
                group_name_to_id[gname] = grp.id

            result = await session.execute(
                select(WorkPattern).where(
                    WorkPattern.group_id == group_name_to_id[gname],
                    WorkPattern.pattern_name == row["pattern_name"],
                )
            )
            pat = result.scalar_one_or_none()
            if pat is None:
                gid = group_name_to_id[gname]
                pat = WorkPattern(
                    group_id=gid,
                    pattern_name=row["pattern_name"],
                    shift_type=int(row["shift_type"]),
                    shift_start=row["shift_start"],
                    shift_end=row["shift_end"],
                    sort_order=next_pattern_order.get(gid, 0),
                )
                next_pattern_order[gid] = next_pattern_order.get(gid, 0) + 1
                session.add(pat)
                await session.flush()
            pattern_name_to_id[row["pattern_name"]] = pat.id
            csv_pattern_id_to_db_id[int(row["id"])] = pat.id

    print(f"  作業パターングループ: {len(group_name_to_id)} 件")
    print(f"  作業パターン: {len(pattern_name_to_id)} 件")

    # ------------------------------------------------------------------ #
    # 3. 従業員
    # ------------------------------------------------------------------ #
    employees_csv = DATA_DIR / "employees.csv"
    emp_count = 0
    next_emp_order = 0
    with open(employees_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            emp_no = int(row["employee_number"])
            result = await session.execute(
                select(Employee).where(Employee.employee_number == emp_no)
            )
            emp = result.scalar_one_or_none()
            if emp is None:
                emp = Employee(
                    employee_number=emp_no,
                    department_id=dept.id,
                    name=row["name"],
                    role=row["role"],
                    available_days=_available_days_str(row["available_days"]),
                    available_shift_types=_available_shift_types_str(row["available_shift_types"]),
                    consecutive_workable=bool(int(row["consecutive_workable"])),
                    sort_order=next_emp_order,
                )
                session.add(emp)
                emp_count += 1
                next_emp_order += 1
    await session.flush()
    print(f"  従業員追加: {emp_count} 件")

    # ------------------------------------------------------------------ #
    # 4. 曜日別テンプレート
    # ------------------------------------------------------------------ #
    templates_csv = DATA_DIR / "day_templates.csv"
    tmpl_count = 0
    next_dt_order = int(
        (
            await session.execute(
                select(func.coalesce(func.max(DayTemplate.sort_order), -1)).where(
                    DayTemplate.department_id == dept.id
                )
            )
        ).scalar_one()
    ) + 1
    with open(templates_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            csv_pid = int(row["pattern_id"])
            db_pid = csv_pattern_id_to_db_id.get(csv_pid)
            if db_pid is None:
                print(f"  警告: day_templates.csv の pattern_id={csv_pid} が patterns.csv に見つかりません")
                continue
            weekday = int(row["weekday"])
            required = int(row["required_min"])
            rmax = (row.get("required_max") or "").strip()
            required_max = int(rmax) if rmax else None
            result = await session.execute(
                select(DayTemplate).where(
                    DayTemplate.department_id == dept.id,
                    DayTemplate.day_of_week == weekday,
                    DayTemplate.pattern_id == db_pid,
                )
            )
            if result.scalar_one_or_none() is None:
                session.add(
                    DayTemplate(
                        department_id=dept.id,
                        day_of_week=weekday,
                        pattern_id=db_pid,
                        required_min=required,
                        required_max=required_max,
                        sort_order=next_dt_order,
                    )
                )
                next_dt_order += 1
                tmpl_count += 1
    await session.flush()
    print(f"  曜日別テンプレート追加: {tmpl_count} 件")

    # ------------------------------------------------------------------ #
    # 5. 作業パターン選択グループ
    # ------------------------------------------------------------------ #
    choice_csv = DATA_DIR / "choice_groups.csv"
    cg_count = 0
    next_cg_order = (
        await session.execute(
            select(func.coalesce(func.max(PatternChoiceGroup.sort_order), -1)).where(
                PatternChoiceGroup.department_id == dept.id
            )
        )
    ).scalar_one()
    next_cg_order = int(next_cg_order) + 1
    with open(choice_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # CSV の pattern_ids は CSV 上の id（1始まり）で記録されている
            csv_pids = [int(p) for p in row["pattern_ids"].split(";")]
            db_pids = [csv_pattern_id_to_db_id[p] for p in csv_pids if p in csv_pattern_id_to_db_id]
            min_c = int(row["min_count"])
            max_c = int(row["max_count"])

            # 同じ候補セットのグループが既に存在しないか簡易チェック
            result = await session.execute(
                select(PatternChoiceGroup).where(
                    PatternChoiceGroup.department_id == dept.id,
                    PatternChoiceGroup.min_count == min_c,
                    PatternChoiceGroup.max_count == max_c,
                )
            )
            existing_groups = result.scalars().all()
            already_exists = False
            for eg in existing_groups:
                await session.refresh(eg, ["candidates"])
                if {c.pattern_id for c in eg.candidates} == set(db_pids):
                    already_exists = True
                    break

            if not already_exists:
                cg = PatternChoiceGroup(
                    department_id=dept.id,
                    day_of_week=None,
                    min_count=min_c,
                    max_count=max_c,
                    sort_order=next_cg_order,
                )
                session.add(cg)
                await session.flush()
                for db_pid in db_pids:
                    session.add(PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=db_pid))
                next_cg_order += 1
                cg_count += 1
    await session.flush()
    print(f"  選択グループ追加: {cg_count} 件")

    # ------------------------------------------------------------------ #
    # 6. 特別割当ルール
    # ------------------------------------------------------------------ #
    special_csv = DATA_DIR / "special_assignments.csv"
    sar_count = 0
    with open(special_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pname = row["pattern_name"]
            db_pid = pattern_name_to_id.get(pname)
            if db_pid is None:
                print(f"  警告: special_assignments.csv の pattern_name={pname} が見つかりません")
                continue
            condition_type = row["condition_type"]
            condition_value_raw = row["condition_value"].strip()
            condition_value = int(condition_value_raw) if condition_value_raw not in ("", "0") or condition_type == "WEEKDAY" else None
            if condition_type == "LAST_DAY":
                condition_value = None

            result = await session.execute(
                select(SpecialAssignmentRule).where(
                    SpecialAssignmentRule.department_id == dept.id,
                    SpecialAssignmentRule.condition_type == condition_type,
                    SpecialAssignmentRule.required_role == row["role"],
                    SpecialAssignmentRule.pattern_id == db_pid,
                )
            )
            if result.scalar_one_or_none() is None:
                session.add(
                    SpecialAssignmentRule(
                        department_id=dept.id,
                        condition_type=condition_type,
                        condition_value=condition_value,
                        required_role=row["role"],
                        pattern_id=db_pid,
                    )
                )
                sar_count += 1
    await session.flush()
    print(f"  特別割当ルール追加: {sar_count} 件")

    # ------------------------------------------------------------------ #
    # 7. パターントリガー
    # ------------------------------------------------------------------ #
    trigger_csv = DATA_DIR / "pattern_triggers.csv"
    trig_count = 0
    next_trig_order = (
        await session.execute(
            select(func.coalesce(func.max(PatternTrigger.sort_order), -1)).where(
                PatternTrigger.department_id == dept.id
            )
        )
    ).scalar_one()
    next_trig_order = int(next_trig_order) + 1
    with open(trigger_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            aux_gname = row["auxiliary_group_name"]
            req_gnames = [g.strip() for g in row["required_group_names"].split(";")]

            aux_gid = group_name_to_id.get(aux_gname)
            req_gids = [group_name_to_id[g] for g in req_gnames if g in group_name_to_id]
            if aux_gid is None:
                continue

            result = await session.execute(
                select(PatternTrigger).where(
                    PatternTrigger.department_id == dept.id,
                    PatternTrigger.auxiliary_group_id == aux_gid,
                )
            )
            if result.scalar_one_or_none() is None:
                trig = PatternTrigger(
                    department_id=dept.id,
                    auxiliary_group_id=aux_gid,
                    sort_order=next_trig_order,
                )
                session.add(trig)
                await session.flush()
                for gid in req_gids:
                    session.add(PatternTriggerRequiredGroup(trigger_id=trig.id, group_id=gid))
                trig_count += 1
                next_trig_order += 1
    await session.flush()
    print(f"  パターントリガー追加: {trig_count} 件")

    # ------------------------------------------------------------------ #
    # 8. 従業員ごとの作業パターン優先度
    # ------------------------------------------------------------------ #
    priorities_csv = DATA_DIR / "employee_priorities.csv"
    pri_count = 0
    if priorities_csv.exists():
        with open(priorities_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                emp_no = int(row["employee_id"])
                pname = row["pattern_name"]
                priority = int(row["priority"])

                emp_result = await session.execute(
                    select(Employee).where(Employee.employee_number == emp_no)
                )
                emp = emp_result.scalar_one_or_none()
                if emp is None:
                    print(f"  警告: employee_priorities.csv の employee_id={emp_no} が見つかりません")
                    continue

                db_pid = pattern_name_to_id.get(pname)
                if db_pid is None:
                    print(f"  警告: employee_priorities.csv の pattern_name={pname} が見つかりません")
                    continue

                result = await session.execute(
                    select(EmployeePatternPriority).where(
                        EmployeePatternPriority.employee_id == emp.id,
                        EmployeePatternPriority.pattern_id == db_pid,
                    )
                )
                existing = result.scalar_one_or_none()
                if existing is None:
                    session.add(
                        EmployeePatternPriority(
                            employee_id=emp.id,
                            pattern_id=db_pid,
                            priority=priority,
                        )
                    )
                    pri_count += 1
                elif existing.priority != priority:
                    existing.priority = priority
                    pri_count += 1
        await session.flush()
    print(f"  従業員作業パターン優先度追加/更新: {pri_count} 件")

    # ------------------------------------------------------------------ #
    # 9. 管理者ユーザー
    # ------------------------------------------------------------------ #
    admin_email = "admin@example.com"
    result = await session.execute(select(User).where(User.email == admin_email))
    existing_admin = result.scalar_one_or_none()
    if existing_admin is None:
        admin_password = os.environ.get("SEED_ADMIN_PASSWORD", "password")
        session.add(
            User(
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                is_active=True,
                is_admin=True,
            )
        )
        print(f"  管理者ユーザー作成: {admin_email}")
    elif not existing_admin.is_admin:
        # 既存ユーザーが is_admin=False の場合は True に昇格させる
        # (0008 migration 後に既存 dev admin が一般ユーザー扱いになる問題への恒久対策)。
        # is_active には触らない (incident response で意図的に無効化されている可能性を尊重)。
        existing_admin.is_admin = True
        print(f"  管理者ユーザー昇格: {admin_email} (is_admin: False → True)")
    else:
        print(f"  管理者ユーザースキップ (既存): {admin_email}")

    await session.commit()
    print("--- シードデータ投入完了 ---")


async def main() -> None:
    database_url = os.environ.get("DATABASE_URL", settings.database_url)
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        await seed(session)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
