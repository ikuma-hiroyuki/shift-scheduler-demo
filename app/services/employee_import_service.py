"""
app/services/employee_import_service.py — employees.csv 形式の Upsert インポート

CSV フォーマット (app/scripts/seed_data/employees.csv 互換):
  employee_number,name,role,available_days,available_shift_types,consecutive_workable
  104632,山田太郎,CHIEF,0123456,12,1
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee

REQUIRED_COLUMNS = (
    "employee_number",
    "name",
    "role",
    "available_days",
    "available_shift_types",
    "consecutive_workable",
)
VALID_ROLES = {"CHIEF", "DEPUTY", "STAFF", "FULLPART", "MORNINGPART"}
VALID_DAYS = set("0123456")
VALID_SHIFT_TYPES = set("123")


def _expand_days(raw: str) -> str:
    """'0123456' → '0,1,2,3,4,5,6'"""
    return ",".join(list(raw.strip()))


def _expand_shift_types(raw: str) -> str:
    """'12' → '1,2'"""
    return ",".join(list(raw.strip()))


def _parse_bool(raw: str) -> bool:
    """consecutive_workable セルを解釈する。

    issue #193: 空セルを silent に False へ落とすと、CSV 部分更新で
    既存従業員の H15 連勤上限 (DB default=True) が静かに無効化される。
    空セルは値の指定漏れとして reject し、利用者に明示を強制する。
    """
    s = raw.strip().lower()
    if s in ("1", "true", "yes", "y"):
        return True
    if s in ("0", "false", "no", "n"):
        return False
    if s == "":
        raise ValueError(
            "consecutive_workable が空です (1/0 を明示してください)"
        )
    raise ValueError(f"consecutive_workable 値が不正: {raw!r}")


async def import_employees_csv(
    db: AsyncSession,
    *,
    department_id: int,
    csv_bytes: bytes,
    encoding: str = "utf-8-sig",
) -> dict:
    """
    employees.csv を読み込み、employee_number 一致で Upsert する。

    `display_order` 列は任意。値があれば Employee.sort_order に反映、
    無ければ既存値を維持し、新規追加分は「(現在最大 + 1) からの連番」を採番する。

    Returns:
        {
          "created": N, "updated": N, "moved": N,
          "errors": [行番号付きメッセージ, ...],
        }

    moved: 既存社員番号のうち別部署に紐付いていたものを今回の department_id に
    付け替えたカウント。`updated` の内訳（部署越境分）として併記する。
    """
    text = csv_bytes.decode(encoding, errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None:
        raise ValueError("CSV にヘッダ行がありません")

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValueError(f"必須列が不足: {', '.join(missing)}")

    has_display_order = "display_order" in reader.fieldnames

    # 新規追加時の sort_order 採番起点
    next_sort_order = int(
        (
            await db.execute(
                select(func.coalesce(func.max(Employee.sort_order), -1)).where(
                    Employee.department_id == department_id
                )
            )
        ).scalar_one()
    ) + 1

    created = 0
    updated = 0
    moved = 0
    errors: list[str] = []
    seen_orders: dict[int, int] = {}  # display_order 重複検知用

    for line_no, row in enumerate(reader, start=2):  # ヘッダの次=2行目から
        try:
            emp_num = int((row.get("employee_number") or "").strip())
            name = (row.get("name") or "").strip()
            role = (row.get("role") or "").strip().upper()
            days_raw = (row.get("available_days") or "").strip()
            shift_raw = (row.get("available_shift_types") or "").strip()

            if not name:
                raise ValueError("name が空です")
            if role not in VALID_ROLES:
                raise ValueError(f"role 値が不正: {role!r}")
            if not days_raw or not set(days_raw).issubset(VALID_DAYS):
                raise ValueError(f"available_days 値が不正: {days_raw!r}")
            if not shift_raw or not set(shift_raw).issubset(VALID_SHIFT_TYPES):
                raise ValueError(f"available_shift_types 値が不正: {shift_raw!r}")

            workable = _parse_bool(row.get("consecutive_workable") or "")

            display_order: int | None = None
            if has_display_order:
                raw_order = (row.get("display_order") or "").strip()
                if raw_order != "":
                    display_order = int(raw_order)
        except (ValueError, TypeError) as exc:
            errors.append(f"{line_no}行目: {exc}")
            continue

        if display_order is not None:
            if display_order in seen_orders:
                errors.append(
                    f"{line_no}行目: display_order={display_order} が "
                    f"{seen_orders[display_order]}行目と重複しています"
                )
            else:
                seen_orders[display_order] = line_no

        result = await db.execute(
            select(Employee).where(Employee.employee_number == emp_num)
        )
        existing = result.scalar_one_or_none()

        if existing is None:
            sort_order = (
                display_order if display_order is not None else next_sort_order
            )
            if display_order is None:
                next_sort_order += 1
            db.add(
                Employee(
                    employee_number=emp_num,
                    department_id=department_id,
                    name=name,
                    role=role,
                    available_days=_expand_days(days_raw),
                    available_shift_types=_expand_shift_types(shift_raw),
                    consecutive_workable=workable,
                    sort_order=sort_order,
                )
            )
            created += 1
        else:
            if existing.department_id != department_id:
                moved += 1
            existing.department_id = department_id
            existing.name = name
            existing.role = role
            existing.available_days = _expand_days(days_raw)
            existing.available_shift_types = _expand_shift_types(shift_raw)
            existing.consecutive_workable = workable
            if display_order is not None:
                existing.sort_order = display_order
            updated += 1

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "moved": moved,
        "errors": errors,
    }
