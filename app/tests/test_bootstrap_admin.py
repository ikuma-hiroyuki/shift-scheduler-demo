"""bootstrap_admin スクリプトのテスト。

本番デプロイ時に env (ADMIN_EMAIL / ADMIN_PASSWORD) から管理者ユーザーを
upsert する挙動を検証する。
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.models.user import User
from app.scripts.bootstrap_admin import bootstrap_admin, main


@pytest.mark.asyncio
async def test_bootstrap_admin_inserts_new_user(_tx: AsyncSession) -> None:
    email = "newadmin@example.com"
    password = "S3cure-Pass!"

    created = await bootstrap_admin(_tx, email, password)

    assert created is True
    result = await _tx.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    assert user.is_active is True
    assert user.is_admin is True
    assert verify_password(password, user.hashed_password)


@pytest.mark.asyncio
async def test_bootstrap_admin_preserves_disabled_state(_tx: AsyncSession) -> None:
    """incident response で is_active=False にした admin が、
    bootstrap で勝手に再有効化されないことを保証する (security regression)."""
    email = "disabled@example.com"
    _tx.add(
        User(
            email=email,
            hashed_password=get_password_hash("old"),
            is_active=False,
        )
    )
    await _tx.flush()

    await bootstrap_admin(_tx, email, "new-password")

    result = await _tx.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    assert user.is_active is False, (
        "bootstrap_admin が is_active=False の admin を再有効化してしまっている。"
        "incident response シナリオで安全弁が外れる。"
    )
    assert verify_password("new-password", user.hashed_password)


@pytest.mark.asyncio
async def test_bootstrap_admin_updates_existing_user(_tx: AsyncSession) -> None:
    email = "existing@example.com"
    _tx.add(
        User(
            email=email,
            hashed_password=get_password_hash("old-password"),
            is_active=True,
        )
    )
    await _tx.flush()

    new_password = "Rotated-Pass!"
    created = await bootstrap_admin(_tx, email, new_password)

    assert created is False
    result = await _tx.execute(select(User).where(User.email == email))
    users = result.scalars().all()
    assert len(users) == 1
    assert verify_password(new_password, users[0].hashed_password)
    assert not verify_password("old-password", users[0].hashed_password)
    assert users[0].is_admin is True


@pytest.mark.asyncio
async def test_bootstrap_admin_promotes_existing_non_admin_to_admin(
    _tx: AsyncSession,
) -> None:
    """0008 migration 直後、既存ユーザーは is_admin=False で始まる。
    bootstrap_admin はこれを True に昇格させる責務を持つ (本番初回デプロイ時の管理者保証)。
    """
    email = "preexisting@example.com"
    _tx.add(
        User(
            email=email,
            hashed_password=get_password_hash("any"),
            is_active=True,
            is_admin=False,
        )
    )
    await _tx.flush()

    await bootstrap_admin(_tx, email, "rotated")

    result = await _tx.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    assert user.is_admin is True, (
        "bootstrap_admin が既存ユーザーを is_admin=True に昇格していない。"
        "本番初回デプロイで管理画面に入れなくなる。"
    )


def test_main_exits_when_env_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code != 0


def test_main_exits_when_password_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code != 0
