"""
app/services/schedule_service.py — 稼働表生成キュー投入・スケジュール管理
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.schedule import ShiftSchedule

# Redis に置く cancel フラグ。worker がポーリングして solver.stop_search() を呼ぶ。
CANCEL_KEY_PREFIX = "schedule:cancel:"
CANCEL_KEY_TTL_SEC = 1800  # 30 分。job_timeout (15 分) より長くしておけば確実に消える


def cancel_key(schedule_id: int) -> str:
    return f"{CANCEL_KEY_PREFIX}{schedule_id}"


def _redis_settings():
    """schedule_service 内で Redis 接続が必要な場合の RedisSettings を返す。"""
    from arq.connections import RedisSettings

    url = settings.redis_url
    without_scheme = url.removeprefix("redis://")
    host_port, _, db_num = without_scheme.partition("/")
    host, _, port = host_port.partition(":")
    return RedisSettings(
        host=host or "localhost",
        port=int(port) if port else 6379,
        database=int(db_num) if db_num else 0,
    )


async def enqueue_generation(
    db: AsyncSession,
    department_id: int,
    year: int,
    month: int,
    time_limit: float = 120.0,
    workers: int = 4,
) -> ShiftSchedule:
    """
    ShiftSchedule レコードを作成して ARQ キューにジョブを投入する。
    同部門・同年月に GENERATING / GENERATED が存在する場合は新規 attempt を作成する。
    """
    from arq import create_pool

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

    redis = await create_pool(_redis_settings())
    await redis.enqueue_job(
        "generate_shift",
        schedule.id,
        time_limit,
        workers,
    )
    await redis.aclose()

    return schedule


async def request_cancel(
    db: AsyncSession,
    schedule_id: int,
) -> ShiftSchedule | None:
    """
    生成中スケジュールの停止を要求する。

    - DRAFT (キュー投入済みでまだ worker が拾っていない) は即座に CANCELLED に遷移し、
      Redis フラグも立てて worker が拾った直後に短絡停止できるようにする。
    - GENERATING はフラグだけ立て、worker の watcher が solver.stop_search() を呼ぶ。
      worker が後段で finished_at と CANCELLED 状態を確定する。
    - GENERATED / INFEASIBLE / CANCELLED は何もせず None を返す（呼び出し側で 409）。

    Returns:
        変更後の ShiftSchedule（cancel 受理）、または None（受理不可）
    """
    from arq import create_pool

    schedule = await db.get(ShiftSchedule, schedule_id)
    if schedule is None:
        return None
    if schedule.status not in ("DRAFT", "GENERATING"):
        return None

    # Redis にフラグを置く（worker 側のポーリングで検知）
    redis = await create_pool(_redis_settings())
    try:
        await redis.set(cancel_key(schedule_id), b"1", ex=CANCEL_KEY_TTL_SEC)
    finally:
        await redis.aclose()

    # DRAFT の場合は worker がまだ動いていないので即時 CANCELLED に確定。
    # GENERATING の場合は worker がフラグを拾って自身で確定する。
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
