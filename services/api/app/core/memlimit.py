"""Per-instance sliding-window rate limiter: costs no Redis request (owner: Upstash free tier, A62).

Used for every route that doesn't need a limit shared across instances. Abuse-sensitive limits (OTP, match, upload,
top-up) stay in Redis (`ratelimit.py`) so they hold no matter which instance serves the request.
"""

from __future__ import annotations

import math
import time
from collections import deque

from .errors import AppError
from .ratelimit import parse_rule

_MAX_KEYS = 50_000


class MemoryLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str, rule: str, *, now: float | None = None) -> None:
        limit, window = parse_rule(rule)
        now = time.monotonic() if now is None else now
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= _MAX_KEYS:
                self._evict(now, window)
            hits = self._hits[key] = deque()
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            retry = max(1, math.ceil(hits[0] + window - now))
            raise AppError("rate_limited", 429, "Too many requests. Please wait a moment.", retry_after=retry)
        hits.append(now)

    def _evict(self, now: float, window: int) -> None:
        stale = [k for k, v in self._hits.items() if not v or v[-1] <= now - window]
        for key in stale:
            del self._hits[key]
        if len(self._hits) >= _MAX_KEYS:  # still full: drop the oldest half
            for key in list(self._hits)[: _MAX_KEYS // 2]:
                del self._hits[key]


limiter = MemoryLimiter()
