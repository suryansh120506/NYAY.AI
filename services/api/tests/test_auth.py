from __future__ import annotations

import httpx

from app.modules.auth.router import REFRESH_COOKIE

from .api_harness import random_phone, sign_in


async def test_otp_sign_in_creates_user_and_wallet(api: httpx.AsyncClient) -> None:
    token, body = await sign_in(api)
    user = body["user"]
    assert isinstance(user, dict)
    assert user["phone_masked"].startswith("+91••••••")  # never returned in full
    wallet = await api.get("/v1/wallet", headers={"Authorization": f"Bearer {token}"})
    assert wallet.json() == {"available_paise": 0, "held_paise": 0, "bonus_paise": 0}


async def test_wrong_code_and_attempt_limit(api: httpx.AsyncClient) -> None:
    phone = random_phone()
    await api.post("/v1/auth/otp/request", json={"phone_e164": phone})
    for _ in range(5):
        r = await api.post("/v1/auth/otp/verify", json={"phone_e164": phone, "code": "123456"})
        assert r.status_code == 401 and r.json()["code"] == "invalid_otp"
    # Too many attempts burns the code: even the right one now fails until a new code is requested.
    r = await api.post("/v1/auth/otp/verify", json={"phone_e164": phone, "code": "000000"})
    assert r.status_code == 401


async def test_resend_cooldown(api: httpx.AsyncClient) -> None:
    phone = random_phone()
    assert (await api.post("/v1/auth/otp/request", json={"phone_e164": phone})).status_code == 200
    again = await api.post("/v1/auth/otp/request", json={"phone_e164": phone})
    assert again.status_code == 429 and again.json()["code"] == "rate_limited"


async def test_rejects_non_indian_numbers(api: httpx.AsyncClient) -> None:
    r = await api.post("/v1/auth/otp/request", json={"phone_e164": "+15551234567"})
    assert r.status_code == 422


async def test_refresh_rotates_and_detects_reuse(api: httpx.AsyncClient) -> None:
    await sign_in(api)
    first = api.cookies.get(REFRESH_COOKIE)
    assert first
    r = await api.post("/v1/auth/refresh")
    assert r.status_code == 200 and r.json()["access_token"]
    second = api.cookies.get(REFRESH_COOKIE)
    assert second and second != first
    # Replaying the rotated token ends every session for the user...
    api.cookies.set(REFRESH_COOKIE, first, path="/v1/auth")
    assert (await api.post("/v1/auth/refresh")).status_code == 401
    # ...including the newest one.
    api.cookies.set(REFRESH_COOKIE, second, path="/v1/auth")
    assert (await api.post("/v1/auth/refresh")).status_code == 401


async def test_logout_revokes_refresh_token(api: httpx.AsyncClient) -> None:
    await sign_in(api)
    token = api.cookies.get(REFRESH_COOKIE)
    assert (await api.post("/v1/auth/logout")).status_code == 204
    api.cookies.set(REFRESH_COOKIE, token or "", path="/v1/auth")
    assert (await api.post("/v1/auth/refresh")).status_code == 401


async def test_bad_or_missing_token(api: httpx.AsyncClient) -> None:
    assert (await api.get("/v1/wallet")).status_code == 401
    assert (await api.get("/v1/wallet", headers={"Authorization": "Bearer nope"})).status_code == 401


async def test_roles_are_enforced(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    r = await api.get("/v1/admin/ledger/health", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


async def test_consent_and_dpdp_endpoints(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    headers = {"Authorization": f"Bearer {token}"}
    r = await api.post(
        "/v1/me/consents",
        headers=headers,
        json={"purpose": "document_processing", "granted": True, "policy_version": "draft-1"},
    )
    assert r.status_code == 201
    export = (await api.post("/v1/me/export", headers=headers)).json()
    assert export["consents"][0]["purpose"] == "document_processing"
    r = await api.post("/v1/me/delete-request", headers=headers)
    assert r.status_code == 202 and r.json()["status"] == "deletion_requested"


async def test_sliding_window_rate_limit() -> None:
    import uuid

    from app.core.errors import AppError
    from app.core.ratelimit import enforce

    from .api_harness import flushable_redis as get_redis

    redis, identity = get_redis(), uuid.uuid4().hex
    for _ in range(3):
        await enforce(redis, scope="test", identity=identity, rule="3/60")
    try:
        await enforce(redis, scope="test", identity=identity, rule="3/60")
    except AppError as exc:
        assert exc.code == "rate_limited" and int(exc.details["retry_after"]) > 0
    else:
        raise AssertionError("the 4th request inside the window must be refused")


def test_uvicorn_log_lines_lose_their_query_strings() -> None:
    import logging

    from app.core.logging import StripQueryStrings

    record = logging.LogRecord(
        "uvicorn.error",
        logging.INFO,
        __file__,
        1,
        '%s - "WebSocket %s" [accepted]',
        ("127.0.0.1:5", "/ws/samvaad/abc?ticket=SECRET"),
        None,
    )
    StripQueryStrings().filter(record)
    assert "SECRET" not in record.getMessage() and "/ws/samvaad/abc" in record.getMessage()
