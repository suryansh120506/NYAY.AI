"""Offline payments for dev/test. Orders are local ids; "capturing" goes through the same signed-webhook code path
as Razorpay (POST /v1/dev/payments/{order_id}/capture builds and signs the event), so idempotency is exercised."""

from __future__ import annotations

import hmac
import uuid
from typing import Any

from .base import CapturedPayment, ProviderOrder
from .razorpay import parse_capture_payload, sign


class FakePaymentProvider:
    name = "fake"
    public_key = ""

    def __init__(self, webhook_secret: str) -> None:
        self.webhook_secret = webhook_secret

    async def create_order(self, *, amount_paise: int, receipt: str) -> ProviderOrder:
        return ProviderOrder(
            provider_order_id=f"fake_order_{uuid.uuid4().hex[:20]}", amount_paise=amount_paise
        )

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool:
        return bool(signature) and hmac.compare_digest(sign(raw_body, self.webhook_secret), signature)

    def parse_capture(self, payload: dict[str, Any]) -> CapturedPayment | None:
        return parse_capture_payload(payload)

    @staticmethod
    def capture_event(order_id: str, amount_paise: int) -> dict[str, Any]:
        """A webhook body shaped like Razorpay's `payment.captured`."""
        return {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": f"fake_pay_{uuid.uuid4().hex[:16]}",
                        "order_id": order_id,
                        "amount": amount_paise,
                        "currency": "INR",
                        "status": "captured",
                    }
                }
            },
        }
