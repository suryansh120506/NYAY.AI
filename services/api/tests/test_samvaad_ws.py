"""Samvaad over real WebSockets: the API runs in-process under uvicorn; a user and an advocate connect with tickets."""

from __future__ import annotations

import asyncio
import json
import socket
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import uvicorn
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from app.core.providers import Providers
from app.db.models.tables import Message, User
from app.ledger import operations

from .api_harness import flushable_redis, make_providers, new_app, settings_for_tests
from .test_samvaad_billing import make_advocate


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
async def server(
    sessionmaker: async_sessionmaker[AsyncSession], migrated_database: str, seeded: dict[str, object]
) -> AsyncIterator[tuple[str, Providers]]:
    await flushable_redis().flushdb()
    settings = settings_for_tests(migrated_database)
    providers = make_providers(settings, sessionmaker)
    app = new_app(settings, providers)
    app.state.providers = providers
    port = _free_port()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", lifespan="off", ws="websockets-sansio"
    )
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:  # noqa: ASYNC110 - uvicorn exposes a flag, not an event
        await asyncio.sleep(0.02)
    yield f"127.0.0.1:{port}", providers
    srv.should_exit = True
    await task
    await providers.aclose()


async def sign_in(http: httpx.AsyncClient, phone: str) -> str:
    assert (await http.post("/v1/auth/otp/request", json={"phone_e164": phone})).status_code == 200
    r = await http.post("/v1/auth/otp/verify", json={"phone_e164": phone, "code": "000000"})
    assert r.status_code == 200, r.text
    return str(r.json()["access_token"])


def phone() -> str:
    return "+919" + str(uuid.uuid4().int)[:9]


async def recv(ws: ClientConnection, kind: str, timeout: float = 5) -> dict[str, Any]:
    async with asyncio.timeout(timeout):
        while True:
            event: dict[str, Any] = json.loads(await ws.recv())
            if event["type"] == kind:
                return event


async def test_user_and_advocate_chat_and_settle(server: tuple[str, Providers], db: AsyncSession) -> None:
    host, _providers = server
    base = f"http://{host}"
    async with httpx.AsyncClient(base_url=base) as http:
        user_token = await sign_in(http, user_phone := phone())
        advocate_phone = phone()
        advocate_token = await sign_in(http, advocate_phone)
        user_id = await db.scalar(select(User.id).where(User.phone_e164 == user_phone))
        advocate_id = await db.scalar(select(User.id).where(User.phone_e164 == advocate_phone))
        assert user_id and advocate_id
        await db.commit()
        # Promote the second account to a verified advocate and fund the user.
        from sqlalchemy import text

        async with db.begin():
            await db.execute(
                text("UPDATE users SET role='advocate', display_name='Demo Test Advocate' WHERE id=:id"),
                {"id": advocate_id},
            )
            await db.execute(
                text(
                    "INSERT INTO advocate_profiles (user_id, enrolment_no, state_bar_council, verification_status,"
                    " rate_paise_per_min, is_available) VALUES (:id, :e, 'Test Bar', 'verified', 1000, true)"
                ),
                {"id": advocate_id, "e": f"TEST/{uuid.uuid4().hex[:8]}"},
            )
            await operations.topup(db, user_id=user_id, amount=50_000, idempotency_key=f"ws-test:{user_id}")
        ua = {"Authorization": f"Bearer {user_token}"}
        aa = {"Authorization": f"Bearer {advocate_token}"}

        r = await http.post("/v1/samvaad/sessions", json={"advocate_id": str(advocate_id)}, headers=ua)
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        assert r.json()["state"] == "RESERVED" and r.json()["viewer"] == "user"

        # The advocate sees the request on their dashboard, with no phone number in it.
        r = await http.get("/v1/advocate/sessions", headers=aa)
        assert r.status_code == 200 and r.json()[0]["id"] == sid
        assert "+91" not in r.text

        # Bad ticket → 4401.
        with pytest.raises(ConnectionClosed) as closed:
            async with connect(f"ws://{host}/ws/samvaad/{sid}?ticket=nope") as bad:
                await bad.recv()
        assert closed.value.rcvd is not None and closed.value.rcvd.code == 4401

        async def ticket(headers: dict[str, str]) -> str:
            r = await http.post(f"/v1/samvaad/sessions/{sid}/ws-ticket", headers=headers)
            assert r.status_code == 200, r.text
            return str(r.json()["ticket"])

        r = await http.post(
            f"/v1/samvaad/sessions/{sid}/start",
            json={"chat_storage_consent": True, "keep_transcript": False},
            headers=ua,
        )
        assert r.status_code == 200 and r.json()["state"] == "RESERVED"

        async with connect(f"ws://{host}/ws/samvaad/{sid}?ticket={await ticket(ua)}") as user_ws:
            presence = await recv(user_ws, "presence")
            assert presence == {"type": "presence", "party": "advocate", "online": False}
            # A ticket is single-use.
            used = await ticket(ua)
            async with connect(f"ws://{host}/ws/samvaad/{sid}?ticket={used}"):
                pass
            with pytest.raises(ConnectionClosed):
                async with connect(f"ws://{host}/ws/samvaad/{sid}?ticket={used}") as again:
                    await again.recv()

            async with connect(f"ws://{host}/ws/samvaad/{sid}?ticket={await ticket(aa)}") as adv_ws:
                started = await recv(user_ws, "session.started")
                assert started["started_at"]
                tick = await recv(user_ws, "session.tick")
                assert tick["minute"] == 2 and tick["balance_paise"] == 50_000 - 2 * 1590
                await recv(adv_ws, "session.started")

                await user_ws.send(json.dumps({"type": "typing", "on": True}))
                assert (await recv(adv_ws, "typing"))["party"] == "user"
                await user_ws.send(json.dumps({"type": "msg.send", "client_msg_id": "c1", "text": "Hello"}))
                ack = await recv(user_ws, "msg.ack")
                assert ack["client_msg_id"] == "c1" and ack["seq"] == 1
                got = await recv(adv_ws, "msg.new")
                assert (got["from"], got["text"], got["seq"]) == ("user", "Hello", 1)
                # Retried send (same client_msg_id): acked again with the same seq, not delivered twice.
                await user_ws.send(json.dumps({"type": "msg.send", "client_msg_id": "c1", "text": "Hello"}))
                assert (await recv(user_ws, "msg.ack"))["seq"] == 1
                await adv_ws.send(json.dumps({"type": "msg.send", "client_msg_id": "a1", "text": "Namaste"}))
                assert (await recv(user_ws, "msg.new"))["seq"] == 2
                # Malformed frames get an error, not a crash.
                await user_ws.send("{not json")
                assert (await recv(user_ws, "error"))["code"] == "invalid_message"
                await user_ws.send(json.dumps({"type": "ping"}))
                await recv(user_ws, "pong")
                # Resume replays everything after last_seq.
                await user_ws.send(json.dumps({"type": "resume", "last_seq": 0}))
                replay = [await recv(user_ws, "msg.new"), await recv(user_ws, "msg.new")]
                assert [m["seq"] for m in replay] == [1, 2]

                r = await http.post(f"/v1/samvaad/sessions/{sid}/end", headers=ua)
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["state"] == "SETTLED" and body["end_reason"] == "user_ended"
                assert body["used_seconds"] is not None and body["refunded_paise"] > 0
                assert body["consumed_paise"] == 2 * 1590 - body["refunded_paise"]
                terminated = await recv(adv_ws, "session.terminated")
                assert terminated["reason"] == "user_ended"
                with pytest.raises(ConnectionClosed) as over:
                    await adv_ws.recv()
                assert over.value.rcvd is not None and over.value.rcvd.code == 4410

        # Messages are stored with the 30-day retention (transcript not kept).
        stored = (await db.scalars(select(Message).where(Message.session_id == uuid.UUID(sid)))).all()
        assert len(stored) == 2 and all(m.delete_after is not None for m in stored)
        await db.commit()

        r = await http.post(
            f"/v1/samvaad/sessions/{sid}/rating", json={"rating": 5, "tags": ["clear"]}, headers=ua
        )
        assert r.status_code == 204
        r = await http.get("/v1/advocate/earnings", headers=aa)
        assert r.status_code == 200 and r.json()["payable_paise"] == 1000 * body["used_seconds"] // 60
        r = await http.get("/v1/wallet/history", headers=ua)
        consult = [t for t in r.json() if t["kind"] == "consultation"]
        assert (
            consult and consult[0]["amount_paise"] == -body["consumed_paise"] and consult[0]["minutes"] == 2
        )


async def test_advocate_settings_and_role_checks(server: tuple[str, Providers], db: AsyncSession) -> None:
    host, _ = server
    async with httpx.AsyncClient(base_url=f"http://{host}") as http:
        token = await sign_in(http, phone())
        h = {"Authorization": f"Bearer {token}"}
        assert (await http.get("/v1/advocate/me", headers=h)).status_code == 403
        advocate_id = await make_advocate(db)
        # Sign-in by the advocate's phone.
        advocate_phone = await db.scalar(select(User.phone_e164).where(User.id == advocate_id))
        await db.commit()
        assert advocate_phone
        a = {"Authorization": f"Bearer {await sign_in(http, advocate_phone)}"}
        me = (await http.get("/v1/advocate/me", headers=a)).json()
        assert me["verification_status"] == "verified"
        r = await http.patch("/v1/advocate/availability", json={"is_available": False}, headers=a)
        assert r.json()["is_available"] is False
        assert (
            await http.patch("/v1/advocate/rate", json={"rate_paise_per_min": 1}, headers=a)
        ).status_code == 422
        r = await http.patch("/v1/advocate/rate", json={"rate_paise_per_min": 2500}, headers=a)
        assert r.json()["rate_paise_per_min"] == 2500
