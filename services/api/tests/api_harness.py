"""In-process API for tests: the real app, real Postgres (TEST_DATABASE_URL) and Redis (TEST_REDIS_URL), fake
providers."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import cast
from urllib.parse import urlparse

import httpx
import pytest
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.providers import Providers, build_providers
from app.main import create_app


def settings_for_tests(database_url: str, **overrides: object) -> Settings:
    base = get_settings()
    return base.model_copy(
        update={
            "env": "test",
            "database_url": database_url,
            "cookie_secure": False,  # httpx (unlike browsers) won't send Secure cookies over http://
            "llm_provider": "fake",
            "llm_fallback_provider": "none",
            "embeddings_provider": "fake",
            "payment_provider": "fake",
            "vector_store": "pgvector",
            "rate_limit_otp": "100000/600",
            "rate_limit_match": "100000/60",
            "rate_limit_default": "100000/60",
            "rate_limit_ws": "100000/60",
            **overrides,
        }
    )


@lru_cache
def flushable_redis() -> Redis:
    """The suite flushes this Redis, so it must be a local, explicitly configured one (never Upstash)."""
    url = get_settings().test_redis_url
    if not url:
        pytest.exit("TEST_REDIS_URL is not set (see .env.example)", returncode=2)
    host = urlparse(url).hostname or ""
    if "upstash" in host or url.startswith("rediss://"):
        pytest.exit(f"Refusing to run: TEST_REDIS_URL points at a hosted Redis ({host})", returncode=2)
    if url == get_settings().redis_url:
        pytest.exit("Refusing to run: TEST_REDIS_URL must differ from REDIS_URL", returncode=2)
    return cast(Redis, Redis.from_url(url, decode_responses=True, health_check_interval=0))


def make_providers(settings: Settings, sessions: async_sessionmaker[AsyncSession]) -> Providers:
    return build_providers(settings, redis=flushable_redis(), sessions=sessions)


@asynccontextmanager
async def api_client(app: FastAPI, providers: Providers) -> AsyncIterator[httpx.AsyncClient]:
    app.state.providers = providers  # ASGITransport does not run the lifespan
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


def new_app(settings: Settings, providers: Providers) -> FastAPI:
    return create_app(settings=settings, providers=providers)


def random_phone() -> str:
    return "+919" + str(uuid.uuid4().int)[:9]


async def sign_in(client: httpx.AsyncClient, phone: str | None = None) -> tuple[str, dict[str, object]]:
    phone = phone or random_phone()
    r = await client.post("/v1/auth/otp/request", json={"phone_e164": phone})
    assert r.status_code == 200, r.text
    r = await client.post("/v1/auth/otp/verify", json={"phone_e164": phone, "code": "000000"})
    assert r.status_code == 200, r.text
    body: dict[str, object] = r.json()
    return str(body["access_token"]), body
