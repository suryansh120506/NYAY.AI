"""Ledger guarantees (brief §2.2, §4 step 2.3) against the real schema and triggers."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models.enums import AccountKind as K
from app.db.models.enums import TxnKind
from app.db.models.tables import Wallet
from app.db.session import make_engine
from app.ledger import operations as ops
from app.ledger import verify
from app.ledger.accounts import platform, user
from app.ledger.money import format_paise, gst_on_fee
from app.ledger.posting import InsufficientFunds, Leg, UnbalancedTransaction, post

from .conftest import create_user


# ------------------------------------------------------------------------------------------------- helpers
def test_format_paise_indian_grouping() -> None:
    assert format_paise(123_450) == "₹1,234.50"
    assert format_paise(12_345_650) == "₹1,23,456.50"
    assert format_paise(-21_540) == "−₹215.40"
    assert format_paise(14_800, trim_zero=True) == "₹148"
    with pytest.raises(TypeError):
        format_paise(10.5)  # type: ignore[arg-type]


def test_gst_half_up() -> None:
    assert gst_on_fee(500, 1_800) == 90
    assert gst_on_fee(333, 1_800) == 60
    assert gst_on_fee(25, 1_800) == 5


# ------------------------------------------------------------------------------------------- invariants
async def _wallet(db: AsyncSession, user_id: uuid.UUID) -> tuple[int, int, int]:
    w = (await db.execute(select(Wallet).where(Wallet.user_id == user_id))).scalar_one()
    await db.refresh(w)
    return int(w.available_paise), int(w.held_paise), int(w.bonus_paise)


async def test_topup_moves_money_and_is_idempotent(db: AsyncSession) -> None:
    user_id = await create_user(db)
    async with db.begin():
        first = await ops.topup(db, user_id=user_id, amount=25_000, idempotency_key=f"topup:{user_id}")
    async with db.begin():
        again = await ops.topup(db, user_id=user_id, amount=25_000, idempotency_key=f"topup:{user_id}")
    assert first.created and not again.created and first.txn_id == again.txn_id
    async with db.begin():
        assert await _wallet(db, user_id) == (25_000, 0, 0)


async def test_unbalanced_legs_are_rejected_before_writing(db: AsyncSession) -> None:
    user_id = await create_user(db)
    with pytest.raises(UnbalancedTransaction):
        async with db.begin():
            await post(
                db,
                kind=TxnKind.TOPUP,
                idempotency_key=f"bad:{user_id}",
                legs=[Leg(platform(K.GATEWAY_CLEARING), 100), Leg(user(K.USER_AVAILABLE, user_id), -99)],
            )


async def test_deferred_trigger_rejects_an_unbalanced_transaction_at_commit(db: AsyncSession) -> None:
    """Even raw SQL that bypasses post() cannot commit an unbalanced transaction."""
    account = uuid.uuid4()
    txn = uuid.uuid4()
    with pytest.raises(DBAPIError, match="unbalanced"):
        async with db.begin():
            await db.execute(
                text(
                    "INSERT INTO ledger_accounts (id, kind) VALUES (:id, 'platform_revenue') ON CONFLICT DO NOTHING"
                ),
                {"id": account},
            )
            acc = await db.scalar(text("SELECT id FROM ledger_accounts WHERE kind = 'platform_revenue'"))
            await db.execute(
                text("INSERT INTO ledger_txns (id, kind, idempotency_key) VALUES (:id, 'topup', :key)"),
                {"id": txn, "key": f"raw:{txn}"},
            )
            await db.execute(
                text(
                    "INSERT INTO ledger_entries (txn_id, account_id, amount_paise, idempotency_key) "
                    "VALUES (:t, :a, 500, :k)"
                ),
                {"t": txn, "a": acc, "k": f"raw:{txn}#0"},
            )


async def test_ledger_is_append_only(db: AsyncSession) -> None:
    user_id = await create_user(db)
    async with db.begin():
        await ops.topup(db, user_id=user_id, amount=10_000, idempotency_key=f"ao:{user_id}")
    for statement in (
        "UPDATE ledger_entries SET amount_paise = 1",
        "DELETE FROM ledger_txns",
        "TRUNCATE ledger_entries",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            async with db.begin():
                await db.execute(text(statement))


async def test_insufficient_funds_writes_nothing(db: AsyncSession) -> None:
    user_id = await create_user(db)
    async with db.begin():
        await ops.topup(db, user_id=user_id, amount=5_000, idempotency_key=f"if:{user_id}")
    with pytest.raises(InsufficientFunds):
        async with db.begin():
            await ops.reserve(
                db, user_id=user_id, split=ops.HoldSplit(0, 6_000), idempotency_key=f"if-r:{user_id}"
            )
    async with db.begin():
        assert await _wallet(db, user_id) == (5_000, 0, 0)


async def test_concurrent_duplicates_post_exactly_once(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with sessionmaker() as db:
        user_id = await create_user(db)

    async def attempt() -> bool:
        async with sessionmaker() as session, session.begin():
            result = await ops.topup(
                session, user_id=user_id, amount=1_000, idempotency_key=f"race:{user_id}"
            )
            return result.created

    created = await asyncio.gather(*(attempt() for _ in range(20)), return_exceptions=True)
    assert sum(1 for c in created if c is True) == 1
    async with sessionmaker() as db, db.begin():
        assert await _wallet(db, user_id) == (1_000, 0, 0)


# ------------------------------------------------------------------------------------- property-based
@dataclass
class Model:
    """What the wallet should hold, tracked independently of the database."""

    available: int = 0
    held: int = 0
    bonus: int = 0
    held_from_bonus: int = 0
    keys: list[str] = field(default_factory=list)


OPS = st.lists(
    st.one_of(
        st.tuples(st.just("topup"), st.integers(1, 50_000)),
        st.tuples(st.just("bonus"), st.integers(1, 5_000)),
        st.tuples(st.just("reserve"), st.integers(1, 60_000)),
        st.tuples(st.just("debit"), st.integers(1, 9_000)),
        st.tuples(st.just("release"), st.just(0)),
        st.tuples(st.just("duplicate"), st.just(0)),
    ),
    min_size=1,
    max_size=25,
)


async def _run_sequence(maker: async_sessionmaker[AsyncSession], sequence: list[tuple[str, int]]) -> None:
    async with maker() as db:
        user_id = await create_user(db)
        advocate_id = await create_user(db, role="advocate")
        model = Model()
        for step, (op, amount) in enumerate(sequence):
            key = f"prop:{user_id}:{step}"
            try:
                async with db.begin():
                    if op == "topup":
                        await ops.topup(db, user_id=user_id, amount=amount, idempotency_key=key)
                        model.available += amount
                    elif op == "bonus":
                        await ops.grant_bonus(db, user_id=user_id, amount=amount, idempotency_key=key)
                        model.bonus += amount
                    elif op == "reserve":
                        wallet = await ops.wallet_of(db, user_id)
                        assert wallet is not None
                        split = ops.split_for_hold(wallet, amount)
                        if split.total == 0:
                            continue
                        await ops.reserve(db, user_id=user_id, split=split, idempotency_key=key)
                        model.available -= split.from_available
                        model.bonus -= split.from_bonus
                        model.held += split.total
                        model.held_from_bonus += split.from_bonus
                    elif op == "debit":
                        adv, plat = amount, 500
                        gst = gst_on_fee(plat, 1_800)
                        cost = adv + plat + gst
                        await ops.minute_debit(
                            db,
                            user_id=user_id,
                            advocate_id=advocate_id,
                            adv_paise=adv,
                            plat_paise=plat,
                            gst_paise=gst,
                            idempotency_key=key,
                        )
                        # Only reached if the hold covered it; bonus-sourced money is consumed first.
                        model.held -= cost
                        model.held_from_bonus -= min(model.held_from_bonus, cost)
                    elif op == "release":
                        if model.held == 0:
                            continue
                        to_bonus = model.held_from_bonus
                        await ops.release(
                            db,
                            user_id=user_id,
                            to_available=model.held - to_bonus,
                            to_bonus=to_bonus,
                            idempotency_key=key,
                        )
                        model.available += model.held - to_bonus
                        model.bonus += to_bonus
                        model.held = model.held_from_bonus = 0
                    elif op == "duplicate":
                        if not model.keys:
                            continue
                        result = await ops.topup(
                            db, user_id=user_id, amount=1, idempotency_key=model.keys[-1]
                        )
                        assert not result.created, "a reused idempotency key must be a no-op"
                    if op != "duplicate":  # only keys that were really posted can be replayed
                        model.keys.append(key)
            except InsufficientFunds:
                assert op == "debit", f"{op} should never overdraw"
            async with db.begin():
                actual = await _wallet(db, user_id)
            assert actual == (model.available, model.held, model.bonus), (op, actual, model)
            assert min(actual) >= 0
        async with db.begin():
            health = await verify.check(db)
        assert health.ok, health


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(sequence=OPS)
def test_random_money_movements_keep_every_invariant(
    migrated_database: str, sequence: list[tuple[str, int]]
) -> None:
    """No negative balance, never an unbalanced transaction, money conserved, wallets equal the ledger, duplicate
    idempotency keys are no-ops. Runs on its own event loop because Hypothesis drives synchronous tests."""

    async def run() -> None:
        engine = make_engine(migrated_database, pool_size=2, max_overflow=0)
        try:
            await _run_sequence(async_sessionmaker(engine, expire_on_commit=False), sequence)
        finally:
            await engine.dispose()

    asyncio.run(run())
