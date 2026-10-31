"""Sliding-window rate limiting in Redis (brief §1.4): key `rl:{scope}:{id}` is a ZSET of request timestamps."""

from __future__ import annotations

import time
import uuid

from redis.asyncio import Redis

from .errors import AppError

# One atomic round trip: trim the window, count, and only record the hit if under the limit.
_SCRIPT = """
local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, math.ceil((tonumber(oldest[2]) + window - now) / 1000)}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
"""


def parse_rule(rule: str) -> tuple[int, int]:
    """'5/600' → (5 requests, 600 seconds)."""
    count, seconds = rule.split("/", 1)
    return int(count), int(seconds)


async def enforce(redis: Redis, *, scope: str, identity: str, rule: str) -> None:
    limit, seconds = parse_rule(rule)
    now_ms = int(time.time() * 1000)
    allowed, retry_after = await redis.eval(  # type: ignore[misc]
        _SCRIPT,
        1,
        f"rl:{scope}:{identity}",
        str(now_ms),
        str(seconds * 1000),
        str(limit),
        f"{now_ms}-{uuid.uuid4().hex[:8]}",
    )
    if not int(allowed):
        raise AppError(
            "rate_limited", 429, "Too many requests. Please wait a moment.", retry_after=int(retry_after)
        )
