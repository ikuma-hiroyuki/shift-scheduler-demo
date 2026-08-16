"""
app/tasks/worker.py の単体テスト。

ARQ WorkerSettings は実際にワーカーを起動せずに、URL パースと
クラス属性の正しさだけを確認する。
"""
from __future__ import annotations

from app.tasks.worker import WorkerSettings, _parse_redis_settings
from app.tasks.shift_tasks import generate_shift


class TestParseRedisSettings:
    def test_parses_full_url(self) -> None:
        s = _parse_redis_settings("redis://redis:6379/0")
        assert s.host == "redis"
        assert s.port == 6379
        assert s.database == 0

    def test_parses_url_without_db(self) -> None:
        s = _parse_redis_settings("redis://localhost:6380")
        assert s.host == "localhost"
        assert s.port == 6380
        assert s.database == 0

    def test_parses_url_without_port(self) -> None:
        s = _parse_redis_settings("redis://myredis")
        assert s.host == "myredis"
        assert s.port == 6379
        assert s.database == 0

    def test_empty_host_falls_back_to_localhost(self) -> None:
        s = _parse_redis_settings("redis://")
        assert s.host == "localhost"
        assert s.port == 6379

    def test_picks_alternate_database(self) -> None:
        s = _parse_redis_settings("redis://r:6379/3")
        assert s.database == 3


class TestWorkerSettings:
    def test_exposes_generate_shift_function(self) -> None:
        assert generate_shift in WorkerSettings.functions

    def test_max_jobs_is_4(self) -> None:
        assert WorkerSettings.max_jobs == 4

    def test_job_timeout_900(self) -> None:
        assert WorkerSettings.job_timeout == 900

    def test_redis_settings_built_from_app_config(self) -> None:
        # 既定構築済みの redis_settings はクラス属性として存在し、host/port を持つ
        rs = WorkerSettings.redis_settings
        assert isinstance(rs.host, str) and rs.host
        assert isinstance(rs.port, int)
