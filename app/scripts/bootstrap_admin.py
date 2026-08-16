"""本番デプロイ時に実行する管理者ユーザー upsert スクリプト。

env から `ADMIN_EMAIL` / `ADMIN_PASSWORD` を読み、既存ユーザーがいれば
パスワードを更新、いなければ新規作成する。Render の Pre-Deploy Command で
`alembic upgrade head && python -m app.scripts.bootstrap_admin` のように実行する想定。

env 未設定時は exit code 1 で終了する (デプロイ失敗扱い)。
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import PGBOUNCER_CONNECT_ARGS
from app.core.security import get_password_hash
from app.models.user import User

logger = logging.getLogger(__name__)


async def bootstrap_admin(session: AsyncSession, email: str, password: str) -> bool:
    """管理者ユーザーを upsert する。

    Returns:
        True: 新規作成した場合
        False: 既存ユーザーのパスワードを更新した場合
    """
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    hashed = get_password_hash(password)

    if user is None:
        session.add(
            User(
                email=email,
                hashed_password=hashed,
                is_active=True,
                is_admin=True,
            )
        )
        await session.flush()
        return True

    # incident response で意図的に is_active=False にした admin を
    # デプロイで自動再有効化しないため、update path では is_active に触らない。
    # is_admin はデプロイのたびに本番管理者を保証する責務上、必ず True に揃える
    # (incident response で admin を降格させたい場合は管理画面 or DB 直編集で対応)。
    user.hashed_password = hashed
    user.is_admin = True
    await session.flush()
    return False


async def _run(email: str, password: str) -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error(
            "DATABASE_URL env が未設定です。本番デプロイでは必ず設定してください "
            "(dev デフォルトへの fallback は禁止)。"
        )
        sys.exit(1)
    engine = create_async_engine(database_url, echo=False, connect_args=PGBOUNCER_CONNECT_ARGS)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_maker() as session:
            created = await bootstrap_admin(session, email, password)
            await session.commit()
    finally:
        await engine.dispose()

    action = "created" if created else "updated"
    logger.info("bootstrap_admin %s admin user", action)
    print(f"bootstrap_admin {action} admin user")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    if not email or not password:
        logger.error(
            "ADMIN_EMAIL / ADMIN_PASSWORD env が未設定です。"
            "本番管理者ユーザーを作成できません。"
        )
        sys.exit(1)

    asyncio.run(_run(email, password))


if __name__ == "__main__":
    main()
