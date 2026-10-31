"""Ledger accounts and their sign conventions.

Entries are signed: positive = debit, negative = credit, and each transaction sums to zero. Accounts that hold the
user's money (`user_*`) are platform liabilities, so their balance is −SUM(amount): a credit increases it. The wallet
projection columns map onto exactly those three accounts.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import AccountKind
from app.db.models.tables import LedgerAccount

USER_KINDS = frozenset({AccountKind.USER_AVAILABLE, AccountKind.USER_HELD, AccountKind.USER_BONUS})
SYSTEM_KINDS = frozenset(
    {
        AccountKind.ADVOCATE_PAYABLE,  # per advocate (owner = advocate user id)
        AccountKind.PLATFORM_REVENUE,
        AccountKind.GST_PAYABLE,
        AccountKind.GATEWAY_CLEARING,
        AccountKind.BONUS_EXPENSE,
    }
)
WALLET_COLUMN = {
    AccountKind.USER_AVAILABLE: "available_paise",
    AccountKind.USER_HELD: "held_paise",
    AccountKind.USER_BONUS: "bonus_paise",
}


@dataclass(frozen=True, slots=True)
class AccountRef:
    kind: AccountKind
    owner_user_id: uuid.UUID | None = None

    def __post_init__(self) -> None:
        needs_owner = self.kind in USER_KINDS or self.kind is AccountKind.ADVOCATE_PAYABLE
        if needs_owner and self.owner_user_id is None:
            raise ValueError(f"{self.kind} needs an owner")
        if not needs_owner and self.owner_user_id is not None:
            raise ValueError(f"{self.kind} is a platform account and has no owner")


def user(kind: AccountKind, user_id: uuid.UUID) -> AccountRef:
    return AccountRef(kind, user_id)


def platform(kind: AccountKind) -> AccountRef:
    return AccountRef(kind, None)


async def account_id(db: AsyncSession, ref: AccountRef) -> uuid.UUID:
    """Get-or-create, race-safe (UNIQUE NULLS NOT DISTINCT (kind, owner_user_id))."""
    await db.execute(
        insert(LedgerAccount)
        .values(kind=ref.kind, owner_user_id=ref.owner_user_id)
        .on_conflict_do_nothing(index_elements=["kind", "owner_user_id"])
    )
    stmt = select(LedgerAccount.id).where(LedgerAccount.kind == ref.kind)
    stmt = stmt.where(
        LedgerAccount.owner_user_id.is_(None)
        if ref.owner_user_id is None
        else LedgerAccount.owner_user_id == ref.owner_user_id
    )
    return (await db.execute(stmt)).scalar_one()
