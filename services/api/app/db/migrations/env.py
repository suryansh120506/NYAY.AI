"""Alembic environment. The URL comes from settings (env), never from alembic.ini.

`-x url=...` overrides it (used by the test suite to migrate TEST_DATABASE_URL).
"""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.db.models import Base
from app.db.session import _connect_args

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    override = context.get_x_argument(as_dictionary=True).get("url")
    url = override or get_settings().migrations_url
    if not url:
        raise RuntimeError("Set DATABASE_URL (or DATABASE_DIRECT_URL) in .env before running migrations")
    return url


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    url = _url()
    engine = create_async_engine(url, connect_args=_connect_args(url))
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_run_async())
