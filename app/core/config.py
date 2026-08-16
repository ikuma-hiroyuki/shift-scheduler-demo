import logging

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRET_KEY = "changeme-in-production"

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://demomart:demomart@localhost:5432/demomart"
    secret_key: str = _DEFAULT_SECRET_KEY
    access_token_expire_minutes: int = 60 * 24 * 7
    debug: bool = False
    recaptcha_secret: str = ""

    @model_validator(mode="after")
    def warn_insecure_defaults(self) -> "Settings":
        if self.secret_key == _DEFAULT_SECRET_KEY:
            logger.warning(
                "SECRET_KEY がデフォルト値のまま起動しています。"
                "本番環境では必ず環境変数 SECRET_KEY を設定してください。"
            )
        # issue #134: 本番 (debug=False) で reCAPTCHA secret が空のままだと
        # ボット送信ブロックがバイパスされるため、運用ログに ERROR を残して
        # env 設定忘れに気付きやすくする。dev (debug=True) はバイパス継続のため
        # ERROR を出さない (recaptcha_service.py の WARNING のみ)。
        if not self.debug and not self.recaptcha_secret:
            logger.error(
                "PRODUCTION SECURITY: RECAPTCHA_SECRET が未設定のまま"
                "本番モード (debug=False) で起動しています。"
                "ログイン画面の reCAPTCHA 検証がバイパスされ、"
                "ボット送信を防げません。env に RECAPTCHA_SECRET を必ず設定してください。"
            )
        return self


settings = Settings()
