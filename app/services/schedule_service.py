"""
app/services/schedule_service.py — 稼働表生成タスク起動・スケジュール管理
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule import ShiftSchedule

# キャンセルフラグ。ARQ ワーカーを廃止し FastAPI プロセス内で直接生成タスクを走らせる
# ため、Redis ではなくプロセス内 set で管理する（単一プロセス前提）。
_cancelled_schedule_ids: set[int] = set()


def mark_cancelled(schedule_id: int) -> None:
    _cancelled_schedule_ids.add(schedule_id)


def is_cancel_requested(schedule_id: int) -> bool:
    return schedule_id in _cancelled_schedule_ids


def clear_cancel_flag(schedule_id: int) -> None:
    _cancelled_schedule_ids.discard(schedule_id)


def _spawn_generation_task(schedule_id: int, time_limit: float, workers: int) -> None:
    """generate_shift をバックグラウンドタスクとして起動する。
    schedule_service ⇔ shift_tasks の循環importを避けるため関数内 import。
    テストではこの関数自体を monkeypatch して実際の起動を止める。
    """
    from app.tasks.shift_tasks import generate_shift

    asyncio.create_task(generate_shift(schedule_id, time_limit, workers))


async def enqueue_generation(
    db: AsyncSession,
    department_id: int,
    year: int,
    month: int,
    time_limit: float = 120.0,
    workers: int = 4,
) -> ShiftSchedule:
    """
    ShiftSchedule レコードを作成し、生成タスクをバックグラウンドで起動する。
    同部門・同年月に GENERATING / GENERATED が存在する場合は新規 attempt を作成する。
    """
    # generation_attempt の採番
    existing = await db.execute(
        select(ShiftSchedule).where(
            ShiftSchedule.department_id == department_id,
            ShiftSchedule.year == year,
            ShiftSchedule.month == month,
        )
    )
    attempts = [s.generation_attempt for s in existing.scalars().all()]
    next_attempt = max(attempts, default=0) + 1

    schedule = ShiftSchedule(
        department_id=department_id,
        year=year,
        month=month,
        status="DRAFT",
        generation_attempt=next_attempt,
        is_active=False,
        time_limit=time_limit,
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)

    _spawn_generation_task(schedule.id, time_limit, workers)

    return schedule


async def request_cancel(
    db: AsyncSession,
    schedule_id: int,
) -> ShiftSchedule | None:
    """
    生成中スケジュールの停止を要求する。

    - DRAFT (タスクがまだ起動していない) は即座に CANCELLED に遷移し、
      フラグも立てて起動直後のタスクが短絡停止できるようにする。
    - GENERATING はフラグだけ立て、generate_shift 内の watcher が solver.stop_search() を呼ぶ。
      generate_shift が後段で finished_at と CANCELLED 状態を確定する。
    - GENERATED / INFEASIBLE / CANCELLED は何もせず None を返す（呼び出し側で 409）。

    Returns:
        変更後の ShiftSchedule（cancel 受理）、または None（受理不可）
    """
    schedule = await db.get(ShiftSchedule, schedule_id)
    if schedule is None:
        return None
    if schedule.status not in ("DRAFT", "GENERATING"):
        return None

    mark_cancelled(schedule_id)

    # DRAFT の場合はタスクがまだ動いていないので即時 CANCELLED に確定。
    # GENERATING の場合は generate_shift がフラグを拾って自身で確定する。
    if schedule.status == "DRAFT":
        schedule.status = "CANCELLED"
        schedule.finished_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(schedule)

    return schedule


async def get_schedule(db: AsyncSession, schedule_id: int) -> ShiftSchedule | None:
    return await db.get(ShiftSchedule, schedule_id)


async def list_schedules(
    db: AsyncSession,
    department_id: int | None = None,
) -> list[ShiftSchedule]:
    stmt = select(ShiftSchedule).order_by(
        ShiftSchedule.year.desc(),
        ShiftSchedule.month.desc(),
        ShiftSchedule.generation_attempt.desc(),
    )
    if department_id is not None:
        stmt = stmt.where(ShiftSchedule.department_id == department_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())
