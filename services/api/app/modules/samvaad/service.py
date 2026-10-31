"""Samvaad session lifecycle (brief §1.3): reserve → start → LIVE (per-minute billing) → ENDING → SETTLED.

Postgres is the system of record (sessions, holds, ledger); Redis only meters minutes (`meter.py`). Every state
change happens under `SELECT … FOR UPDATE` on the session row, so the user ending the call, the advocate ending it,
the wallet running out and a heartbeat timeout can race freely: exactly one of them settles the session.

Settlement (owner decision, A60) is one final trigger: freeze the meter, post any minute it billed that Postgres
hasn't recorded yet, prorate to the second, refund the unused part of the prepaid minutes, release the hold (bonus
part back to bonus) and mark the session SETTLED, all in one database transaction.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.models.enums import ConsentPurpose, SessionState, VerificationStatus
from app.db.models.tables import AdvocateProfile, Consent, ConsultSession, Document, Message, User, Wallet
from app.db.tx import transaction
from app.ledger import operations
from app.ledger.posting import InsufficientFunds, ensure_wallet

from . import meter
from .billing import Rates, prorate, rates_for, release_split, remaining_seconds
from .hub import Party

if TYPE_CHECKING:
    from app.core.providers import Providers

log = get_logger("samvaad")

OPEN = (SessionState.RESERVED, SessionState.LIVE, SessionState.ENDING)
TERMINAL = (SessionState.SETTLED, SessionState.CANCELLED)
CHAT_POLICY_VERSION = "chat-2026-10"  # TODO(human): version string of the reviewed chat-storage notice
LOCK_TTL_MS = 24 * 3600 * 1000
CLOSE_WALLET_EMPTY = 4402
CLOSE_SESSION_OVER = 4410


def to_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def from_ms(value: int) -> datetime:
    return datetime.fromtimestamp(value / 1000, tz=UTC)


@dataclass(frozen=True, slots=True)
class BillOutcome:
    exhausted: bool
    paid_until_ms: int


def rates_of(s: ConsultSession) -> Rates:
    return Rates(int(s.adv_rate_paise), int(s.plat_rate_paise), int(s.gst_rate_paise))


class SamvaadService:
    def __init__(self, providers: Providers) -> None:
        self.p = providers
        self.settings = providers.settings
        self.redis = providers.redis
        self.hub = providers.hub
        self._timers: dict[str, asyncio.TimerHandle] = {}
        self._tasks: set[asyncio.Task[Any]] = set()

    # ------------------------------------------------------------------------------------------- helpers
    def now_ms(self) -> int:
        return self.p.clock()

    @property
    def horizon_ms(self) -> int:
        """Bill every minute that starts before the next billing wake-up (+ lead for jitter): minutes stay prepaid
        with a single Redis call per wake-up."""
        return (self.settings.billing_poll_seconds + self.settings.billing_lead_seconds) * 1000

    def spawn(self, coro: Any) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _locked(self, db: AsyncSession, session_id: uuid.UUID) -> ConsultSession | None:
        return await db.scalar(
            select(ConsultSession).where(ConsultSession.id == session_id).with_for_update()
        )

    async def for_party(
        self, db: AsyncSession, session_id: uuid.UUID, user: User
    ) -> tuple[ConsultSession, Party]:
        s = await db.get(ConsultSession, session_id)
        if s is None:
            raise AppError("not_found", 404)
        if s.user_id == user.id:
            return s, "user"
        if s.advocate_id == user.id:
            return s, "advocate"
        raise AppError("not_found", 404)

    def online(self, s: ConsultSession, party: Party) -> bool:
        conns = s.user_conns if party == "user" else s.advocate_conns
        seen = s.user_last_seen_at if party == "user" else s.advocate_last_seen_at
        if conns <= 0 or seen is None:
            return False
        return self.now_ms() - to_ms(seen) <= self.settings.heartbeat_timeout_seconds * 1000

    # ------------------------------------------------------------------------------------------- reserve
    async def reserve(
        self,
        db: AsyncSession,
        user: User,
        *,
        advocate_id: uuid.UUID,
        match_id: uuid.UUID | None,
        document_id: uuid.UUID | None,
    ) -> ConsultSession:
        settings = self.settings
        await self.cancel_expired_reservations(db, user_id=user.id)
        advocate = await db.scalar(
            select(AdvocateProfile).where(
                AdvocateProfile.user_id == advocate_id,
                AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
            )
        )
        if advocate is None or advocate.user_id == user.id:
            raise AppError("not_found", 404, "This advocate is not available.")
        if document_id is not None and not await self._owns_document(db, user.id, document_id):
            document_id = None
        rates = rates_for(
            int(advocate.rate_paise_per_min), settings.platform_fee_paise_per_min, settings.gst_rate_bps
        )
        required = rates.cost * settings.reserve_minutes
        try:
            async with transaction(db):
                await ensure_wallet(db, user.id)
                wallet = (
                    await db.execute(select(Wallet).where(Wallet.user_id == user.id).with_for_update())
                ).scalar_one()
                existing = await db.scalar(
                    select(ConsultSession.id).where(
                        ConsultSession.user_id == user.id, ConsultSession.state.in_(OPEN)
                    )
                )
                if existing is not None:
                    raise AppError(
                        "session_exists",
                        409,
                        "You already have a consultation open.",
                        session_id=str(existing),
                    )
                spendable = int(wallet.available_paise) + int(wallet.bonus_paise)
                if spendable < required:
                    raise AppError(
                        "insufficient_funds",
                        402,
                        "Add money to your wallet to start this consultation.",
                        required_paise=required,
                        available_paise=spendable,
                    )
                split = operations.split_for_hold(
                    wallet, min(spendable, max(settings.reserve_cap_paise, required))
                )
                s = ConsultSession(
                    user_id=user.id,
                    advocate_id=advocate.user_id,
                    adv_rate_paise=rates.adv,
                    plat_rate_paise=rates.plat,
                    gst_rate_paise=rates.gst,
                    held_paise=split.total,
                    held_bonus_paise=split.from_bonus,
                    match_id=match_id,
                    document_id=document_id,
                )
                db.add(s)
                await db.flush()
                await operations.reserve(
                    db, user_id=user.id, split=split, idempotency_key=f"sess:{s.id}:reserve", session_id=s.id
                )
        except IntegrityError as exc:  # the partial unique index caught a concurrent reserve (invariant (a))
            raise AppError("session_exists", 409, "You already have a consultation open.") from exc
        log.info("samvaad.reserved", session_id=str(s.id), held_paise=s.held_paise)
        return s

    async def _owns_document(self, db: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID) -> bool:
        owner = await db.scalar(select(Document.user_id).where(Document.id == document_id))
        return owner == user_id

    async def attach_document(
        self, db: AsyncSession, user: User, session_id: uuid.UUID, document_id: uuid.UUID
    ) -> ConsultSession:
        if not await self._owns_document(db, user.id, document_id):
            raise AppError("not_found", 404)
        async with transaction(db):
            s = await self._locked(db, session_id)
            if s is None or s.user_id != user.id or s.state in TERMINAL:
                raise AppError("not_found", 404)
            s.document_id = document_id
        return s

    # --------------------------------------------------------------------------------------------- start
    async def start(
        self,
        db: AsyncSession,
        user: User,
        session_id: uuid.UUID,
        *,
        keep_transcript: bool,
        share_summary: bool,
    ) -> ConsultSession:
        async with transaction(db):
            s = await self._locked(db, session_id)
            if s is None or s.user_id != user.id:
                raise AppError("not_found", 404)
            if s.state != SessionState.RESERVED:
                return s
            db.add(
                Consent(
                    user_id=user.id,
                    purpose=ConsentPurpose.CHAT_STORAGE,
                    granted=True,
                    policy_version=CHAT_POLICY_VERSION,
                )
            )
            if keep_transcript:
                db.add(
                    Consent(
                        user_id=user.id,
                        purpose=ConsentPurpose.DATA_RETENTION_EXTENDED,
                        granted=True,
                        policy_version=CHAT_POLICY_VERSION,
                    )
                )
            s.user_ready_at = from_ms(self.now_ms())
            s.keep_transcript = keep_transcript
            s.share_summary = share_summary and s.document_id is not None
        await self.maybe_go_live(session_id)
        refreshed = await db.get(ConsultSession, session_id, populate_existing=True)
        assert refreshed is not None
        return refreshed

    async def maybe_go_live(self, session_id: uuid.UUID) -> bool:
        """LIVE once the user has started and both parties are connected; minute 1 is debited at that moment."""
        async with self.p.sessions() as db:
            async with transaction(db):
                s = await self._locked(db, session_id)
                if s is None or s.state != SessionState.RESERVED or s.user_ready_at is None:
                    return False
                if not (self.online(s, "user") and self.online(s, "advocate")):
                    return False
                now = self.now_ms()
                result = await self._meter_start(s, started_ms=now, now=now)
                if not result.billed:
                    log.error("samvaad.start_refused", session_id=str(s.id), status=result.status)
                    return False
                s.state = SessionState.LIVE
                s.started_at = from_ms(result.paid_until_ms - result.minute_idx * meter.MINUTE_MS)
                await self._post_minutes(db, s, result.minute_idx)
                wallet = await db.get(Wallet, s.user_id)
                tick = self._tick_event(s, result.remaining, wallet, now)
            started = {"type": "session.started", "started_at": s.started_at.isoformat()}
        await self.hub.publish(str(session_id), started)
        await self.hub.publish(str(session_id), tick, to="user")
        await self.hub.publish(str(session_id), self._advocate_tick(s), to="advocate")
        log.info("samvaad.live", session_id=str(session_id))
        return True

    async def _meter_start(
        self, s: ConsultSession, *, started_ms: int, now: int, retry: bool = True
    ) -> meter.BillResult:
        result = await meter.start(
            self.redis,
            session_id=str(s.id),
            user_id=str(s.user_id),
            held=int(s.held_paise),
            adv=int(s.adv_rate_paise),
            plat=int(s.plat_rate_paise),
            gst=int(s.gst_rate_paise),
            started_ms=started_ms,
            minute_idx=int(s.billed_minutes),
            now=now,
            horizon_ms=self.horizon_ms,
            lock_ttl_ms=LOCK_TTL_MS,
        )
        if result.status == "LOCKED" and retry:
            # A lock left behind by a session that Postgres has already closed (e.g. Redis outlived a crash).
            async with self.p.sessions() as other:
                holder_state = await other.scalar(
                    select(ConsultSession.state).where(ConsultSession.id == uuid.UUID(result.holder))
                )
            if holder_state is None or holder_state in TERMINAL:
                await meter.cleanup(self.redis, session_id=result.holder, user_id=str(s.user_id))
                return await self._meter_start(s, started_ms=started_ms, now=now, retry=False)
        return result

    async def _post_minutes(self, db: AsyncSession, s: ConsultSession, upto: int) -> None:
        """Record in the ledger every minute the meter billed. Idempotent (`sess:{id}:min:{n}`), so re-running after a
        crash between the Redis call and the commit posts exactly the missing minutes."""
        for n in range(int(s.billed_minutes) + 1, upto + 1):
            try:
                await operations.minute_debit(
                    db,
                    user_id=s.user_id,
                    advocate_id=s.advocate_id,
                    adv_paise=int(s.adv_rate_paise),
                    plat_paise=int(s.plat_rate_paise),
                    gst_paise=int(s.gst_rate_paise),
                    idempotency_key=f"sess:{s.id}:min:{n}",
                    session_id=s.id,
                )
            except InsufficientFunds:
                # Can't happen while the meter's hold mirrors Postgres; stop rather than overdraw.
                log.error("samvaad.minute_overdraft", session_id=str(s.id), minute=n)
                break
            s.billed_minutes = n

    # --------------------------------------------------------------------------------------------- ticks
    def _tick_event(
        self, s: ConsultSession, hold_left: int, wallet: Wallet | None, now: int
    ) -> dict[str, Any]:
        """`balance_paise` = what the user can still spend here: the rest of the hold plus wallet money that can extend
        it (A15)."""
        extra = int(wallet.available_paise) + int(wallet.bonus_paise) if wallet else 0
        spendable = max(0, hold_left) + extra
        started = to_ms(s.started_at) if s.started_at else now
        rates = rates_of(s)
        return {
            "type": "session.tick",
            "minute": int(s.billed_minutes),
            "balance_paise": spendable,
            "remaining_seconds": remaining_seconds(
                started_ms=started,
                billed_minutes=int(s.billed_minutes),
                spendable=spendable,
                cost=rates.cost,
                now_ms=now,
            ),
        }

    def _advocate_tick(self, s: ConsultSession) -> dict[str, Any]:
        """The advocate sees minutes, never the client's wallet."""
        return {
            "type": "session.tick",
            "minute": int(s.billed_minutes),
            "balance_paise": 0,
            "remaining_seconds": 0,
        }

    def hold_left(self, s: ConsultSession) -> int:
        return int(s.held_paise) - int(s.billed_minutes) * rates_of(s).cost

    async def snapshot_events(self, s: ConsultSession, party: Party) -> list[dict[str, Any]]:
        """What a freshly connected socket needs to render the room."""
        other: Party = "advocate" if party == "user" else "user"
        events: list[dict[str, Any]] = [{"type": "presence", "party": other, "online": self.online(s, other)}]
        if s.state == SessionState.LIVE and s.started_at is not None:
            events.append({"type": "session.started", "started_at": s.started_at.isoformat()})
            if party == "user":
                async with self.p.sessions() as db:
                    wallet = await db.get(Wallet, s.user_id)
                tick = self._tick_event(s, self.hold_left(s), wallet, self.now_ms())
                events.append(tick)
                if tick["balance_paise"] <= 2 * rates_of(s).cost:
                    events.append({"type": "session.warning", "seconds_left": tick["remaining_seconds"]})
            else:
                events.append(self._advocate_tick(s))
        return events

    async def bill(
        self, session_id: uuid.UUID, *, now: int | None = None, force: bool = False, schedule: bool = True
    ) -> BillOutcome | None:
        """One billing step for a LIVE session: extend the hold if it is running low, then one Redis call that
        debits every minute due before the next wake-up, then post those minutes. `force` calls Redis even when no
        minute is due (used after a top-up to re-open an exhausted meter)."""
        now = self.now_ms() if now is None else now
        async with self.p.sessions() as db:
            async with transaction(db):
                s = await self._locked(db, session_id)
                if s is None or s.state != SessionState.LIVE or s.started_at is None:
                    return None
                started = to_ms(s.started_at)
                target = (now + self.horizon_ms - started) // meter.MINUTE_MS + 1
                if target <= s.billed_minutes and not force:
                    return None
                rates = rates_of(s)
                wallet = (
                    await db.execute(select(Wallet).where(Wallet.user_id == s.user_id).with_for_update())
                ).scalar_one()
                due_cost = max(0, target - int(s.billed_minutes)) * rates.cost
                if self.hold_left(s) - due_cost <= 2 * rates.cost:
                    await self._extend_hold(db, s, wallet)
                result = await meter.bill(
                    self.redis,
                    session_id=str(s.id),
                    user_id=str(s.user_id),
                    now=now,
                    horizon_ms=self.horizon_ms,
                    held=int(s.held_paise),
                )
                if result.status in ("NO_METER", "OTHER_SESSION"):
                    # Redis lost the meter (flush, failover, eviction): rebuild it from Postgres and carry on.
                    log.warning("samvaad.meter_rebuilt", session_id=str(s.id))
                    result = await self._meter_start(s, started_ms=started, now=now)
                if not result.billed:
                    return None
                await self._post_minutes(db, s, result.minute_idx)
                await db.refresh(wallet)
                tick = self._tick_event(s, self.hold_left(s), wallet, now)
                low = tick["balance_paise"] <= 2 * rates.cost
                exhausted = result.status == "INSUFFICIENT"
                paid_until = started + int(s.billed_minutes) * meter.MINUTE_MS
            await self.hub.publish(str(session_id), tick, to="user")
            await self.hub.publish(str(session_id), self._advocate_tick(s), to="advocate")
            if result.warn_now and low:
                await self.hub.publish(
                    str(session_id),
                    {"type": "session.warning", "seconds_left": tick["remaining_seconds"]},
                    to="user",
                )
            if schedule:
                if exhausted:
                    self.schedule_end(session_id, paid_until, "wallet_empty")
                else:
                    self.cancel_timer(session_id)
            return BillOutcome(exhausted=exhausted, paid_until_ms=paid_until)

    async def _extend_hold(
        self, db: AsyncSession, s: ConsultSession, wallet: Wallet, amount: int | None = None
    ) -> int:
        """A16: move wallet money into the hold (bonus first), the same path a mid-call top-up uses."""
        spendable = int(wallet.available_paise) + int(wallet.bonus_paise)
        want = min(spendable, amount if amount is not None else self.settings.reserve_cap_paise)
        if want <= 0:
            return 0
        split = operations.split_for_hold(wallet, want)
        await operations.reserve(
            db,
            user_id=s.user_id,
            split=split,
            idempotency_key=f"sess:{s.id}:hold:{s.held_paise}",
            session_id=s.id,
        )
        s.held_paise = int(s.held_paise) + split.total
        s.held_bonus_paise = int(s.held_bonus_paise) + split.from_bonus
        await db.refresh(wallet)
        return split.total

    async def on_topup(self, user_id: uuid.UUID) -> None:
        """Called after a captured top-up (brief §1.3 step 6): raise the live session's hold and re-open the meter."""
        async with self.p.sessions() as db:
            session_id = await db.scalar(
                select(ConsultSession.id).where(
                    ConsultSession.user_id == user_id, ConsultSession.state == SessionState.LIVE
                )
            )
            if session_id is None:
                return
            async with transaction(db):
                s = await self._locked(db, session_id)
                if s is None or s.state != SessionState.LIVE:
                    return
                wallet = (
                    await db.execute(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
                ).scalar_one()
                await self._extend_hold(db, s, wallet)
        await self.bill(session_id, force=True)

    # ------------------------------------------------------------------------------------------ timers
    def schedule_end(self, session_id: uuid.UUID, at_ms: int, reason: str) -> None:
        """End exactly at the paid-through boundary, independent of the (once a minute) billing wake-up."""
        self.cancel_timer(session_id)
        delay = max(0.0, (at_ms - self.now_ms()) / 1000)
        loop = asyncio.get_running_loop()
        self._timers[str(session_id)] = loop.call_later(
            delay, lambda: self.spawn(self._end_if_still_exhausted(session_id, at_ms, reason))
        )

    def cancel_timer(self, session_id: uuid.UUID) -> None:
        timer = self._timers.pop(str(session_id), None)
        if timer is not None:
            timer.cancel()

    async def _end_if_still_exhausted(self, session_id: uuid.UUID, at_ms: int, reason: str) -> None:
        self._timers.pop(str(session_id), None)
        # A top-up may have arrived in the meantime: one more billing call re-opens the meter if it can.
        outcome = await self.bill(session_id, force=True, schedule=False)
        if outcome is None or not outcome.exhausted:
            return
        if outcome.paid_until_ms <= self.now_ms():
            await self.finalize(session_id, reason, end_ms=outcome.paid_until_ms)
        else:
            self.schedule_end(session_id, outcome.paid_until_ms, reason)

    # ---------------------------------------------------------------------------------------- settlement
    async def finalize(
        self, session_id: uuid.UUID, reason: str, *, end_ms: int | None = None
    ) -> ConsultSession | None:
        """The one final trigger (A60). Idempotent: a settled session is returned unchanged."""
        self.cancel_timer(session_id)
        async with self.p.sessions() as db, transaction(db):
            s = await self._locked(db, session_id)
            if s is None or s.state in TERMINAL:
                return s
            now = self.now_ms()
            if s.state == SessionState.RESERVED or s.started_at is None:
                await self._release(db, s, net_spent=0)
                s.state = SessionState.CANCELLED
                s.ended_at = from_ms(now)
                s.end_reason = reason
                s.used_seconds = 0
                cancelled = True
            else:
                cancelled = False
                s.state = SessionState.ENDING
                snapshot = meter.Snapshot(found=False)
                try:
                    snapshot = await meter.freeze(self.redis, session_id=str(s.id), user_id=str(s.user_id))
                except (
                    Exception
                ) as exc:  # Redis down: minutes it billed but Postgres never saw are not charged
                    log.warning("samvaad.freeze_failed", session_id=str(s.id), error=type(exc).__name__)
                if snapshot.found:
                    await self._post_minutes(db, s, snapshot.minute_idx)
                started = to_ms(s.started_at)
                end = min(end_ms if end_ms is not None else now, now)
                end = min(end, started + int(s.billed_minutes) * meter.MINUTE_MS)
                used = max(0, (end - started) // 1000)
                pr = prorate(rates_of(s), billed_minutes=int(s.billed_minutes), used_seconds=used)
                if pr.refund_total > 0:
                    await operations.refund_minutes(
                        db,
                        user_id=s.user_id,
                        advocate_id=s.advocate_id,
                        adv_paise=pr.refund.adv,
                        plat_paise=pr.refund.plat,
                        gst_paise=pr.refund.gst,
                        idempotency_key=f"sess:{s.id}:refund",
                        session_id=s.id,
                    )
                await self._release(db, s, net_spent=pr.due.cost)
                s.state = SessionState.SETTLED
                s.used_seconds = pr.used_seconds
                s.refunded_paise = pr.refund_total
                s.ended_at = from_ms(max(end, started))
                s.end_reason = reason
                retention = (
                    None if s.keep_transcript else s.ended_at + timedelta(days=self.settings.retention_days)
                )
                await db.execute(
                    update(Message).where(Message.session_id == s.id).values(delete_after=retention)
                )
        if not cancelled:
            try:
                await meter.cleanup(self.redis, session_id=str(s.id), user_id=str(s.user_id))
            except Exception as exc:  # the lock expires on its own; a stale one is cleared on the next start
                log.warning("samvaad.cleanup_failed", session_id=str(s.id), error=type(exc).__name__)
        code = CLOSE_WALLET_EMPTY if reason == "wallet_empty" else CLOSE_SESSION_OVER
        await self.hub.publish(
            str(session_id), {"type": "session.terminated", "reason": reason}, close=(code, reason)
        )
        log.info(
            "samvaad.settled" if not cancelled else "samvaad.cancelled",
            session_id=str(session_id),
            reason=reason,
            billed_minutes=s.billed_minutes,
            used_seconds=s.used_seconds,
            refunded_paise=s.refunded_paise,
        )
        return s

    async def _release(self, db: AsyncSession, s: ConsultSession, *, net_spent: int) -> None:
        split = release_split(held=int(s.held_paise), held_bonus=int(s.held_bonus_paise), net_spent=net_spent)
        if split.total > 0:
            await operations.release(
                db,
                user_id=s.user_id,
                to_available=split.to_available,
                to_bonus=split.to_bonus,
                idempotency_key=f"sess:{s.id}:release",
                session_id=s.id,
            )

    async def end(self, db: AsyncSession, user: User, session_id: uuid.UUID) -> ConsultSession:
        _, party = await self.for_party(db, session_id, user)
        await db.commit()
        settled = await self.finalize(session_id, "user_ended" if party == "user" else "advocate_ended")
        assert settled is not None
        return settled

    async def cancel_expired_reservations(self, db: AsyncSession, *, user_id: uuid.UUID | None = None) -> int:
        cutoff = from_ms(self.now_ms()) - timedelta(minutes=self.settings.reservation_ttl_minutes)
        stmt = select(ConsultSession.id).where(
            ConsultSession.state == SessionState.RESERVED, ConsultSession.requested_at < cutoff
        )
        if user_id is not None:
            stmt = stmt.where(ConsultSession.user_id == user_id)
        ids = (await db.scalars(stmt)).all()
        await db.commit()
        for session_id in ids:
            await self.finalize(session_id, "timeout")
        return len(ids)

    # ------------------------------------------------------------------------------------------ presence
    async def touch(self, session_id: uuid.UUID, party: Party, *, delta: int = 0) -> ConsultSession | None:
        """Record a sign of life (and a connect/disconnect when delta = ±1). Postgres only: no Redis cost."""
        now = from_ms(self.now_ms())
        conns = ConsultSession.user_conns if party == "user" else ConsultSession.advocate_conns
        seen = ConsultSession.user_last_seen_at if party == "user" else ConsultSession.advocate_last_seen_at
        async with self.p.sessions() as db:
            async with transaction(db):
                await db.execute(
                    update(ConsultSession)
                    .where(ConsultSession.id == session_id)
                    .values({conns: func.greatest(0, conns + delta), seen: now})
                )
            return await db.get(ConsultSession, session_id)

    async def check_presence_timeout(self, session_id: uuid.UUID) -> bool:
        """Brief §1.3 step 8: a party gone longer than HEARTBEAT_TIMEOUT ends the session, billed only up to the
        moment they were last seen plus the timeout."""
        timeout_ms = self.settings.heartbeat_timeout_seconds * 1000
        async with self.p.sessions() as db:
            s = await db.get(ConsultSession, session_id)
            if s is None or s.state != SessionState.LIVE:
                return False
            now = self.now_ms()
            parties: tuple[Party, ...] = ("user", "advocate")
            for party in parties:
                seen = s.user_last_seen_at if party == "user" else s.advocate_last_seen_at
                if seen is None or now - to_ms(seen) <= timeout_ms:
                    continue
                reason = "timeout" if party == "user" else "advocate_ended"
                await db.commit()
                await self.finalize(session_id, reason, end_ms=to_ms(seen) + timeout_ms)
                return True
        return False

    # ------------------------------------------------------------------------------------------ messages
    async def post_message(
        self, session_id: uuid.UUID, sender_id: uuid.UUID, client_msg_id: str, text: str
    ) -> tuple[Message, bool]:
        """Idempotent per client_msg_id; seq comes from `UPDATE sessions … RETURNING` so it is strictly increasing even
        with several API instances. Returns (message, created)."""
        async with self.p.sessions() as db:
            async with transaction(db):
                existing = await db.scalar(
                    select(Message).where(
                        Message.session_id == session_id, Message.client_msg_id == client_msg_id
                    )
                )
                if existing is not None:
                    return existing, False
                seq = await db.scalar(
                    update(ConsultSession)
                    .where(ConsultSession.id == session_id, ConsultSession.state == SessionState.LIVE)
                    .values(last_seq=ConsultSession.last_seq + 1)
                    .returning(ConsultSession.last_seq)
                )
                if seq is None:
                    raise AppError("not_live", 409)
                message = Message(
                    session_id=session_id,
                    seq=seq,
                    sender_id=sender_id,
                    client_msg_id=client_msg_id,
                    body=text,
                )
                db.add(message)
                await db.flush()
                await db.refresh(message)
            return message, True

    async def messages_after(self, session_id: uuid.UUID, last_seq: int, limit: int = 500) -> list[Message]:
        async with self.p.sessions() as db:
            return list(
                (
                    await db.scalars(
                        select(Message)
                        .where(Message.session_id == session_id, Message.seq > last_seq)
                        .order_by(Message.seq)
                        .limit(limit)
                    )
                ).all()
            )

    async def aclose(self) -> None:
        for timer in self._timers.values():
            timer.cancel()
        self._timers.clear()
        for task in list(self._tasks):
            task.cancel()
