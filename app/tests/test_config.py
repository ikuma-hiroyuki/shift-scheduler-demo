"""``Settings.warn_insecure_defaults`` の運用ログ動作テスト。

issue #134: 本番 (debug=False) で ``RECAPTCHA_SECRET`` 未設定時に
``logger.error("PRODUCTION SECURITY: ...")`` を出して env 設定忘れを目立たせる。
起動拒否はせず、dev 環境 (debug=True) は WARNING のままバイパスを許容する。
"""

from __future__ import annotations

import logging

from app.core.config import Settings


def _mk(**kwargs) -> Settings:
    """secret_key はデフォルト値警告を避けるため明示的に渡す。"""
    defaults = {
        "secret_key": "test-secret-not-default",
    }
    defaults.update(kwargs)
    return Settings(**defaults)


def test_production_without_recaptcha_secret_logs_error(caplog):
    """debug=False かつ recaptcha_secret 空 → ERROR ログに 'PRODUCTION SECURITY' を出す。"""
    with caplog.at_level(logging.ERROR, logger="app.core.config"):
        _mk(debug=False, recaptcha_secret="")

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert any("PRODUCTION SECURITY" in r.getMessage() for r in error_records), (
        f"PRODUCTION SECURITY を含む ERROR ログが期待されました。"
        f" 実際: {[(r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_dev_without_recaptcha_secret_does_not_log_error(caplog):
    """debug=True かつ recaptcha_secret 空 → ERROR ログは出ない (WARNING までは許容)。"""
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _mk(debug=True, recaptcha_secret="")

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert not error_records, (
        f"dev では ERROR ログを出してはいけません。 実際: "
        f"{[(r.levelname, r.getMessage()) for r in error_records]}"
    )


def test_production_with_recaptcha_secret_does_not_log_error(caplog):
    """debug=False かつ recaptcha_secret 設定済み → ERROR ログは出ない。"""
    with caplog.at_level(logging.ERROR, logger="app.core.config"):
        _mk(debug=False, recaptcha_secret="abc")

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert not error_records, (
        f"recaptcha_secret 設定済みでは ERROR ログを出してはいけません。 実際: "
        f"{[(r.levelname, r.getMessage()) for r in error_records]}"
    )
