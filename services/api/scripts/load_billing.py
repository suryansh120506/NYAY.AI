"""Billing load test (brief §4 step 3.9): N concurrent live sessions for M simulated minutes.

    uv run python -m scripts.load_billing --sessions 500 --minutes 10

Runs ONLY against TEST_DATABASE_URL (name must contain "test") and TEST_REDIS_URL (local; it is flushed), with a fake
clock so ten minutes take seconds. Reports billing wake-up latency (p50/p95/max), Redis requests per session-minute,
and the ledger check (imbalance must be 0, every minute posted exactly once).
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
import uuid
from typing import Any, cast
from urllib.parse import urlparse

from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.providers import build_providers
from app.db.models.enums import TxnKind
from app.db.models.tables import AdvocateProfile, ConsultSession, LedgerTxn, User
from app.db.session import make_engine
from app.ledger import operations, verify
from app.ledger.posting import ensure_wallet
from app.modules.samvaad.engine import BillingEngine

T0 = 1_800_000_000_000


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> int:
        return self.now


def _guard(db_url: str, redis_url: str) -> None:
    name = (urlparse(db_url.replace("+asyncpg", "")).path or "").lstrip("/")
    if "test" not in name:
        sys.exit(f"Refusing: TEST_DATABASE_URL database {name!r} does not contain 'test'")
    host = urlparse(redis_url).hostname or ""
    if not redis_url or "upstash" in host or redis_url.startswith("rediss://"):
        sys.exit("Refusing: TEST_REDIS_URL must be a local Redis (it is flushed)")


async def main(sessions: int, minutes: int) -> int:
    base = get_settings()
    configure_logging("WARNING")
    _guard(base.test_database_url, base.test_redis_url)
    pool = 20
    settings = base.model_copy(
        update={"database_url": base.test_database_url, "db_pool_size": pool, "env": "test"}
    )
    engine = make_engine(settings.database_url, pool_size=pool, max_overflow=5)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    redis = cast(Redis, Redis.from_url(base.test_redis_url, decode_responses=True, health_check_interval=0))
    await redis.flushdb()
    providers = build_providers(settings, redis=redis, sessions=sm)
    clock = Clock()
    providers.clock = clock
    service = providers.samvaad

    print(f"Setting up {sessions} users, advocates and live sessions...")
    setup = time.perf_counter()
    ids: list[uuid.UUID] = []
    async with sm() as db:
        # Settle anything an earlier run left open.
        stale = (
            await db.scalars(
                select(ConsultSession.id).where(ConsultSession.state.in_(("RESERVED", "LIVE", "ENDING")))
            )
        ).all()
        await db.commit()
    for sid in stale:
        await service.finalize(sid, "timeout")
    for i in range(sessions):
        async with sm() as db, db.begin():
            uid, aid = uuid.uuid4(), uuid.uuid4()
            for user_id, role in ((uid, "user"), (aid, "advocate")):
                await db.execute(
                    text("INSERT INTO users (id, phone_e164, role) VALUES (:id, :p, :r)"),
                    {"id": user_id, "p": "+917" + str(uuid.uuid4().int)[:9], "r": role},
                )
                await ensure_wallet(db, user_id)
            db.add(
                AdvocateProfile(
                    user_id=aid,
                    enrolment_no=f"LOAD/{aid.hex[:12]}",
                    state_bar_council="Load Test",
                    verification_status="verified",
                    rate_paise_per_min=1000 + (i % 20) * 100,
                )
            )
            await operations.topup(db, user_id=uid, amount=100_000, idempotency_key=f"load:{uid}")
        async with sm() as db:
            user = await db.get(User, uid)
            assert user is not None
            await db.commit()
            s = await service.reserve(db, user, advocate_id=aid, match_id=None, document_id=None)
            await service.touch(s.id, "user", delta=1)
            await service.touch(s.id, "advocate", delta=1)
            await service.start(db, user, s.id, keep_transcript=False, share_summary=False)
        ids.append(s.id)
    print(f"  ready in {time.perf_counter() - setup:.1f}s")

    sent: list[str] = []
    original = redis.execute_command

    async def counting(*args: Any, **kwargs: Any) -> Any:
        sent.append(str(args[0]))
        return await original(*args, **kwargs)  # type: ignore[no-untyped-call]

    redis.execute_command = counting  # type: ignore[method-assign]
    billing = BillingEngine(providers)
    latencies = []
    for _ in range(minutes):
        clock.now += 60_000
        async with sm() as db, db.begin():
            # Heartbeats (what connected sockets do): Postgres only.
            await db.execute(
                text(
                    "UPDATE sessions SET user_last_seen_at = to_timestamp(:t / 1000.0),"
                    " advocate_last_seen_at = to_timestamp(:t / 1000.0) WHERE id = ANY(:ids)"
                ),
                {"t": clock.now, "ids": ids},
            )
        started = time.perf_counter()
        await billing.tick()
        latencies.append(time.perf_counter() - started)
    billing_requests = len(sent)
    redis.execute_command = original  # type: ignore[method-assign]

    clock.now += 30_000
    for sid in ids:
        await service.finalize(sid, "user_ended")

    async with sm() as db:
        posted = await db.scalar(
            select(func.count())
            .select_from(LedgerTxn)
            .where(LedgerTxn.session_id.in_(ids), LedgerTxn.kind == TxnKind.MINUTE_DEBIT)
        )
        billed = await db.scalar(
            select(func.sum(ConsultSession.billed_minutes)).where(ConsultSession.id.in_(ids))
        )
        health = await verify.check(db)
    latencies.sort()
    p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)]
    print(
        f"\n{sessions} sessions x {minutes} minutes\n"
        f"  billing wake-up latency: p50 {statistics.median(latencies):.2f}s, p95 {p95:.2f}s, max {latencies[-1]:.2f}s"
        f" (budget: {settings.billing_poll_seconds}s)\n"
        f"  Redis requests during billing: {billing_requests}"
        f" = {billing_requests / (sessions * minutes):.2f} per session-minute\n"
        f"  minute debits posted {posted} / metered {billed} (drift {int(billed or 0) - int(posted or 0)})\n"
        f"  ledger imbalance {health.imbalance}, unbalanced txns {health.unbalanced_txns}, wallet drift {len(health.drift)}"
    )
    await providers.aclose()
    await engine.dispose()
    ok = health.ok and posted == billed and p95 < settings.billing_poll_seconds
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", type=int, default=500)
    parser.add_argument("--minutes", type=int, default=10)
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.sessions, args.minutes)))
