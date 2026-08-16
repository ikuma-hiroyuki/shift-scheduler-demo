from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# Supabase 等の pgBouncer トランザクションモードプーラー配下では asyncpg の
# prepared statement キャッシュが「prepared statement does not exist」を
# 引き起こすため無効化する。セッションモード/直結でも無害。
PGBOUNCER_CONNECT_ARGS = {"statement_cache_size": 0}

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    connect_args=PGBOUNCER_CONNECT_ARGS,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
