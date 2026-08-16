"""
app/tasks/worker.py — ARQ WorkerSettings

起動:
  arq app.tasks.worker.WorkerSettings
"""
from __future__ import annotations

from arq.connections import RedisSettings

from app.core.config import settings
from app.tasks.shift_tasks import generate_shift


def _parse_redis_settings(url: str) -> RedisSettings:
    """redis://host:port/db 形式の URL を RedisSettings に変換する。"""
    # "redis://redis:6379/0" → host=redis, port=6379, database=0
    without_scheme = url.removeprefix("redis://")
    host_port, _, db = without_scheme.partition("/")
    host, _, port = host_port.partition(":")
    return RedisSettings(
        host=host or "localhost",
        port=int(port) if port else 6379,
        database=int(db) if db else 0,
    )


class WorkerSettings:
    functions = [generate_shift]
    redis_settings = _parse_redis_settings(settings.redis_url)
    max_jobs = 4
    job_timeout = 900  # 15分
