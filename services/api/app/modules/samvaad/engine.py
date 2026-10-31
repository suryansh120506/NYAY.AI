"""The billing engine: one wake-up every BILLING_POLL_SECONDS (default 60, owner decision for the Upstash free tier).

Each wake-up:
  1. takes a transaction-scoped Postgres advisory lock, so with several API instances exactly one bills (works
     through Supabase's transaction pooler; costs no Redis request);
  2. reads the open sessions from Postgres. **No open session → no Redis request at all**;
  3. cancels reservations older than RESERVATION_TTL_MINUTES and settles sessions whose party has been gone longer
     than HEARTBEAT_TIMEOUT_SECONDS (both Postgres-only);
  4. for each LIVE session whose next minute starts before the following wake-up (+ lead), makes ONE Redis call that
     debits those minutes, then posts them to the ledger;
  5. re-runs the final settlement for anything stuck in ENDING (a crash mid-settlement).

Wallet-empty endings don't wait for a wake-up: `SamvaadService.schedule_end` fires at the exact paid-through moment.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Row, select, text

from app.core.logging import get_logger
from app.core.metrics import BILLING_TICK_SECONDS
from app.db.models.enums import SessionState
from app.db.models.tables import ConsultSession
from app.db.tx import transaction

from . import meter
from .service import OPEN, to_ms

if TYPE_CHECKING:
    from app.core.providers import Providers

log = get_logger("samvaad.engine")
ADVISORY_LOCK_KEY = 0x6E796179  # "nyay"


class BillingEngine:
    def __init__(self, providers: Providers) -> None:
        self.p = providers
        self.service = providers.samvaad
        self.settings = providers.settings
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="billing-engine")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        period = self.settings.billing_poll_seconds
        while True:
            started = time.monotonic()
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never let one bad tick stop billing
                log.exception("billing.tick_failed", error=type(exc).__name__)
            await asyncio.sleep(max(1.0, period - (time.monotonic() - started)))

    async def tick(self, now: int | None = None) -> int:
        """One wake-up. Returns how many Redis billing calls it made (0 when nothing is live)."""
        now = self.p.clock() if now is None else now
        started = time.perf_counter()
        async with self.p.sessions() as lock_db, transaction(lock_db):
            got = await lock_db.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
            if not got:
                return 0  # another instance is billing this wake-up
            rows = (
                await lock_db.execute(
                    select(
                        ConsultSession.id,
                        ConsultSession.state,
                        ConsultSession.started_at,
                        ConsultSession.billed_minutes,
                        ConsultSession.requested_at,
                    ).where(ConsultSession.state.in_(OPEN))
                )
            ).all()
            if not rows:
                return 0
            async with self.p.sessions() as db:
                await self.service.cancel_expired_reservations(db)
            horizon = self.service.horizon_ms
            # Sessions are independent (one row lock each), so bill them concurrently, bounded by the DB pool.
            limit = asyncio.Semaphore(max(1, self.settings.db_pool_size - 1))

            async def one(row: Row[uuid.UUID, SessionState, datetime | None, int, datetime]) -> int:
                async with limit:
                    if row.state == SessionState.ENDING:
                        await self.service.finalize(row.id, "timeout")
                        return 0
                    if row.state != SessionState.LIVE or row.started_at is None:
                        return 0
                    if await self.service.check_presence_timeout(row.id):
                        return 0
                    target = (now + horizon - to_ms(row.started_at)) // meter.MINUTE_MS + 1
                    if target <= row.billed_minutes:
                        return 0
                    await self.service.bill(row.id, now=now)
                    return 1

            calls = sum(await asyncio.gather(*(one(row) for row in rows)))
        BILLING_TICK_SECONDS.observe(time.perf_counter() - started)
        return calls
