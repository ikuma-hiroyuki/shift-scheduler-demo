"""
app/services/import_service.py — 勤務希望 CSV（MonShift形式）を DB に取り込む

勤務希望 CSV フォーマット（Phase 0 PoC の load_leave_from_roster に対応、git 履歴参照）:
  従業員番号, 日付(YYYY/M/D), 休日区分(1=希望休/2=仮休/3=有給), ...
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.leave_request import LeaveRequest

# 休日区分コード → DB leave_type
# 1=希望休(●) / 2=仮休(○) / 3=有給
_KUBUN_TO_TYPE: dict[str, str] = {
    "1": "REQUESTED",
    "2": "TENTATIVE",
    "3": "MANDATORY",
}

# CSV 列名（MonShift 形式のデフォルト）
_DEFAULT_COLUMNS = {
    "emp_number": "従業員番号",
    "date": "日付",
    "kubun": "休日区分",
}


def _detect_year_month(
    rows: list[dict[str, str]],
    date_col: str,
) -> tuple[int, int]:
    """CSV の日付列から年月を自動検出する。YYYY/M/D 形式を想定。"""
    for row in rows:
        raw = row.get(date_col, "").strip()
        parts = raw.split("/")
        if len(parts) >= 2:
            try:
                return int(parts[0]), int(parts[1])
            except ValueError:
                continue
    raise ValueError("CSV から年月を検出できませんでした。日付列を確認してください。")


async def import_roster_csv(
    db: AsyncSession,
    csv_bytes: bytes,
    department_id: int,
    year: int | None = None,
    month: int | None = None,
    encoding: str = "utf-8-sig",
    columns: dict[str, str] | None = None,
) -> dict[str, int]:
    """
    勤務希望 CSV を DB に取り込む。
    year/month が省略された場合は CSV の日付列から自動検出する。
    既存の同年月の LeaveRequest は全削除して再登録する。

    Returns:
        {"created": N, "skipped": N, "year": Y, "month": M}
    """
    cols = columns or _DEFAULT_COLUMNS

    text = csv_bytes.decode(encoding, errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    # 年月の自動検出
    if year is None or month is None:
        year, month = _detect_year_month(rows, cols["date"])

    # 部門に属する従業員の employee_number → id マップ
    emp_result = await db.execute(
        select(Employee).where(Employee.department_id == department_id)
    )
    emp_by_number: dict[int, int] = {
        e.employee_number: e.id for e in emp_result.scalars().all()
    }

    # 既存の同年月データを削除
    emp_ids = list(emp_by_number.values())
    if emp_ids:
        await db.execute(
            delete(LeaveRequest).where(
                LeaveRequest.employee_id.in_(emp_ids),
                LeaveRequest.year == year,
                LeaveRequest.month == month,
            )
        )

    created = 0
    skipped = 0

    for row in rows:
        kubun = row.get(cols["kubun"], "").strip()
        if kubun not in _KUBUN_TO_TYPE:
            skipped += 1
            continue

        raw_num = row.get(cols["emp_number"], "").strip()
        if not raw_num:
            skipped += 1
            continue

        try:
            emp_num = int(raw_num)
        except ValueError:
            skipped += 1
            continue

        emp_id = emp_by_number.get(emp_num)
        if emp_id is None:
            skipped += 1
            continue

        raw_date = row.get(cols["date"], "").strip()
        try:
            day = int(raw_date.split("/")[2])
        except (IndexError, ValueError):
            skipped += 1
            continue

        if not (1 <= day <= 31):
            skipped += 1
            continue

        db.add(LeaveRequest(
            employee_id=emp_id,
            year=year,
            month=month,
            day=day,
            leave_type=_KUBUN_TO_TYPE[kubun],
        ))
        created += 1

    await db.commit()
    return {"created": created, "skipped": skipped, "year": year, "month": month}
