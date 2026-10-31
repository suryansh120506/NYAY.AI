"""Wallet (closed loop, brief §0): balances, itemised history, and top-up orders. No withdrawals to bank accounts."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import Field
from sqlalchemy import select, text

from app.core.deps import CurrentUser, DbDep, ProvidersDep
from app.core.errors import AppError
from app.core.ratelimit import enforce
from app.core.schemas import ApiModel
from app.db.models.tables import PaymentOrder, Wallet
from app.db.tx import transaction
from app.integrations.payments.base import PaymentError

router = APIRouter(prefix="/v1/wallet", tags=["wallet"])


class WalletOut(ApiModel):
    available_paise: int
    held_paise: int
    bonus_paise: int


class WalletTxnOut(ApiModel):
    id: str
    kind: Literal["topup", "consultation", "release", "bonus_grant", "bonus_expiry", "refund"]
    amount_paise: int = Field(description="Signed: positive adds to what you can spend")
    created_at: datetime
    advocate_name: str | None = None
    minutes: int | None = None


class TopupIn(ApiModel):
    amount_paise: Annotated[int, Field(strict=True, gt=0)]


class TopupOrderOut(ApiModel):
    order_id: str
    amount_paise: int
    provider: Literal["fake", "razorpay"]
    key_id: str = Field(description="Public key for the provider's browser checkout; empty for the fake")


@router.get("", response_model=WalletOut)
async def get_wallet(user: CurrentUser, db: DbDep) -> WalletOut:
    wallet = await db.scalar(select(Wallet).where(Wallet.user_id == user.id))
    if wallet is None:
        return WalletOut(available_paise=0, held_paise=0, bonus_paise=0)
    return WalletOut(
        available_paise=wallet.available_paise, held_paise=wallet.held_paise, bonus_paise=wallet.bonus_paise
    )


# Net change to the user's total (available + held + bonus) per transaction; reserve/release move money between
# the user's own accounts and net to zero, so they don't appear. Minute debits and the prorated refund at the end
# are netted into one line per consultation.
_HISTORY = text(
    """
    WITH mine AS (
        SELECT t.id, t.kind, t.session_id, t.created_at, -SUM(e.amount_paise) AS delta
          FROM ledger_txns t
          JOIN ledger_entries e ON e.txn_id = t.id
          JOIN ledger_accounts a ON a.id = e.account_id
         WHERE a.owner_user_id = :user_id
           AND a.kind IN ('user_available', 'user_held', 'user_bonus')
         GROUP BY t.id
    )
    SELECT id::text AS id, kind, delta, created_at, NULL::text AS advocate_name, NULL::int AS minutes
      FROM mine
     WHERE (kind IN ('topup', 'bonus_grant', 'bonus_expiry') OR (kind = 'refund' AND session_id IS NULL))
       AND delta <> 0
    UNION ALL
    SELECT m.session_id::text, 'consultation', SUM(m.delta), MAX(m.created_at), MAX(u.display_name),
           (COUNT(*) FILTER (WHERE m.kind = 'minute_debit'))::int
      FROM mine m
      JOIN sessions s ON s.id = m.session_id
      JOIN users u ON u.id = s.advocate_id
     WHERE m.kind IN ('minute_debit', 'refund')
     GROUP BY m.session_id
    ORDER BY created_at DESC
    LIMIT :limit
    """
)


@router.get("/history", response_model=list[WalletTxnOut])
async def wallet_history(user: CurrentUser, db: DbDep) -> list[WalletTxnOut]:
    rows = (await db.execute(_HISTORY, {"user_id": user.id, "limit": 100})).mappings()
    return [
        WalletTxnOut(
            id=row["id"],
            kind=row["kind"],
            amount_paise=int(row["delta"]),
            created_at=row["created_at"],
            advocate_name=row["advocate_name"],
            minutes=row["minutes"],
        )
        for row in rows
    ]


@router.post("/topups", response_model=TopupOrderOut, status_code=201)
async def create_topup(
    body: TopupIn, request: Request, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> TopupOrderOut:
    settings = providers.settings
    if body.amount_paise < settings.min_topup_paise:
        raise AppError("invalid_amount", 422, "Below the minimum top-up.", min_paise=settings.min_topup_paise)
    await enforce(providers.redis, scope="topup", identity=str(user.id), rule=settings.rate_limit_topup)
    try:
        order = await providers.payments.create_order(
            amount_paise=body.amount_paise, receipt=f"topup-{uuid.uuid4().hex[:12]}"
        )
    except PaymentError as exc:
        raise AppError(
            "payment_unavailable", 502, "The payment provider is not reachable. Try again."
        ) from exc
    async with transaction(db):
        db.add(
            PaymentOrder(
                user_id=user.id,
                provider=providers.payments.name,
                provider_order_id=order.provider_order_id,
                amount_paise=order.amount_paise,
            )
        )
    return TopupOrderOut(
        order_id=order.provider_order_id,
        amount_paise=order.amount_paise,
        provider=providers.payments.name,
        key_id=providers.payments.public_key,
    )
