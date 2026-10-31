from __future__ import annotations

import json

import httpx

from app.integrations.payments.fake import FakePaymentProvider
from app.integrations.payments.razorpay import sign

from .api_harness import sign_in


async def _order(api: httpx.AsyncClient, token: str, amount: int = 20_000) -> dict[str, object]:
    r = await api.post(
        "/v1/wallet/topups", headers={"Authorization": f"Bearer {token}"}, json={"amount_paise": amount}
    )
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


async def test_topup_via_signed_webhook_is_idempotent(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    headers = {"Authorization": f"Bearer {token}"}
    order = await _order(api, token)
    payments = api.providers.payments  # type: ignore[attr-defined]
    assert isinstance(payments, FakePaymentProvider)
    raw = json.dumps(FakePaymentProvider.capture_event(str(order["order_id"]), 20_000)).encode()
    signature = sign(raw, payments.webhook_secret)
    for expected in ("captured", "duplicate", "duplicate"):
        r = await api.post("/v1/webhooks/razorpay", content=raw, headers={"X-Razorpay-Signature": signature})
        assert r.json()["status"] == expected
    assert (await api.get("/v1/wallet", headers=headers)).json()["available_paise"] == 20_000
    history = (await api.get("/v1/wallet/history", headers=headers)).json()
    assert [(t["kind"], t["amount_paise"]) for t in history] == [("topup", 20_000)]


async def test_webhook_rejects_bad_signature(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    order = await _order(api, token)
    raw = json.dumps(FakePaymentProvider.capture_event(str(order["order_id"]), 20_000)).encode()
    r = await api.post("/v1/webhooks/razorpay", content=raw, headers={"X-Razorpay-Signature": "forged"})
    assert r.status_code == 401


async def test_webhook_amount_mismatch_credits_nothing(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    order = await _order(api, token)
    payments = api.providers.payments  # type: ignore[attr-defined]
    raw = json.dumps(FakePaymentProvider.capture_event(str(order["order_id"]), 1)).encode()
    r = await api.post(
        "/v1/webhooks/razorpay",
        content=raw,
        headers={"X-Razorpay-Signature": sign(raw, payments.webhook_secret)},
    )
    assert r.json()["status"] == "amount_mismatch"
    wallet = await api.get("/v1/wallet", headers={"Authorization": f"Bearer {token}"})
    assert wallet.json()["available_paise"] == 0


async def test_minimum_topup(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    r = await api.post(
        "/v1/wallet/topups", headers={"Authorization": f"Bearer {token}"}, json={"amount_paise": 9_999}
    )
    assert r.status_code == 422 and r.json()["code"] == "invalid_amount"
    r = await api.post(
        "/v1/wallet/topups", headers={"Authorization": f"Bearer {token}"}, json={"amount_paise": 150.5}
    )
    assert r.status_code == 422  # integer paise only


async def test_dev_capture_only_for_own_orders(api: httpx.AsyncClient) -> None:
    alice, _ = await sign_in(api)
    bob, _ = await sign_in(api)
    order = await _order(api, alice)
    r = await api.post(
        f"/v1/dev/payments/{order['order_id']}/capture", headers={"Authorization": f"Bearer {bob}"}
    )
    assert r.status_code == 404
    r = await api.post(
        f"/v1/dev/payments/{order['order_id']}/capture", headers={"Authorization": f"Bearer {alice}"}
    )
    assert r.json()["status"] == "captured"
