"""Razorpay: Orders API + webhook signature (HMAC-SHA256 of the raw body with the webhook secret).

Credentials come only from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

import httpx

from .base import CapturedPayment, PaymentError, ProviderOrder


def sign(raw_body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def parse_capture_payload(payload: dict[str, Any]) -> CapturedPayment | None:
    """`payment.captured` (and `order.paid`) events carry the payment entity with its order id and amount."""
    if payload.get("event") not in {"payment.captured", "order.paid"}:
        return None
    try:
        entity = payload["payload"]["payment"]["entity"]
        return CapturedPayment(
            provider_order_id=str(entity["order_id"]),
            payment_id=str(entity["id"]),
            amount_paise=int(entity["amount"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


class RazorpayProvider:
    name = "razorpay"

    def __init__(
        self, *, key_id: str, key_secret: str, webhook_secret: str, base_url: str, client: httpx.AsyncClient
    ) -> None:
        if not (key_id and key_secret and webhook_secret):
            raise ValueError("RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required")
        self.public_key = key_id
        self._secret, self._webhook_secret = key_secret, webhook_secret
        self._base, self._client = base_url.rstrip("/"), client

    async def create_order(self, *, amount_paise: int, receipt: str) -> ProviderOrder:
        try:
            response = await self._client.post(
                f"{self._base}/v1/orders",
                json={"amount": amount_paise, "currency": "INR", "receipt": receipt[:40]},
                auth=(self.public_key, self._secret),
                timeout=10,
            )
            response.raise_for_status()
            body = response.json()
            return ProviderOrder(provider_order_id=str(body["id"]), amount_paise=int(body["amount"]))
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise PaymentError(f"razorpay create order: {type(exc).__name__}") from exc

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool:
        return bool(signature) and hmac.compare_digest(sign(raw_body, self._webhook_secret), signature)

    def parse_capture(self, payload: dict[str, Any]) -> CapturedPayment | None:
        return parse_capture_payload(payload)
