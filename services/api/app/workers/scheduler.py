"""The background worker: `uv run python -m app.workers.scheduler` (`pnpm worker`).

A plain asyncio clock instead of a Redis-polled job queue (owner decision for the Upstash free tier, A62): it wakes
at every minute boundary, runs the jobs whose schedule matches, and makes **no Redis request while idle**. A
transaction-scoped Postgres advisory lock per job stops two worker instances from running the same job at once.

With BILLING_RUNNER=worker the billing engine runs here instead of inside the API (needs WS_FANOUT=redis so ticks
reach the sockets).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import signal
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.providers import Providers, build_providers
from app.core.redis import get_redis
from app.db.session import get_sessionmaker
from app.db.tx import transaction

from . import jobs

log = get_logger("scheduler")
JobFn = Callable[[Providers], Awaitable[Any]]


@dataclass(frozen=True, slots=True)
class Job:
    name: str
    fn: JobFn
    minutes: frozenset[int] | None = None  # None = every minute
    hours: frozenset[int] | None = None  # UTC
    weekdays: frozenset[int] | None = None  # Monday = 0

    def due(self, at: datetime) -> bool:
        return (
            (self.minutes is None or at.minute in self.minutes)
            and (self.hours is None or at.hour in self.hours)
            and (self.weekdays is None or at.weekday() in self.weekdays)
        )

    @property
    def lock_key(self) -> int:
        return int.from_bytes(hashlib.sha256(self.name.encode()).digest()[:4], "big")


def schedule() -> list[Job]:
    every = max(1, get_settings().news_refresh_minutes)
    return [
        Job("ingest_news", jobs.ingest_news, minutes=frozenset(range(0, 60, every))),
        Job("expire_bonuses", jobs.expire_bonuses, minutes=frozenset({5})),
        Job("recover_documents", jobs.recover_documents, minutes=frozenset(range(0, 60, 5))),
        Job("purge_expired", jobs.purge_expired, minutes=frozenset({15}), hours=frozenset({21})),  # 02:45 IST
        Job("verify_ledger", jobs.verify_ledger, minutes=frozenset({0}), hours=frozenset({21})),  # 02:30 IST
        Job(
            "compute_praman",
            jobs.compute_praman,
            minutes=frozenset({30}),
            hours=frozenset({22}),
            weekdays=frozenset({6}),
        ),
    ]


async def run_job(providers: Providers, job: Job) -> None:
    try:
        async with providers.sessions() as lock_db, transaction(lock_db):
            got = await lock_db.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": job.lock_key})
            if not got:
                return
            result = await job.fn(providers)
        log.info("job.done", job=job.name, result=result if isinstance(result, int | bool) else None)
    except Exception as exc:  # one failing job never stops the clock
        log.exception("job.failed", job=job.name, error=type(exc).__name__)


async def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    missing = settings.missing_required()
    if missing:
        print("Missing configuration: " + ", ".join(missing), file=sys.stderr)
        return 2
    providers = build_providers(settings, redis=get_redis(), sessions=get_sessionmaker())
    engine = None
    if settings.billing_runner == "worker":
        from app.modules.samvaad.engine import BillingEngine

        engine = BillingEngine(providers)
        engine.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        # Windows has no signal handlers: Ctrl+C raises KeyboardInterrupt instead.
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    table = schedule()
    log.info("scheduler.started", jobs=[j.name for j in table], billing=settings.billing_runner)
    try:
        while not stop.is_set():
            now = datetime.now(UTC)
            wait = 60 - now.second - now.microsecond / 1_000_000
            try:
                await asyncio.wait_for(stop.wait(), timeout=wait)
                break
            except TimeoutError:
                pass
            tick = datetime.now(UTC).replace(second=0, microsecond=0)
            await asyncio.gather(*(run_job(providers, job) for job in table if job.due(tick)))
    finally:
        if engine is not None:
            await engine.stop()
        await providers.aclose()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
