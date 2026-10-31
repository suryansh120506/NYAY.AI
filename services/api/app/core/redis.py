"""Redis client (Upstash in production). Real-time state only: losing Redis must never lose or create money."""

from __future__ import annotations

from functools import lru_cache
from typing import cast

from redis.asyncio import Redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> Redis:
    url = get_settings().redis_url
    if not url:
        raise RuntimeError("REDIS_URL is not set (see .env.example)")
    # rediss:// (TLS) works for Upstash with no extra options.
    return cast(Redis, Redis.from_url(url, decode_responses=True, health_check_interval=0, socket_timeout=5))
