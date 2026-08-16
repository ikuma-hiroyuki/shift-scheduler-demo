"""Google reCAPTCHA v2 (invisible) の siteverify 呼び出し。

ログイン画面のボット送信ブロック用。

挙動:
  - ``RECAPTCHA_SECRET`` が空文字（未設定）の場合は検証をスキップし True を返す。
    開発環境やテスト環境を壊さないためのバイパス。警告ログのみ残す。
  - 設定済みの場合は Google ``siteverify`` API に POST し、``success`` フィールドを
    そのまま返す。``token`` が空ならネットワーク呼び出し前に False を返す。
  - 通信エラー・想定外レスポンスは False を返す（fail-closed）。
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
_TIMEOUT_SECONDS = 5.0


async def verify_recaptcha(token: str | None) -> bool:
    """captcha token を Google siteverify で検証する。

    Args:
        token: フロントエンドの reCAPTCHA widget が発行した token。
            ``RECAPTCHA_SECRET`` 未設定時は token なしでも True。

    Returns:
        True なら検証成功（または開発バイパス）。False なら失敗。
    """
    secret = settings.recaptcha_secret
    if not secret:
        logger.warning(
            "RECAPTCHA_SECRET が未設定のため reCAPTCHA 検証をスキップしました。"
            "本番環境では必ず設定してください。"
        )
        return True

    if not token:
        return False

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as http:
            resp = await http.post(
                SITEVERIFY_URL,
                data={"secret": secret, "response": token},
            )
    except httpx.HTTPError as exc:
        logger.warning("reCAPTCHA siteverify への通信に失敗しました: %s", exc)
        return False

    if resp.status_code != 200:
        logger.warning(
            "reCAPTCHA siteverify が非 200 を返しました: status=%s", resp.status_code
        )
        return False

    try:
        body = resp.json()
    except ValueError:
        logger.warning("reCAPTCHA siteverify のレスポンスが JSON ではありません")
        return False

    return bool(body.get("success", False))
