"""Async SQLAlchemy engine. The connection string comes only from settings (DATABASE_URL)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings


def _connect_args(url: str) -> dict[str, Any]:
    """Supabase's transaction pooler (port 6543 / *.pooler.supabase.com) can't use prepared statements."""
    parsed = urlparse(url.replace("+asyncpg", ""))
    pooled = parsed.port == 6543 or (parsed.hostname or "").endswith("pooler.supabase.com")
    args: dict[str, Any] = {"server_settings": {"application_name": "nyay-api", "timezone": "UTC"}}
    if pooled:
        args |= {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    return args


def make_engine(url: str, *, pool_size: int = 5, max_overflow: int = 5) -> AsyncEngine:
    if not url:
        raise RuntimeError("DATABASE_URL is not set (see .env.example)")
    return create_async_engine(
        url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,
        pool_recycle=1_800,
        connect_args=_connect_args(url),
    )


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return make_engine(
        settings.database_url, pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request. Callers own their transactions (`async with db.begin()`)."""
    async with get_sessionmaker()() as session:
        yield session
