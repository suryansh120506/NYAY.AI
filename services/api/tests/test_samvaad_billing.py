"""Samvaad billing (brief §1.3, §4 step 3.3) against real Postgres and a local, flushable Redis (TEST_REDIS_URL).

The clock is fake, so a 10-minute consultation runs in milliseconds; every test checks the ledger afterwards.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import AppError
from app.core.providers import Providers
from app.db.models.enums import SessionState, TxnKind
from app.db.models.tables import AdvocateProfile, ConsultSession, LedgerTxn, User, Wallet
from app.ledger import operations, verify
from app.modules.samvaad import meter
from app.modules.samvaad.billing import Rates, prorate, release_split
from app.modules.samvaad.engine import BillingEngine

from .api_harness import flushable_redis, make_providers, settings_for_tests
from .conftest import create_user

T0 = 1_790_000_000_000  # fixed epoch ms
RATE = 1_000  # advocate ₹10/min; with the default ₹5 fee + 18 % GST the minute costs 1590 paise
COST = 1_590


class FakeClock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> int:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += int(seconds * 1000)


class Recorder:
    """A hub connection that records what it is sent."""

    def __init__(self, party: str) -> None:
        self.party = party
        self.events: list[dict[str, Any]] = []
        self.closed: tuple[int, str] | None = None

    async def send(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    async def close(self, code: int, reason: str) -> None:
        self.closed = (code, reason)

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e["type"] == kind]


@pytest.fixture
async def env(
    sessionmaker: async_sessionmaker[AsyncSession], migrated_database: str
) -> AsyncIterator[tuple[Providers, FakeClock]]:
    redis = flushable_redis()
    await redis.flushdb()
    providers = make_providers(settings_for_tests(migrated_database), sessionmaker)
    clock = FakeClock()
    providers.clock = clock
    yield providers, clock
    await providers.aclose()


async def make_advocate(db: AsyncSession, rate: int = RATE) -> uuid.UUID:
    advocate_id = await create_user(db, role="advocate")
    async with db.begin():
        db.add(
            AdvocateProfile(
                user_id=advocate_id,
                enrolment_no=f"TEST/{uuid.uuid4().hex[:10]}",
                state_bar_council="Test Bar Council",
                verification_status="verified",
                rate_paise_per_min=rate,
                is_available=True,
            )
        )
    return advocate_id


async def funded_user(db: AsyncSession, amount: int, bonus: int = 0) -> User:
    user_id = await create_user(db)
    async with db.begin():
        await operations.topup(db, user_id=user_id, amount=amount, idempotency_key=f"test-topup:{user_id}")
        if bonus:
            await operations.grant_bonus(
                db, user_id=user_id, amount=bonus, idempotency_key=f"test-bonus:{user_id}"
            )
    user = await db.get(User, user_id)
    assert user is not None
    await db.commit()
    return user


async def live_session(
    providers: Providers, db: AsyncSession, *, balance: int, bonus: int = 0, rate: int = RATE
) -> tuple[ConsultSession, User, Recorder]:
    advocate_id = await make_advocate(db, rate)
    user = await funded_user(db, balance, bonus)
    service = providers.samvaad
    s = await service.reserve(db, user, advocate_id=advocate_id, match_id=None, document_id=None)
    recorder = Recorder("user")
    providers.hub.add(str(s.id), recorder)
    await service.touch(s.id, "user", delta=1)
    await service.touch(s.id, "advocate", delta=1)
    await service.start(db, user, s.id, keep_transcript=False, share_summary=False)
    fresh = await reload(providers, s.id)
    assert fresh.state == SessionState.LIVE
    return fresh, user, recorder


async def reload(providers: Providers, session_id: uuid.UUID) -> ConsultSession:
    async with providers.sessions() as db:
        s = await db.get(ConsultSession, session_id)
        assert s is not None
        return s


async def wallet(providers: Providers, user_id: uuid.UUID) -> Wallet:
    async with providers.sessions() as db:
        w = await db.get(Wallet, user_id)
        assert w is not None
        return w


async def minute_debits(providers: Providers, session_id: uuid.UUID) -> int:
    async with providers.sessions() as db:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(LedgerTxn)
                .where(LedgerTxn.session_id == session_id, LedgerTxn.kind == TxnKind.MINUTE_DEBIT)
            )
            or 0
        )


async def assert_ledger_ok(providers: Providers) -> None:
    async with providers.sessions() as db:
        health = await verify.check(db)
    assert health.ok, health


async def heartbeat(providers: Providers, s: ConsultSession) -> None:
    await providers.samvaad.touch(s.id, "user")
    await providers.samvaad.touch(s.id, "advocate")


# =============================================================================================== pure money rules
def test_prorate_rounds_down_per_component_and_never_overcharges() -> None:
    rates = Rates(1000, 500, 90)
    p = prorate(rates, billed_minutes=2, used_seconds=30)
    assert (p.due.adv, p.due.plat, p.due.gst) == (500, 250, 45)
    assert p.refund_total == 2 * 1590 - 795
    # Used more than was prepaid (can't happen, but must not charge beyond it).
    p = prorate(rates, billed_minutes=1, used_seconds=500)
    assert p.used_seconds == 60 and p.refund_total == 0
    # 7 s of a 1000/min rate = 116.66… → 116 (user's favour).
    assert prorate(rates, billed_minutes=1, used_seconds=7).due.adv == 116


def test_release_returns_unspent_bonus_to_bonus() -> None:
    assert release_split(held=10_000, held_bonus=3_000, net_spent=1_000) == release_split(
        held=10_000, held_bonus=3_000, net_spent=1_000
    )
    split = release_split(held=10_000, held_bonus=3_000, net_spent=1_000)
    assert (split.to_bonus, split.to_available) == (2_000, 7_000)
    split = release_split(held=10_000, held_bonus=3_000, net_spent=5_000)
    assert (split.to_bonus, split.to_available) == (0, 5_000)


# ============================================================================================ happy path + proration
async def test_early_end_is_prorated_to_the_second(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, recorder = await live_session(providers, db, balance=100_000)
    # Prepaid with the bill-ahead window (60 s poll + 15 s lead): minutes 1 and 2 are charged at go-live.
    assert s.billed_minutes == 2
    assert recorder.of("session.started") and recorder.of("session.tick")[-1]["minute"] == 2

    clock.advance(30)
    settled = await providers.samvaad.finalize(s.id, "user_ended")
    assert settled is not None and settled.state == SessionState.SETTLED
    assert settled.used_seconds == 30
    assert settled.refunded_paise == 2 * COST - 795
    w = await wallet(providers, user.id)
    assert (w.available_paise, w.held_paise, w.bonus_paise) == (100_000 - 795, 0, 0)
    assert recorder.of("session.terminated") == [{"type": "session.terminated", "reason": "user_ended"}]
    assert recorder.closed == (4410, "user_ended")
    # Idempotent: a second trigger changes nothing.
    again = await providers.samvaad.finalize(s.id, "timeout")
    assert again is not None and again.end_reason == "user_ended"
    assert not await flushable_redis().exists(meter.meter_key(str(user.id)), meter.active_key(str(user.id)))
    await assert_ledger_ok(providers)


async def test_sixty_second_cadence_keeps_minutes_prepaid(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=100_000)
    engine = BillingEngine(providers)
    for minute in range(1, 11):
        clock.advance(60)
        await heartbeat(providers, s)
        await engine.tick()
        fresh = await reload(providers, s.id)
        # The minute being served right now is always already paid for.
        serving = (clock.now - T0) // 60_000 + 1
        assert fresh.billed_minutes >= serving, (minute, fresh.billed_minutes, serving)
    await providers.samvaad.finalize(s.id, "user_ended")
    settled = await reload(providers, s.id)
    assert settled.used_seconds == 600
    w = await wallet(providers, user.id)
    assert w.available_paise == 100_000 - 10 * COST
    await assert_ledger_ok(providers)


async def test_bonus_is_spent_first_and_unused_bonus_returns(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=10_000, bonus=2_000)
    assert s.held_bonus_paise == 2_000
    clock.advance(45)
    await providers.samvaad.finalize(s.id, "user_ended")
    w = await wallet(providers, user.id)
    due = 1000 * 45 // 60 + 500 * 45 // 60 + 90 * 45 // 60
    assert w.bonus_paise == 2_000 - due
    assert w.available_paise == 10_000
    await assert_ledger_ok(providers)


# ======================================================================================= brief §4 step 3.3 (a)–(e)
async def test_a_thousand_concurrent_debits_for_the_same_minute_charge_once(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=100_000)
    clock.advance(70)
    redis = flushable_redis()
    results = await asyncio.gather(
        *(
            meter.bill(
                redis,
                session_id=str(s.id),
                user_id=str(user.id),
                now=clock.now,
                horizon_ms=0,
                held=s.held_paise,
            )
            for _ in range(1000)
        )
    )
    assert {r.minute_idx for r in results} == {2}
    assert int(await redis.hget(meter.meter_key(str(user.id)), "consumed") or 0) == 2 * COST  # type: ignore[misc]
    # And through the service, concurrently: still one ledger debit per minute.
    clock.advance(60)
    await asyncio.gather(*(providers.samvaad.bill(s.id) for _ in range(25)))
    fresh = await reload(providers, s.id)
    assert await minute_debits(providers, s.id) == fresh.billed_minutes
    await providers.samvaad.finalize(s.id, "user_ended")
    await assert_ledger_ok(providers)


async def test_b_worker_killed_between_redis_and_postgres(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=100_000)
    clock.advance(120)
    # The Redis half of a tick ran (minutes 3 and 4 metered) and the process died before posting to Postgres.
    r = await meter.bill(
        flushable_redis(),
        session_id=str(s.id),
        user_id=str(user.id),
        now=clock.now,
        horizon_ms=providers.samvaad.horizon_ms,
        held=s.held_paise,
    )
    assert r.minute_idx == 4
    assert (await reload(providers, s.id)).billed_minutes == 2
    # Next wake-up: the meter says 4, Postgres catches up exactly once.
    await heartbeat(providers, s)
    await BillingEngine(providers).tick()
    await providers.samvaad.bill(s.id, force=True)
    fresh = await reload(providers, s.id)
    assert fresh.billed_minutes == 4
    assert await minute_debits(providers, s.id) == 4
    await providers.samvaad.finalize(s.id, "user_ended")
    assert await minute_debits(providers, s.id) == 4
    await assert_ledger_ok(providers)


async def test_c_topup_concurrent_with_debit(env: tuple[Providers, FakeClock], db: AsyncSession) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=8_000)  # hold covers 5 minutes
    for _ in range(2):
        clock.advance(60)
        await heartbeat(providers, s)
        async with providers.sessions() as tdb, tdb.begin():
            await operations.topup(tdb, user_id=user.id, amount=5_000, idempotency_key=f"t:{uuid.uuid4()}")
        await asyncio.gather(providers.samvaad.on_topup(user.id), providers.samvaad.bill(s.id))
    fresh = await reload(providers, s.id)
    assert fresh.held_paise == 18_000
    meter_held = await flushable_redis().hget(meter.meter_key(str(user.id)), "held")  # type: ignore[misc]
    assert int(meter_held or 0) == 18_000
    await providers.samvaad.finalize(s.id, "user_ended")
    w = await wallet(providers, user.id)
    settled = await reload(providers, s.id)
    assert w.available_paise + w.bonus_paise == 18_000 - (
        settled.billed_minutes * COST - settled.refunded_paise
    )
    await assert_ledger_ok(providers)


async def test_d_redis_wiped_mid_session(env: tuple[Providers, FakeClock], db: AsyncSession) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=100_000)
    clock.advance(60)
    await heartbeat(providers, s)
    await BillingEngine(providers).tick()
    before = (await reload(providers, s.id)).billed_minutes
    await flushable_redis().flushdb()  # failover / flush / eviction
    clock.advance(60)
    await heartbeat(providers, s)
    await BillingEngine(providers).tick()  # rebuilds the meter from Postgres, no minute billed twice
    after = await reload(providers, s.id)
    assert after.billed_minutes == before + 1
    assert await minute_debits(providers, s.id) == after.billed_minutes
    await flushable_redis().flushdb()  # and lost again right before the end
    clock.advance(20)
    settled = await providers.samvaad.finalize(s.id, "user_ended")
    assert settled is not None and settled.state == SessionState.SETTLED
    assert settled.used_seconds == 140
    w = await wallet(providers, user.id)
    due = 1000 * 140 // 60 + 500 * 140 // 60 + 90 * 140 // 60
    assert (w.available_paise, w.held_paise) == (100_000 - due, 0)
    await assert_ledger_ok(providers)


async def test_e_two_simultaneous_reservations_one_wins(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, _ = env
    advocate_id = await make_advocate(db)
    user = await funded_user(db, 50_000)

    async def attempt() -> str:
        async with providers.sessions() as own:
            try:
                await providers.samvaad.reserve(
                    own, user, advocate_id=advocate_id, match_id=None, document_id=None
                )
                return "ok"
            except AppError as exc:
                return exc.code

    outcomes = await asyncio.gather(*(attempt() for _ in range(8)))
    assert outcomes.count("ok") == 1
    assert set(outcomes) == {"ok", "session_exists"}
    w = await wallet(providers, user.id)
    assert w.held_paise == 50_000 and w.available_paise == 0
    # Two simultaneous go-lives for the same session start one meter.
    async with providers.sessions() as own:
        sid = await own.scalar(
            select(ConsultSession.id).where(
                ConsultSession.user_id == user.id, ConsultSession.state == "RESERVED"
            )
        )
    assert sid is not None
    await providers.samvaad.touch(sid, "user", delta=1)
    await providers.samvaad.touch(sid, "advocate", delta=1)
    async with providers.sessions() as own:
        await providers.samvaad.start(own, user, sid, keep_transcript=False, share_summary=False)
    results = await asyncio.gather(*(providers.samvaad.maybe_go_live(sid) for _ in range(5)))
    assert results.count(True) == 0  # start() already went live; nobody starts it twice
    assert await minute_debits(providers, sid) == 2
    await providers.samvaad.finalize(sid, "user_ended")
    await assert_ledger_ok(providers)


# ============================================================================================== endings
async def test_wallet_runs_out_ends_at_the_paid_through_moment(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, user, recorder = await live_session(providers, db, balance=5 * COST)  # exactly 5 minutes
    engine = BillingEngine(providers)
    for _ in range(4):
        clock.advance(60)
        await heartbeat(providers, s)
        await engine.tick()
    assert recorder.of("session.warning"), "one low-balance warning before the end"
    assert len(recorder.of("session.warning")) == 1
    assert str(s.id) in providers.samvaad._timers  # termination scheduled at the paid-through boundary
    clock.now = T0 + 5 * 60_000
    await providers.samvaad._end_if_still_exhausted(s.id, clock.now, "wallet_empty")
    settled = await reload(providers, s.id)
    assert settled.state == SessionState.SETTLED and settled.end_reason == "wallet_empty"
    assert settled.used_seconds == 300 and settled.refunded_paise == 0
    w = await wallet(providers, user.id)
    assert (w.available_paise, w.held_paise) == (0, 0)
    assert recorder.closed == (4402, "wallet_empty")
    await assert_ledger_ok(providers)


async def test_topup_reopens_an_exhausted_meter(env: tuple[Providers, FakeClock], db: AsyncSession) -> None:
    providers, clock = env
    s, user, _ = await live_session(providers, db, balance=5 * COST)
    engine = BillingEngine(providers)
    for _ in range(4):
        clock.advance(60)
        await heartbeat(providers, s)
        await engine.tick()
    assert str(s.id) in providers.samvaad._timers
    async with providers.sessions() as tdb, tdb.begin():
        await operations.topup(tdb, user_id=user.id, amount=20_000, idempotency_key=f"t:{uuid.uuid4()}")
    await providers.samvaad.on_topup(user.id)
    assert str(s.id) not in providers.samvaad._timers
    clock.now = T0 + 5 * 60_000 + 1_000
    await heartbeat(providers, s)
    await engine.tick()
    fresh = await reload(providers, s.id)
    assert fresh.state == SessionState.LIVE and fresh.billed_minutes >= 6
    await providers.samvaad.finalize(s.id, "user_ended")
    await assert_ledger_ok(providers)


async def test_user_gone_past_heartbeat_timeout_is_billed_only_until_then(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    s, _user, _ = await live_session(providers, db, balance=100_000)
    await providers.samvaad.touch(s.id, "user", delta=-1)  # disconnects at T0
    clock.advance(90)
    await providers.samvaad.touch(s.id, "advocate")
    await BillingEngine(providers).tick()
    settled = await reload(providers, s.id)
    assert settled.state == SessionState.SETTLED and settled.end_reason == "timeout"
    assert settled.used_seconds == 30
    await assert_ledger_ok(providers)


async def test_expired_reservation_is_cancelled_and_released(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    providers, clock = env
    advocate_id = await make_advocate(db)
    user = await funded_user(db, 30_000, bonus=1_000)
    s = await providers.samvaad.reserve(db, user, advocate_id=advocate_id, match_id=None, document_id=None)
    # requested_at is the database clock; move it back instead of moving the fake clock forward.
    async with providers.sessions() as own, own.begin():
        await own.execute(
            text("UPDATE sessions SET requested_at = now() - interval '11 minutes' WHERE id = :id"),
            {"id": s.id},
        )
    clock.now = int(__import__("time").time() * 1000)
    await BillingEngine(providers).tick()
    cancelled = await reload(providers, s.id)
    assert cancelled.state == SessionState.CANCELLED
    w = await wallet(providers, user.id)
    assert (w.available_paise, w.held_paise, w.bonus_paise) == (30_000, 0, 1_000)
    await assert_ledger_ok(providers)


# ============================================================================================== Redis budget
async def _command_calls() -> int:
    stats = await flushable_redis().info("commandstats")
    return sum(
        int(v["calls"])
        for k, v in stats.items()
        if not k.startswith(("cmdstat_info", "cmdstat_config"))  # the measurement itself
    )


async def test_redis_budget_idle_and_per_session_minute(
    env: tuple[Providers, FakeClock], db: AsyncSession
) -> None:
    """Owner constraint (Upstash free tier, 10k requests/day): no Redis traffic when idle; ~1 request per live
    session-minute."""
    providers, clock = env
    engine = BillingEngine(providers)
    redis = flushable_redis()
    # Settle anything other tests left open, then measure an idle wake-up.
    async with providers.sessions() as own:
        open_ids = (
            await own.scalars(
                select(ConsultSession.id).where(ConsultSession.state.in_(("RESERVED", "LIVE", "ENDING")))
            )
        ).all()
    for sid in open_ids:
        await providers.samvaad.finalize(sid, "timeout")
    await redis.config_resetstat()
    assert await engine.tick() == 0
    assert await _command_calls() == 0

    s, _user, _ = await live_session(providers, db, balance=100_000)
    # Count requests as Upstash bills them: one per command the client sends (a whole Lua script is one EVALSHA).
    sent: list[str] = []
    original = redis.execute_command

    async def counting(*args: Any, **kwargs: Any) -> Any:
        sent.append(str(args[0]))
        return await original(*args, **kwargs)

    redis.execute_command = counting  # type: ignore[method-assign]
    try:
        for _ in range(10):
            clock.advance(60)
            await heartbeat(providers, s)
            await engine.tick()
        ten_minutes = len(sent)
        await providers.samvaad.finalize(s.id, "user_ended")
    finally:
        redis.execute_command = original  # type: ignore[method-assign]
    settlement = len(sent) - ten_minutes
    assert ten_minutes <= 10, sent
    assert settlement <= 2, sent
    print("Redis requests: idle wake-up 0, 10 live minutes", ten_minutes, "settlement", settlement)
    await assert_ledger_ok(providers)
