from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class PaymentError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ProviderOrder:
    provider_order_id: str
    amount_paise: int


@dataclass(frozen=True, slots=True)
class CapturedPayment:
    provider_order_id: str
    payment_id: str
    amount_paise: int


class PaymentProvider(Protocol):
    name: str
    #: Public key the browser checkout needs (Razorpay key id); empty for the fake.
    public_key: str

    async def create_order(self, *, amount_paise: int, receipt: str) -> ProviderOrder: ...

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool: ...

    def parse_capture(self, payload: dict[str, Any]) -> CapturedPayment | None: ...
