"""
app/services/compensatory_service.py — 代休提案

手動調整（REST → WORK）後、休日数不足を補う代休候補日を提案する。

スコア基準（降順）:
  1. SpecialAssignmentRule に抵触しない
  2. LeaveRequest（希望休・有給）ではない
  3. 連勤ブロックを分断しない（両隣が休みでない日を優先）
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.leave_request import LeaveRequest
from app.models.pattern_rule import SpecialAssignmentRule
from app.models.schedule import ShiftAssignment, ShiftSchedule


@dataclass
class CompensatoryProposal:
    date: date
    score: int
    reason: str


async def propose_compensatory(
    db: AsyncSession,
    schedule_id: int,
    employee_id: int,
    target_date: date,
    top_n: int = 3,
) -> list[CompensatoryProposal]:
    """
    employee_id の target_date を REST → WORK に変更する場合の代休候補を返す。

    候補: 現在 WORK のアサインを REST に変更できる日
    除外: target_date 自体、LeaveRequest がある日、SpecialAssignmentRule 対象日
    """
    # ---- スケジュール取得 ----
    schedule: ShiftSchedule | None = await db.get(ShiftSchedule, schedule_id)
    if schedule is None:
        return []

    year, month = schedule.year, schedule.month
    num_days = calendar.monthrange(year, month)[1]

    # ---- 現在の WORK アサイン ----
    assign_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule_id,
            ShiftAssignment.employee_id == employee_id,
            ShiftAssignment.assignment_type == "WORK",
        )
    )
    work_days: set[date] = {a.date for a in assign_result.scalars().all()}

    # ---- LeaveRequest 取得 ----
    lr_result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.year == year,
            LeaveRequest.month == month,
        )
    )
    leave_days: set[date] = {
        date(year, month, lr.day) for lr in lr_result.scalars().all()
    }

    # ---- SpecialAssignmentRule が発火する日を取得 ----
    sar_result = await db.execute(
        select(SpecialAssignmentRule).where(
            SpecialAssignmentRule.department_id == schedule.department_id
        )
    )
    special_dates: set[date] = set()
    last_day = date(year, month, num_days)
    for sar in sar_result.scalars().all():
        if sar.condition_type == "LAST_DAY":
            special_dates.add(last_day)
        elif sar.condition_type == "WEEKDAY" and sar.condition_value is not None:
            for d in range(1, num_days + 1):
                dt = date(year, month, d)
                if dt.weekday() == sar.condition_value:
                    special_dates.add(dt)

    # ---- REST アサイン（全日） ----
    all_assign_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule_id,
            ShiftAssignment.employee_id == employee_id,
        )
    )
    all_assignments = {a.date: a.assignment_type for a in all_assign_result.scalars().all()}

    # ---- 候補選定とスコアリング ----
    candidates: list[CompensatoryProposal] = []
    for d in work_days:
        if d == target_date:
            continue
        if d in leave_days:
            continue
        if d in special_dates:
            continue

        score = 10
        reasons: list[str] = []

        # 特別割当日でない
        score += 2

        # 前後が連勤でない（連勤ブロックを分断しない）
        prev_day = date(year, month, d.day - 1) if d.day > 1 else None
        next_day = date(year, month, d.day + 1) if d.day < num_days else None
        prev_is_rest = prev_day is None or all_assignments.get(prev_day) in ("REST", "LEAVE")
        next_is_rest = next_day is None or all_assignments.get(next_day) in ("REST", "LEAVE")

        if prev_is_rest or next_is_rest:
            score += 3
            reasons.append("連勤ブロック端")
        else:
            reasons.append("連勤中間")

        candidates.append(CompensatoryProposal(
            date=d,
            score=score,
            reason="、".join(reasons) if reasons else "候補日",
        ))

    candidates.sort(key=lambda p: (-p.score, p.date))
    return candidates[:top_n]
