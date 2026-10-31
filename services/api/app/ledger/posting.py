"""Double-entry posting (brief §1.3 invariant (c), §2.2).

`post()` writes one balanced transaction and updates the `wallets` projection in the caller's database transaction:
balances never change without ledger rows, and ledger rows never land without the projection. Re-posting an
idempotency key is a no-op that returns the original transaction.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import LEDGER_TXNS
from app.db.models.enums import AccountKind, TxnKind
from app.db.models.tables import LedgerEntry, LedgerTxn, Wallet

from .accounts import USER_KINDS, WALLET_COLUMN, AccountRef, account_id
from .money import require_paise


class LedgerError(Exception):
    pass


class UnbalancedTransaction(LedgerError):
    pass


class InsufficientFunds(LedgerError):
    def __init__(self, user_id: uuid.UUID, column: str, balance: int, delta: int) -> None:
        super().__init__(f"{column} would go negative for {user_id}: {balance} + {delta}")
        self.user_id = user_id
        self.column = column
        self.balance = balance
        self.delta = delta


@dataclass(frozen=True, slots=True)
class Leg:
    """Positive amount = debit, negative = credit."""

    account: AccountRef
    amount: int


@dataclass(frozen=True, slots=True)
class PostResult:
    txn_id: uuid.UUID
    created: bool


def _validate(legs: Sequence[Leg], idempotency_key: str) -> None:
    if not idempotency_key or len(idempotency_key) > 160:
        raise LedgerError("idempotency_key must be 1-160 characters")
    if len(legs) < 2:
        raise UnbalancedTransaction("a transaction needs at least two legs")
    for leg in legs:
        require_paise(leg.amount, name="leg amount")
        if leg.amount == 0:
            raise UnbalancedTransaction("zero-amount legs are not allowed")
    if sum(leg.amount for leg in legs) != 0:
        raise UnbalancedTransaction(f"legs sum to {sum(leg.amount for leg in legs)}, not 0")


def wallet_deltas(legs: Sequence[Leg]) -> dict[uuid.UUID, dict[str, int]]:
    """How each user's wallet columns move. User accounts are liabilities: balance change = −amount."""
    deltas: dict[uuid.UUID, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for leg in legs:
        if leg.account.kind in USER_KINDS and leg.account.owner_user_id is not None:
            deltas[leg.account.owner_user_id][WALLET_COLUMN[leg.account.kind]] -= leg.amount
    return {user: dict(cols) for user, cols in deltas.items()}


async def ensure_wallet(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        insert(Wallet).values(user_id=user_id).on_conflict_do_nothing(index_elements=["user_id"])
    )


async def post(
    db: AsyncSession,
    *,
    kind: TxnKind,
    idempotency_key: str,
    legs: Sequence[Leg],
    session_id: uuid.UUID | None = None,
    external_ref: str | None = None,
) -> PostResult:
    if not db.in_transaction():
        raise LedgerError("post() must run inside a database transaction")
    _validate(legs, idempotency_key)

    existing = await db.scalar(select(LedgerTxn.id).where(LedgerTxn.idempotency_key == idempotency_key))
    if existing is not None:
        return PostResult(existing, created=False)

    # Lock wallets in a fixed order (by id) so concurrent postings can't deadlock, then refuse anything that would
    # take a balance below zero before writing a single row.
    deltas = wallet_deltas(legs)
    for user_id in sorted(deltas):
        await ensure_wallet(db, user_id)
        wallet = (
            await db.execute(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
        ).scalar_one()
        for column, delta in deltas[user_id].items():
            balance = int(getattr(wallet, column))
            if balance + delta < 0:
                raise InsufficientFunds(user_id, column, balance, delta)

    inserted = await db.execute(
        insert(LedgerTxn)
        .values(kind=kind, idempotency_key=idempotency_key, session_id=session_id, external_ref=external_ref)
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(LedgerTxn.id)
    )
    txn_id = inserted.scalar_one_or_none()
    if txn_id is None:  # a concurrent duplicate committed first
        winner = await db.scalar(select(LedgerTxn.id).where(LedgerTxn.idempotency_key == idempotency_key))
        assert winner is not None
        return PostResult(winner, created=False)

    for index, leg in enumerate(legs):
        await db.execute(
            insert(LedgerEntry).values(
                txn_id=txn_id,
                account_id=await account_id(db, leg.account),
                amount_paise=leg.amount,
                idempotency_key=f"{idempotency_key}#{index}",
            )
        )

    for user_id, columns in deltas.items():
        assignments = ", ".join(f"{column} = {column} + :{column}" for column in columns)
        await db.execute(
            text(f"UPDATE wallets SET {assignments}, version = version + 1 WHERE user_id = :user_id"),  # noqa: S608
            {"user_id": user_id, **columns},
        )
    LEDGER_TXNS.labels(kind=kind.value).inc()
    return PostResult(txn_id, created=True)


def legs(*pairs: tuple[AccountRef, int]) -> list[Leg]:
    """Build legs, dropping zero amounts (e.g. a zero platform fee)."""
    return [Leg(account, amount) for account, amount in pairs if amount != 0]


__all__ = [
    "AccountKind",
    "InsufficientFunds",
    "LedgerError",
    "Leg",
    "PostResult",
    "UnbalancedTransaction",
    "ensure_wallet",
    "legs",
    "post",
    "wallet_deltas",
]
