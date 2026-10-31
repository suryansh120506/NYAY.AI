"""Gate 2 check (brief §4 Phase 2 "Verify"): end-to-end top-up through the running API, then the ledger.

    uv run python -m scripts.ledger_e2e            # against API_PUBLIC_URL from .env
    uv run python -m scripts.ledger_e2e --api http://localhost:8100

Signs in a fresh demo number, creates a top-up order, pays it through the fake provider's signed webhook (twice, to
prove idempotency), checks the wallet against the expected balance, then recomputes every wallet from the ledger.
Prints `ledger imbalance: 0` on success and exits non-zero otherwise. Needs ENV=dev and PAYMENT_PROVIDER=fake.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import sys

import httpx

from app.core.config import get_settings
from app.db.session import get_sessionmaker
from app.ledger import verify

AMOUNT_PAISE = 25_000


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default=get_settings().api_public_url)
    args = parser.parse_args()
    phone = "+9190" + f"{secrets.randbelow(10**8):08d}"

    async with httpx.AsyncClient(base_url=args.api, timeout=20) as api:
        (await api.post("/v1/auth/otp/request", json={"phone_e164": phone})).raise_for_status()
        session = (await api.post("/v1/auth/otp/verify", json={"phone_e164": phone, "code": "000000"})).json()
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        before = (await api.get("/v1/wallet", headers=headers)).json()["available_paise"]
        order = (
            await api.post("/v1/wallet/topups", headers=headers, json={"amount_paise": AMOUNT_PAISE})
        ).json()
        first = (await api.post(f"/v1/dev/payments/{order['order_id']}/capture", headers=headers)).json()
        replay = (await api.post(f"/v1/dev/payments/{order['order_id']}/capture", headers=headers)).json()
        after = (await api.get("/v1/wallet", headers=headers)).json()["available_paise"]

    print(f"top-up {order['order_id']}: first={first['status']} replay={replay['status']}")
    print(f"wallet: {before} -> {after} paise (expected +{AMOUNT_PAISE})")
    async with get_sessionmaker()() as db:
        health = await verify.check(db)
    print(
        f"ledger system total: {health.system_total}, unbalanced txns: {health.unbalanced_txns}, "
        f"wallet drift rows: {len(health.drift)}"
    )
    print(f"ledger imbalance: {health.imbalance}")
    ok = first["status"] == "captured" and replay["status"] == "duplicate" and after - before == AMOUNT_PAISE
    return 0 if ok and health.ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
