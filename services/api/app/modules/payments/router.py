"""Payment webhooks (brief §1.4): verify the signature, then post the top-up exactly once per order."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep, ProvidersDep
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.providers import Providers
from app.core.schemas import ApiModel
from app.db.models.enums import PaymentStatus
from app.db.models.tables import PaymentOrder
from app.db.tx import transaction
from app.integrations.payments.fake import FakePaymentProvider
from app.integrations.payments.razorpay import sign
from app.ledger import operations

router = APIRouter(tags=["payments"])
log = get_logger("payments")


class WebhookAck(ApiModel):
    status: str


async def process_webhook(raw: bytes, signature: str, providers: Providers, db: DbDep) -> WebhookAck:
    if not providers.payments.verify_webhook(raw_body=raw, signature=signature):
        log.warning("payments.bad_signature")
        raise AppError("unauthorized", 401, "Invalid webhook signature.")
    try:
        payload: dict[str, Any] = json.loads(raw)
    except ValueError as exc:
        raise AppError("invalid_request", 400, "Body is not JSON.") from exc
    capture = providers.payments.parse_capture(payload)
    if capture is None:
        return WebhookAck(status="ignored")

    async with transaction(db):
        order = await db.scalar(
            select(PaymentOrder)
            .where(PaymentOrder.provider_order_id == capture.provider_order_id)
            .with_for_update()
        )
        if order is None:
            log.warning("payments.unknown_order", order_id=capture.provider_order_id)
            return WebhookAck(status="unknown_order")
        if order.status == PaymentStatus.CAPTURED:
            return WebhookAck(status="duplicate")
        if capture.amount_paise != order.amount_paise:
            order.status = PaymentStatus.FAILED
            order.raw_webhook = {
                "event": payload.get("event"),
                "payment_id": capture.payment_id,
                "mismatch": True,
            }
            log.error("payments.amount_mismatch", order_id=order.provider_order_id)
            return WebhookAck(status="amount_mismatch")
        # Idempotent: the key is the provider's order id, so a replayed webhook can never credit twice.
        await operations.topup(
            db,
            user_id=order.user_id,
            amount=order.amount_paise,
            idempotency_key=f"topup:{order.provider}:{order.provider_order_id}",
            external_ref=capture.payment_id,
        )
        order.status = PaymentStatus.CAPTURED
        order.raw_webhook = {"event": payload.get("event"), "payment_id": capture.payment_id}
    log.info("payments.captured", order_id=capture.provider_order_id, amount_paise=capture.amount_paise)
    # Mid-call top-up (brief §1.3 step 6): raise the live session's hold and re-open its meter right away.
    try:
        await providers.samvaad.on_topup(order.user_id)
    except Exception as exc:  # the money is safe in `available`; the next billing wake-up extends the hold
        log.warning("payments.session_topup_failed", error=type(exc).__name__)
    return WebhookAck(status="captured")


@router.post("/v1/webhooks/razorpay", response_model=WebhookAck)
async def razorpay_webhook(request: Request, providers: ProvidersDep, db: DbDep) -> WebhookAck:
    raw = await request.body()
    return await process_webhook(raw, request.headers.get("x-razorpay-signature", ""), providers, db)


@router.post("/v1/dev/payments/{order_id}/capture", response_model=WebhookAck, include_in_schema=True)
async def dev_capture(order_id: str, user: CurrentUser, providers: ProvidersDep, db: DbDep) -> WebhookAck:
    """Dev/test only, fake provider only: "pays" an order by sending a signed webhook through the real handler."""
    payments = providers.payments
    if not providers.settings.is_dev or not isinstance(payments, FakePaymentProvider):
        raise AppError("not_found", 404)
    order = await db.scalar(select(PaymentOrder).where(PaymentOrder.provider_order_id == order_id))
    if order is None or order.user_id != user.id:
        raise AppError("not_found", 404)
    raw = json.dumps(FakePaymentProvider.capture_event(order_id, order.amount_paise)).encode()
    return await process_webhook(raw, sign(raw, payments.webhook_secret), providers, db)
