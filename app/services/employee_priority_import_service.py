"""
app/services/employee_priority_import_service.py — employee_priorities.csv の Upsert インポート

CSV フォーマット (app/scripts/seed_data/employee_priorities.csv 互換):
  employee_id,pattern_name,priority
  104632,A1,10
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee, EmployeePatternPriority
from app.models.work_pattern import WorkPattern, WorkPatternGroup

REQUIRED_COLUMNS = ("employee_id", "pattern_name", "priority")


async def import_employee_priorities_csv(
    db: AsyncSession,
    *,
    department_id: int,
    csv_bytes: bytes,
    encoding: str = "utf-8-sig",
) -> dict:
    """
    employee_priorities.csv を読み込み、(employee, pattern) で Upsert する。
    priority=0 は既存レコードを削除（loader が priority>0 のみ参照する仕様に合わせる）。
    employee と pattern は department_id で絞り込み、不一致は errors に積んでスキップ。
    """
    text = csv_bytes.decode(encoding, errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None:
        raise ValueError("CSV にヘッダ行がありません")

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValueError(f"必須列が不足: {', '.join(missing)}")

    # 部門内の従業員 employee_number → id
    emp_rows = (
        await db.execute(
            select(Employee.employee_number, Employee.id).where(
                Employee.department_id == department_id
            )
        )
    ).all()
    emp_map: dict[int, int] = {row[0]: row[1] for row in emp_rows}

    # 部門内の作業パターン pattern_name → id
    pat_rows = (
        await db.execute(
            select(WorkPattern.pattern_name, WorkPattern.id)
            .join(WorkPatternGroup, WorkPatternGroup.id == WorkPattern.group_id)
            .where(WorkPatternGroup.department_id == department_id)
        )
    ).all()
    pat_map: dict[str, int] = {row[0]: row[1] for row in pat_rows}

    created = 0
    updated = 0
    deleted = 0
    skipped = 0
    errors: list[str] = []

    for line_no, row in enumerate(reader, start=2):
        try:
            emp_no = int((row.get("employee_id") or "").strip())
            pname = (row.get("pattern_name") or "").strip()
            priority = int((row.get("priority") or "").strip())
        except (ValueError, TypeError) as exc:
            errors.append(f"{line_no}行目: 値の解釈に失敗 ({exc})")
            skipped += 1
            continue

        if not (0 <= priority <= 10):
            errors.append(f"{line_no}行目: priority は 0〜10 の範囲です ({priority})")
            skipped += 1
            continue

        emp_id = emp_map.get(emp_no)
        if emp_id is None:
            errors.append(f"{line_no}行目: employee_id={emp_no} が部門に存在しません")
            skipped += 1
            continue
        pat_id = pat_map.get(pname)
        if pat_id is None:
            errors.append(f"{line_no}行目: pattern_name={pname} が部門に存在しません")
            skipped += 1
            continue

        existing = (
            await db.execute(
                select(EmployeePatternPriority).where(
                    EmployeePatternPriority.employee_id == emp_id,
                    EmployeePatternPriority.pattern_id == pat_id,
                )
            )
        ).scalar_one_or_none()

        if priority == 0:
            if existing is not None:
                await db.delete(existing)
                deleted += 1
            else:
                skipped += 1
            continue

        if existing is None:
            db.add(
                EmployeePatternPriority(
                    employee_id=emp_id,
                    pattern_id=pat_id,
                    priority=priority,
                )
            )
            created += 1
        else:
            if existing.priority != priority:
                existing.priority = priority
                updated += 1
            else:
                skipped += 1

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "skipped": skipped,
        "errors": errors,
    }
