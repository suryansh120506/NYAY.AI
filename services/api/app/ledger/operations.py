"""The money movements the product needs, each one balanced posting (brief §1.3, §1.4).

top-up        DR gateway_clearing           CR user_available
reserve       DR user_bonus, user_available  CR user_held          (bonus is spent first)
minute debit  DR user_held                   CR advocate_payable, platform_revenue, gst_payable
refund        DR advocate_payable, platform_revenue, gst_payable   CR user_held   (prorated end, A60)
release       DR user_held                   CR user_bonus, user_available
bonus grant   DR bonus_expense               CR user_bonus
bonus expiry  DR user_bonus                  CR bonus_expense
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import AccountKind as K
from app.db.models.enums import TxnKind
from app.db.models.tables import Wallet

from .accounts import platform, user
from .posting import PostResult, legs, post


@dataclass(frozen=True, slots=True)
class HoldSplit:
    from_bonus: int
    from_available: int

    @property
    def total(self) -> int:
        return self.from_bonus + self.from_available


def split_for_hold(wallet: Wallet, amount: int) -> HoldSplit:
    """Bonus credit is spent first (brief §1.4); the rest comes from the available balance."""
    from_bonus = min(int(wallet.bonus_paise), amount)
    return HoldSplit(from_bonus, min(int(wallet.available_paise), amount - from_bonus))


async def wallet_of(db: AsyncSession, user_id: uuid.UUID) -> Wallet | None:
    return await db.scalar(select(Wallet).where(Wallet.user_id == user_id))


async def topup(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    amount: int,
    idempotency_key: str,
    external_ref: str | None = None,
) -> PostResult:
    return await post(
        db,
        kind=TxnKind.TOPUP,
        idempotency_key=idempotency_key,
        external_ref=external_ref,
        legs=legs((platform(K.GATEWAY_CLEARING), amount), (user(K.USER_AVAILABLE, user_id), -amount)),
    )


async def reserve(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    split: HoldSplit,
    idempotency_key: str,
    session_id: uuid.UUID | None = None,
) -> PostResult:
    return await post(
        db,
        kind=TxnKind.RESERVE,
        idempotency_key=idempotency_key,
        session_id=session_id,
        legs=legs(
            (user(K.USER_BONUS, user_id), split.from_bonus),
            (user(K.USER_AVAILABLE, user_id), split.from_available),
            (user(K.USER_HELD, user_id), -split.total),
        ),
    )


async def minute_debit(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    advocate_id: uuid.UUID,
    adv_paise: int,
    plat_paise: int,
    gst_paise: int,
    idempotency_key: str,
    session_id: uuid.UUID | None = None,
) -> PostResult:
    """Idempotency key `sess:{id}:min:{n}` (brief §1.3 invariant (b))."""
    return await post(
        db,
        kind=TxnKind.MINUTE_DEBIT,
        idempotency_key=idempotency_key,
        session_id=session_id,
        legs=legs(
            (user(K.USER_HELD, user_id), adv_paise + plat_paise + gst_paise),
            (user(K.ADVOCATE_PAYABLE, advocate_id), -adv_paise),
            (platform(K.PLATFORM_REVENUE), -plat_paise),
            (platform(K.GST_PAYABLE), -gst_paise),
        ),
    )


async def refund_minutes(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    advocate_id: uuid.UUID,
    adv_paise: int,
    plat_paise: int,
    gst_paise: int,
    idempotency_key: str,
    session_id: uuid.UUID | None = None,
) -> PostResult:
    """The unused part of prepaid minutes goes back into the hold, each component from the account it went to."""
    return await post(
        db,
        kind=TxnKind.REFUND,
        idempotency_key=idempotency_key,
        session_id=session_id,
        legs=legs(
            (user(K.ADVOCATE_PAYABLE, advocate_id), adv_paise),
            (platform(K.PLATFORM_REVENUE), plat_paise),
            (platform(K.GST_PAYABLE), gst_paise),
            (user(K.USER_HELD, user_id), -(adv_paise + plat_paise + gst_paise)),
        ),
    )


async def release(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    to_available: int,
    to_bonus: int,
    idempotency_key: str,
    session_id: uuid.UUID | None = None,
) -> PostResult:
    return await post(
        db,
        kind=TxnKind.RELEASE,
        idempotency_key=idempotency_key,
        session_id=session_id,
        legs=legs(
            (user(K.USER_HELD, user_id), to_available + to_bonus),
            (user(K.USER_AVAILABLE, user_id), -to_available),
            (user(K.USER_BONUS, user_id), -to_bonus),
        ),
    )


async def grant_bonus(
    db: AsyncSession, *, user_id: uuid.UUID, amount: int, idempotency_key: str
) -> PostResult:
    return await post(
        db,
        kind=TxnKind.BONUS_GRANT,
        idempotency_key=idempotency_key,
        legs=legs((platform(K.BONUS_EXPENSE), amount), (user(K.USER_BONUS, user_id), -amount)),
    )


async def expire_bonus(
    db: AsyncSession, *, user_id: uuid.UUID, amount: int, idempotency_key: str
) -> PostResult:
    return await post(
        db,
        kind=TxnKind.BONUS_EXPIRY,
        idempotency_key=idempotency_key,
        legs=legs((user(K.USER_BONUS, user_id), amount), (platform(K.BONUS_EXPENSE), -amount)),
    )
