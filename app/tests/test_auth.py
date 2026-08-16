"""認証エンドポイントのテスト。"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings


def _make_async_client_factory(success: bool):
    """``httpx.AsyncClient(...)`` を差し替えるためのコンテキストマネージャ風モック。

    ``async with httpx.AsyncClient(...) as http:`` の流れで、
    ``http.post`` を呼ばれた時に siteverify レスポンス相当の MagicMock を返す。
    """
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"success": success}

    instance = MagicMock()
    instance.post = AsyncMock(return_value=response)
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=None)

    factory = MagicMock(return_value=instance)
    return factory, instance


@pytest.mark.asyncio
async def test_login_success(client, admin_user):
    """正しい認証情報でログインすると JWT が返る（dev バイパス）。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "admin@test.com", "password": "testpass"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert len(body["access_token"]) > 20


@pytest.mark.asyncio
async def test_login_wrong_password(client, admin_user):
    """パスワードが違う場合は 401 が返る。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "admin@test.com", "password": "wrongpass"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(client):
    """存在しないユーザーは 401 が返る。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "nobody@test.com", "password": "testpass"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_no_token_rejected(client, admin_user):
    """トークンなしでエンドポイントにアクセスすると 401 が返る。"""
    http, _ = client
    resp = await http.get("/api/v1/employees")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_rejected(client, admin_user):
    """無効なトークンは 401 が返る。"""
    http, _ = client
    resp = await http.get(
        "/api/v1/employees",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert resp.status_code == 401


# ----------------------------------------------------------------------- #
# reCAPTCHA 検証
# ----------------------------------------------------------------------- #


@pytest.fixture
def recaptcha_enabled(monkeypatch):
    """RECAPTCHA_SECRET を設定して siteverify を強制する。"""
    monkeypatch.setattr(settings, "recaptcha_secret", "test-secret")
    yield


@pytest.mark.asyncio
async def test_login_recaptcha_success(client, admin_user, recaptcha_enabled):
    """siteverify が success=True なら通常通りログインできる。"""
    http, _ = client
    factory, instance = _make_async_client_factory(success=True)
    with patch("app.services.recaptcha_service.httpx.AsyncClient", factory):
        resp = await http.post(
            "/auth/login",
            data={
                "username": "admin@test.com",
                "password": "testpass",
                "captcha_token": "valid-captcha-token",
            },
        )
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    instance.post.assert_awaited_once()
    # siteverify URL と secret/token が含まれていることを確認
    call_args = instance.post.await_args
    assert "siteverify" in call_args.args[0]
    assert call_args.kwargs["data"]["secret"] == "test-secret"
    assert call_args.kwargs["data"]["response"] == "valid-captcha-token"


@pytest.mark.asyncio
async def test_login_recaptcha_failure_returns_401(client, admin_user, recaptcha_enabled):
    """siteverify が success=False なら 401。"""
    http, _ = client
    factory, _ = _make_async_client_factory(success=False)
    with patch("app.services.recaptcha_service.httpx.AsyncClient", factory):
        resp = await http.post(
            "/auth/login",
            data={
                "username": "admin@test.com",
                "password": "testpass",
                "captcha_token": "bad-captcha-token",
            },
        )
    assert resp.status_code == 401
    assert "reCAPTCHA" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_recaptcha_missing_token_returns_401(
    client, admin_user, recaptcha_enabled
):
    """RECAPTCHA_SECRET 設定済みで captcha_token が無い場合は 401。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "admin@test.com", "password": "testpass"},
    )
    assert resp.status_code == 401
    assert "reCAPTCHA" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_bypass_when_secret_unset(client, admin_user, monkeypatch):
    """RECAPTCHA_SECRET が空文字なら captcha_token なしでもログインできる（dev バイパス）。"""
    monkeypatch.setattr(settings, "recaptcha_secret", "")
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "admin@test.com", "password": "testpass"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


# ----------------------------------------------------------------------- #
# /auth/me — 現在ログイン中ユーザー情報取得
# ----------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_me_requires_token_401(client, admin_user):
    """トークンなしの /auth/me は 401。"""
    http, _ = client
    resp = await http.get("/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_admin_user_with_is_admin_true(client, auth_headers, admin_user):
    """admin で /auth/me を叩くと is_admin=True を含むユーザー情報が返る。"""
    http, _ = client
    resp = await http.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "admin@test.com"
    assert body["is_active"] is True
    assert body["is_admin"] is True
    assert "id" in body


@pytest.mark.asyncio
async def test_me_returns_regular_user_with_is_admin_false(
    client, regular_auth_headers, regular_user
):
    """一般ユーザーで /auth/me を叩くと is_admin=False が返る。"""
    http, _ = client
    resp = await http.get("/auth/me", headers=regular_auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "user@test.com"
    assert body["is_admin"] is False
