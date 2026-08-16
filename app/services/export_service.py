"""
app/services/export_service.py — 稼働表エクスポート (Excel / CSV)

Phase 0 PoC の export_shift_xlsx ロジックを DB モデルベースに移植 (git 履歴参照)。
"""
from __future__ import annotations

import calendar
import csv
import io
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import LEAVE_TYPE_LABEL
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.schedule import ShiftAssignment, ShiftSchedule
from app.models.work_pattern import WorkPattern, WorkPatternGroup


# パターングループ先頭文字 → 背景色（ARGB）
_GROUP_COLORS: dict[str, str] = {
    "A": "C6EFCE",
    "B": "BDD7EE",
    "C": "FFE699",
    "D": "D9D9D9",
    "E": "E2EFDA",
    "F": "FCE4D6",
    "G": "FFDAB9",
    "H": "E8D5F5",
    "I": "DDEEFF",
}
_REST_COLOR    = "F2DCDB"
_HEADER_COLOR  = "2F5496"
_SAT_COLOR     = "DDEBF7"
_SUN_COLOR     = "FCE4D6"
_HOLIDAY_COLOR = "FFE0B2"
_REST_DISPLAY  = {"割当休日", "●", "○", "有給"}


def _get_holidays(year: int, month: int) -> dict[int, str]:
    try:
        import jpholiday
        num_days = calendar.monthrange(year, month)[1]
        return {
            d: jpholiday.is_holiday_name(date(year, month, d))
            for d in range(1, num_days + 1)
            if jpholiday.is_holiday_name(date(year, month, d))
        }
    except ImportError:
        return {}


async def export_schedule_xlsx(
    db: AsyncSession,
    schedule: ShiftSchedule,
) -> bytes:
    """
    schedule の稼働表を xlsx 形式でバイト列として返す。
    openpyxl が必要。
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    year, month = schedule.year, schedule.month
    num_days = calendar.monthrange(year, month)[1]
    holidays = _get_holidays(year, month)

    # ---- 従業員取得（部門でフィルタ） ----
    emp_result = await db.execute(
        select(Employee)
        .where(Employee.department_id == schedule.department_id)
        .order_by(Employee.sort_order, Employee.id)
    )
    employees: list[Employee] = list(emp_result.scalars().all())
    emp_id_to_obj = {e.id: e for e in employees}

    # ---- WorkPattern 取得（グループ名も必要） ----
    pat_result = await db.execute(
        select(WorkPattern)
        .join(WorkPatternGroup)
        .where(WorkPatternGroup.department_id == schedule.department_id)
        .options(selectinload(WorkPattern.group))
    )
    patterns: list[WorkPattern] = list(pat_result.scalars().all())
    pid_to_pattern = {p.id: p for p in patterns}

    # ---- LeaveRequest 取得（LEAVE ラベル復元用） ----
    emp_ids = [e.id for e in employees]
    lr_result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.year == year,
            LeaveRequest.month == month,
            LeaveRequest.employee_id.in_(emp_ids),
        )
    )
    # (employee_id, day) → leave_type
    leave_map: dict[tuple[int, int], str] = {
        (lr.employee_id, lr.day): lr.leave_type
        for lr in lr_result.scalars().all()
    }

    # ---- ShiftAssignment 取得 ----
    assign_result = await db.execute(
        select(ShiftAssignment).where(ShiftAssignment.schedule_id == schedule.id)
    )
    assignments: list[ShiftAssignment] = list(assign_result.scalars().all())

    # (employee_id, day) → label
    cell_map: dict[tuple[int, int], str] = {}
    for a in assignments:
        day = a.date.day
        if a.assignment_type == "WORK" and a.pattern_id is not None:
            pat = pid_to_pattern.get(a.pattern_id)
            label = pat.pattern_name if pat else "?"
        elif a.assignment_type == "LEAVE":
            lt = leave_map.get((a.employee_id, day), "REQUESTED")
            label = LEAVE_TYPE_LABEL.get(lt, "●")
        else:
            label = "割当休日"
        cell_map[(a.employee_id, day)] = label

    # ---- Workbook 構築 ----
    wb = Workbook()
    ws = wb.active
    ws.title = f"{year}年{month}月"

    weekday_jp = ["月", "火", "水", "木", "金", "土", "日"]
    header_fill  = PatternFill("solid", fgColor=_HEADER_COLOR)
    sat_fill     = PatternFill("solid", fgColor=_SAT_COLOR)
    sun_fill     = PatternFill("solid", fgColor=_SUN_COLOR)
    holiday_fill = PatternFill("solid", fgColor=_HOLIDAY_COLOR)
    center_align = Alignment(horizontal="center", vertical="center")

    # ヘッダ行
    headers = ["氏名", "役職"]
    for d in range(1, num_days + 1):
        wd = date(year, month, d).weekday()
        suffix = f"・{holidays[d]}" if d in holidays else ""
        headers.append(f"{d}({weekday_jp[wd]}{suffix})")
    headers += ["勤務日数", "休日数"]

    for col_idx, hval in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=hval)
        cell.alignment = center_align
        if 3 <= col_idx <= num_days + 2:
            d = col_idx - 2
            wd = date(year, month, d).weekday()
            if wd == 6:
                cell.fill = sun_fill
                cell.font = Font(bold=True, color="9C0006")
            elif d in holidays:
                cell.fill = holiday_fill
                cell.font = Font(bold=True, color="C00000")
            elif wd == 5:
                cell.fill = sat_fill
                cell.font = Font(bold=True, color="1F4E79")
            else:
                cell.fill = header_fill
                cell.font = Font(bold=True, color="FFFFFF")
        else:
            cell.fill = header_fill
            cell.font = Font(bold=True, color="FFFFFF")

    # パターン → 色マップ
    pat_to_color: dict[str, str] = {}
    for p in patterns:
        group_initial = (p.group.name[0].upper() if p.group and p.group.name else "")
        pat_to_color[p.pattern_name] = _GROUP_COLORS.get(group_initial, "FFFFFF")

    # データ行
    for row_idx, e in enumerate(employees, start=2):
        ws.cell(row=row_idx, column=1, value=e.name)
        ws.cell(row=row_idx, column=2, value=e.role)
        work_count = 0

        for d in range(1, num_days + 1):
            col = d + 2
            label = cell_map.get((e.id, d), "")
            cell = ws.cell(row=row_idx, column=col, value=label)
            cell.alignment = center_align
            if label in ("割当休日", "●", "○", "有給"):
                cell.fill = PatternFill("solid", fgColor=_REST_COLOR)
            elif label in pat_to_color:
                cell.fill = PatternFill("solid", fgColor=pat_to_color[label])
                work_count += 1
            elif label:
                work_count += 1

        rest_count = num_days - work_count
        ws.cell(row=row_idx, column=num_days + 3, value=work_count)
        ws.cell(row=row_idx, column=num_days + 4, value=rest_count)

    # 列幅調整
    ws.column_dimensions["A"].width = 70 / 7.5
    ws.column_dimensions["B"].width = 87 / 7.5
    for d in range(1, num_days + 1):
        ws.column_dimensions[get_column_letter(d + 2)].width = 35 / 7.5
    ws.column_dimensions[get_column_letter(num_days + 3)].width = 56 / 7.5
    ws.column_dimensions[get_column_letter(num_days + 4)].width = 48 / 7.5

    ws.freeze_panes = "C2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_REST_CODE: dict[str, int] = {
    "●":    1,  # 希望休
    "○":    2,  # 仮休
    "有給":  3,
    "割当休日": 4,
}


async def export_schedule_csv_long(
    db: AsyncSession,
    schedule: ShiftSchedule,
) -> bytes:
    """
    schedule の稼働表をロング形式 CSV（cp932）でバイト列として返す。
    Windows Excel VBA での読み込みを想定。

    列: 社員番号, 氏名, 日付, 祝日, 作業パターン, 勤務区分
    休日は数値: ●=1(希望休) ○=2(仮休) 有給=3 割当休日=4
    """
    year, month = schedule.year, schedule.month
    num_days = calendar.monthrange(year, month)[1]

    # ---- 従業員取得 ----
    emp_result = await db.execute(
        select(Employee)
        .where(Employee.department_id == schedule.department_id)
        .order_by(Employee.sort_order, Employee.id)
    )
    employees: list[Employee] = list(emp_result.scalars().all())

    # ---- WorkPattern 取得 ----
    pat_result = await db.execute(
        select(WorkPattern)
        .join(WorkPatternGroup)
        .where(WorkPatternGroup.department_id == schedule.department_id)
    )
    pid_to_pattern = {p.id: p for p in pat_result.scalars().all()}

    # ---- LeaveRequest 取得 ----
    emp_ids = [e.id for e in employees]
    lr_result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.year == year,
            LeaveRequest.month == month,
            LeaveRequest.employee_id.in_(emp_ids),
        )
    )
    leave_map: dict[tuple[int, int], str] = {
        (lr.employee_id, lr.day): lr.leave_type
        for lr in lr_result.scalars().all()
    }

    # ---- ShiftAssignment 取得 ----
    assign_result = await db.execute(
        select(ShiftAssignment).where(ShiftAssignment.schedule_id == schedule.id)
    )
    cell_map: dict[tuple[int, int], str] = {}
    for a in assign_result.scalars().all():
        day = a.date.day
        if a.assignment_type == "WORK" and a.pattern_id is not None:
            pat = pid_to_pattern.get(a.pattern_id)
            label = pat.pattern_name if pat else "?"
        elif a.assignment_type == "LEAVE":
            lt = leave_map.get((a.employee_id, day), "REQUESTED")
            label = LEAVE_TYPE_LABEL.get(lt, "●")
        else:
            label = "割当休日"
        cell_map[(a.employee_id, day)] = label

    holidays = _get_holidays(year, month)

    # ---- CSV 生成 ----
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["社員番号", "氏名", "日付", "祝日", "作業パターン", "勤務区分"])

    for e in employees:
        for d in range(1, num_days + 1):
            dt = date(year, month, d)
            label = cell_map.get((e.id, d), "")
            code = _REST_CODE.get(label)
            w.writerow([
                e.employee_number,
                e.name,
                dt.strftime("%Y/%m/%d"),
                1 if d in holidays else 0,
                code if code is not None else label,
                "休日" if code is not None else "勤務",
            ])

    return buf.getvalue().encode("cp932")
