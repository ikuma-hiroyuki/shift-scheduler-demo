"""
テスト用 fixture。

トランザクション分離:
  各テストは「外側のトランザクション＋セーブポイント」で囲まれる。
  エンドポイント内の commit() はセーブポイントへの commit になるため、
  テスト終了後に外側をロールバックすれば DB が元の状態に戻る。
  これにより全テストが独立して動作する。

テスト用 DB:
  TEST_DATABASE_URL 環境変数（デフォルト: demomart_test）を使用。
  初回実行時に自動作成する。

イベントループの扱い:
  pytest-asyncio の各テストは独立したイベントループで動作するため、
  DB エンジン（asyncpg コネクション）はテストごとに新規作成する。
  テーブルの作成・削除のみセッションスコープで行い、
  実際のコネクションはテストスコープで生成する。
"""

import asyncio
import os
import socket
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

import app.models  # noqa: F401 — 全モデルを登録
from app.api.deps import get_db
from app.core.security import get_password_hash
from app.main import app
from app.models.base import Base
from app.models.department import Department, WorkRuleConfig
from app.models.user import User


def _resolve_test_db_url() -> str:
    """TEST_DATABASE_URL が明示されていればそれを使う。
    未設定の場合、docker compose 内なら `db` が解決できるのでそれを採用、
    macOS ローカルなど `db` ホストが解決できない環境では localhost にフォールバック。
    """
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    try:
        socket.getaddrinfo("db", 5432)
        return "postgresql+asyncpg://demomart:demomart@db:5432/demomart_test"
    except socket.gaierror:
        return "postgresql+asyncpg://demomart:demomart@localhost:5432/demomart_test"


TEST_DB_URL = _resolve_test_db_url()


# ------------------------------------------------------------------ #
# セッションスコープ: テーブル作成（同期。イベントループを汚染しない）
# ------------------------------------------------------------------ #

@pytest.fixture(scope="session")
def _ensure_test_db():
    """テスト DB を作成してテーブルを初期化する（同期 fixture）。"""

    async def _setup() -> None:
        # demomart_test DB が存在しない場合は作成
        base_url = TEST_DB_URL.rsplit("/", 1)[0] + "/demomart"
        admin = create_async_engine(base_url)
        try:
            async with admin.execution_options(isolation_level="AUTOCOMMIT").connect() as conn:
                result = await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = 'demomart_test'")
                )
                if result.fetchone() is None:
                    await conn.execute(text("CREATE DATABASE demomart_test"))
        finally:
            await admin.dispose()

        engine = create_async_engine(TEST_DB_URL)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        finally:
            await engine.dispose()

    async def _teardown() -> None:
        engine = create_async_engine(TEST_DB_URL)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
        finally:
            await engine.dispose()

    asyncio.run(_setup())
    yield
    asyncio.run(_teardown())


# ------------------------------------------------------------------ #
# 関数スコープ: テストごとに独立したエンジン＋セーブポイント分離
# ------------------------------------------------------------------ #

@pytest_asyncio.fixture
async def _tx(_ensure_test_db) -> AsyncGenerator[AsyncSession, None]:
    """
    各テスト用のセーブポイント付きセッション。

    テスト関数のイベントループ内でエンジンを新規作成することで
    asyncpg のループバインディング問題を回避する。
    テスト後にアウタートランザクションをロールバックして DB を元に戻す。
    """
    engine = create_async_engine(TEST_DB_URL)
    try:
        async with engine.connect() as conn:
            await conn.begin()
            session = AsyncSession(
                conn,
                join_transaction_mode="create_savepoint",
                expire_on_commit=False,
            )
            try:
                yield session
            finally:
                await session.close()
                await conn.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _seed_default_roles(_tx: AsyncSession) -> None:
    """デフォルト 5 役職を全テストに投入する。
    本番では migration の bulk_insert で入るが、テスト DB は ``Base.metadata.create_all``
    で生成するため、別途 fixture で用意する必要がある。
    Employee.role が roles.code への FK なので、ほぼ全テストで必須。
    issue #235: rest_days_28_29/30/31 も seed する (NOT NULL).
    """
    from app.models.role import Role
    # (code, name, order_index, rest_days_28_29, rest_days_30, rest_days_31)
    defaults = [
        ("CHIEF",       "主任",       0, 9, 9, 10),
        ("DEPUTY",      "副主任",     1, 9, 9, 10),
        ("STAFF",       "一般",       2, 9, 9, 10),
        ("FULLPART",    "フルパート", 3, 7, 7, 7),
        ("MORNINGPART", "早朝パート", 4, 7, 7, 7),
    ]
    for code, name, idx, d28_29, d30, d31 in defaults:
        _tx.add(Role(
            code=code,
            name=name,
            order_index=idx,
            rest_days_28_29=d28_29,
            rest_days_30=d30,
            rest_days_31=d31,
        ))
    await _tx.flush()


@pytest_asyncio.fixture
async def client(_tx: AsyncSession) -> AsyncGenerator[tuple[AsyncClient, AsyncSession], None]:
    """HTTP クライアントと DB セッションのペア。依存性を override してテスト用セッションを使わせる。"""
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield _tx

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http, _tx
    app.dependency_overrides.clear()


# ------------------------------------------------------------------ #
# 共通ヘルパー fixture
# ------------------------------------------------------------------ #

@pytest.fixture(autouse=True)
def _bypass_recaptcha(monkeypatch):
    """全テストで reCAPTCHA を dev バイパスモードに固定する。

    開発機 / CI の env に ``RECAPTCHA_SECRET`` が設定されていると
    ``app/services/recaptcha_service.py`` が siteverify API を呼び出すため、
    ``auth_headers`` fixture からの login (token なし) が 401 で落ちる。

    test_auth.py の reCAPTCHA 専用テストは個別に
    ``monkeypatch.setattr(settings, "recaptcha_secret", "test-secret")``
    で再上書きするため、この autouse fixture と共存できる
    (monkeypatch chain で後勝ち、テスト終了で両方 restore される)。
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "recaptcha_secret", "")


@pytest.fixture(autouse=True)
def _override_jwt_secret(monkeypatch):
    """全テストで JWT 署名鍵を test 専用値に固定する。

    container env の SECRET_KEY が dev / 本番値のままだと、test 中に発行する
    JWT が本番と同じ鍵で署名される。実害は小 (test ユーザーは本番 DB に
    存在しないので発行 token は本番では 401) だが、深層防御として
    pytest 内では別鍵を使う。
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "secret_key", "test-secret-key-do-not-use-in-prod")


@pytest_asyncio.fixture
async def admin_user(client: tuple) -> User:
    """テスト用管理者ユーザー。"""
    _, session = client
    user = User(
        email="admin@test.com",
        hashed_password=get_password_hash("testpass"),
        is_active=True,
        is_admin=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest_asyncio.fixture
async def regular_user(client: tuple) -> User:
    """テスト用一般ユーザー (is_admin=False)。"""
    _, session = client
    user = User(
        email="user@test.com",
        hashed_password=get_password_hash("userpass"),
        is_active=True,
        is_admin=False,
    )
    session.add(user)
    await session.flush()
    return user


@pytest_asyncio.fixture
async def auth_headers(client: tuple, admin_user: User) -> dict:
    """認証済みリクエストヘッダー (admin)。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "admin@test.com", "password": "testpass"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest_asyncio.fixture
async def regular_auth_headers(client: tuple, regular_user: User) -> dict:
    """認証済みリクエストヘッダー (一般ユーザー)。"""
    http, _ = client
    resp = await http.post(
        "/auth/login",
        data={"username": "user@test.com", "password": "userpass"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest_asyncio.fixture
async def dept(client: tuple) -> Department:
    """テスト用部門（WorkRuleConfig 付き）。"""
    _, session = client
    d = Department(name="テスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    await session.flush()
    return d
