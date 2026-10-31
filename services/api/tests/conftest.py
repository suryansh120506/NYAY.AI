"""Test harness. Needs TEST_DATABASE_URL (a database whose name contains "test") and TEST_REDIS_URL (a local Redis
the suite may flush) in .env.

The local stand-ins work out of the box: `docker compose -f infra/docker-compose.yml up -d`.
The schema is rebuilt from the Alembic migrations once per run, so tests exercise the real triggers and constraints.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlparse

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

os.environ.setdefault("ENV", "test")

from app.core.config import get_settings
from app.db.session import make_engine

SERVICE_DIR = Path(__file__).resolve().parents[1]


def _test_url() -> str:
    url = get_settings().test_database_url
    if not url:
        pytest.exit("TEST_DATABASE_URL is not set (see .env.example)", returncode=2)
    name = (urlparse(url.replace("+asyncpg", "")).path or "").lstrip("/")
    if "test" not in name:
        pytest.exit(
            f"Refusing to run: TEST_DATABASE_URL database {name!r} does not contain 'test'", returncode=2
        )
    return url


async def _reset_schema(url: str) -> None:
    engine = make_engine(url, pool_size=1, max_overflow=0)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> str:
    """Fresh schema, then `alembic upgrade head` in a subprocess (Alembic's env.py runs its own event loop)."""
    url = _test_url()
    asyncio.run(_reset_schema(url))
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "-x", f"url={url}", "upgrade", "head"],
        cwd=SERVICE_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.exit(f"alembic upgrade failed:\n{result.stderr[-3000:]}", returncode=2)
    return url


@pytest.fixture(scope="session")
async def engine(migrated_database: str) -> AsyncIterator[AsyncEngine]:
    eng = make_engine(migrated_database, pool_size=10, max_overflow=10)
    yield eng
    await eng.dispose()


@pytest.fixture(scope="session")
def sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def db(sessionmaker: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with sessionmaker() as session:
        yield session


async def create_user(db: AsyncSession, *, role: str = "user") -> uuid.UUID:
    """A fresh user with a wallet. Tests never share users, so the append-only ledger needs no cleanup."""
    from app.ledger.posting import ensure_wallet

    user_id = uuid.uuid4()
    phone = "+919" + str(uuid.uuid4().int)[:9]
    async with db.begin():
        await db.execute(
            text("INSERT INTO users (id, phone_e164, role) VALUES (:id, :phone, :role)"),
            {"id": user_id, "phone": phone, "role": role},
        )
        await ensure_wallet(db, user_id)
    return user_id


# ---------------------------------------------------------------------------------------------- API harness
@pytest.fixture(scope="session")
async def seeded(sessionmaker: async_sessionmaker[AsyncSession], migrated_database: str) -> dict[str, object]:
    """Courts, the 40 demo advocates and their embeddings, once per run (same code as `make seed`)."""
    from app.modules.parakh.indexing import index_advocates
    from scripts.seed import seed_advocates, seed_courts, seed_news

    from .api_harness import make_providers, settings_for_tests

    settings = settings_for_tests(migrated_database)
    async with sessionmaker() as session:
        async with session.begin():
            court_ids = await seed_courts(session)
            advocate_ids = await seed_advocates(session, court_ids)
            await seed_news(session)
        providers = make_providers(settings, sessionmaker)
        try:
            await index_advocates(providers, session)
        finally:
            await providers.aclose()
    return {"court_ids": court_ids, "advocate_ids": advocate_ids}


@pytest.fixture
async def api(
    sessionmaker: async_sessionmaker[AsyncSession], migrated_database: str, seeded: dict[str, object]
):  # type: ignore[no-untyped-def]
    from .api_harness import api_client, make_providers, new_app, settings_for_tests

    settings = settings_for_tests(migrated_database)
    providers = make_providers(settings, sessionmaker)
    async with api_client(new_app(settings, providers), providers) as client:
        client.providers = providers  # type: ignore[attr-defined]
        yield client
    await providers.aclose()
