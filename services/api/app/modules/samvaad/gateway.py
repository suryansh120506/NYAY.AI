"""WebSocket gateway: /ws/samvaad/{session_id}?ticket=… (brief §1.3 chat protocol, §3.3 envelope).

- Auth: a one-time ticket from POST …/ws-ticket (Redis GETDEL, 30 s). The Origin header must be an allowed web origin.
- Every inbound frame is validated (pydantic); a bad frame gets `error`, never a crash.
- `msg.send` is idempotent per client_msg_id and persisted before it is acknowledged; `resume {last_seq}` replays.
- Presence lives in Postgres (connect / ping / disconnect), so it costs no Redis requests and survives restarts.
- The server never trusts the client for money: ticks come only from the billing engine.
Chat text is never logged.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.memlimit import MemoryLimiter
from app.core.metrics import WS_CONNECTIONS
from app.core.providers import Providers
from app.db.models.enums import SessionState

from .hub import Party
from .router import ticket_key
from .schemas import MsgSend, Ping, Resume, Typing, client_event

router = APIRouter()
log = get_logger("samvaad.ws")

CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN_ORIGIN = 4403
CLOSE_SESSION_OVER = 4410
TOUCH_EVERY_SECONDS = 10
MESSAGE_RULE = "40/60"  # msg.send + typing per connection; pings are free


class WsConnection:
    def __init__(self, ws: WebSocket, party: Party) -> None:
        self.ws = ws
        self.party: Party = party
        self._lock = asyncio.Lock()

    async def send(self, event: dict[str, Any]) -> None:
        if self.ws.application_state != WebSocketState.CONNECTED:
            return
        async with self._lock:
            await self.ws.send_text(json.dumps(event, separators=(",", ":"), default=str))

    async def close(self, code: int, reason: str) -> None:
        if self.ws.application_state == WebSocketState.CONNECTED:
            await self.ws.close(code=code, reason=reason)


def _origin_allowed(providers: Providers, origin: str | None) -> bool:
    if (
        origin is None
    ):  # non-browser clients (tests, tools) send no Origin; the ticket still authenticates them
        return True
    allowed = {o.strip().rstrip("/") for o in providers.settings.web_origin.split(",") if o.strip()}
    return origin.rstrip("/") in allowed


@router.websocket("/ws/samvaad/{session_id}")
async def samvaad_socket(websocket: WebSocket, session_id: uuid.UUID, ticket: str = "") -> None:
    providers: Providers = websocket.app.state.providers
    if not _origin_allowed(providers, websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_FORBIDDEN_ORIGIN)
        return
    await websocket.accept()
    entry = await providers.redis.getdel(ticket_key(ticket)) if ticket else None
    parts = str(entry).split(":") if entry else []
    if len(parts) != 3 or parts[0] != str(session_id) or parts[2] not in ("user", "advocate"):
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="bad_ticket")
        return
    user_id, party = uuid.UUID(parts[1]), parts[2]
    assert party in ("user", "advocate")
    await _serve(websocket, providers, session_id, user_id, party)  # type: ignore[arg-type]


async def _serve(
    ws: WebSocket, providers: Providers, session_id: uuid.UUID, user_id: uuid.UUID, party: Party
) -> None:
    service = providers.samvaad
    hub = providers.hub
    other: Party = "advocate" if party == "user" else "user"
    sid = str(session_id)

    s = await service.touch(session_id, party, delta=1)
    if s is None or s.state in (SessionState.SETTLED, SessionState.CANCELLED):
        await service.touch(session_id, party, delta=-1)
        await ws.close(code=CLOSE_SESSION_OVER, reason="session_over")
        return

    conn = WsConnection(ws, party)
    hub.add(sid, conn)
    WS_CONNECTIONS.inc()
    limiter = MemoryLimiter()
    last_touch = time.monotonic()
    timeout = providers.settings.heartbeat_timeout_seconds + 15
    try:
        for initial in await service.snapshot_events(s, party):
            await conn.send(initial)
        await hub.publish(sid, {"type": "presence", "party": party, "online": True}, to=other)
        await service.maybe_go_live(session_id)

        while True:
            message = await asyncio.wait_for(ws.receive(), timeout=timeout)
            if message["type"] == "websocket.disconnect":
                break
            raw = message.get("text")
            if raw is None:
                await conn.send({"type": "error", "code": "invalid_message"})
                continue
            try:
                event = client_event.validate_json(raw)
            except ValidationError:
                await conn.send({"type": "error", "code": "invalid_message"})
                continue

            if isinstance(event, Ping):
                await conn.send({"type": "pong"})
                if time.monotonic() - last_touch >= TOUCH_EVERY_SECONDS:
                    await service.touch(session_id, party)
                    last_touch = time.monotonic()
                continue
            if isinstance(event, Resume):
                for m in await service.messages_after(session_id, event.last_seq):
                    sender: Party = "user" if m.sender_id == s.user_id else "advocate"
                    await conn.send(
                        {
                            "type": "msg.new",
                            "seq": m.seq,
                            "from": sender,
                            "text": m.body,
                            "ts": m.created_at.isoformat(),
                        }
                    )
                continue
            try:
                limiter.check("msg", MESSAGE_RULE)
            except AppError:
                await conn.send({"type": "error", "code": "rate_limited"})
                continue
            if isinstance(event, Typing):
                await hub.publish(sid, {"type": "typing", "party": party, "on": event.on}, to=other)
            elif isinstance(event, MsgSend):
                text = event.text.strip()
                if not text:
                    await conn.send({"type": "error", "code": "invalid_message"})
                    continue
                try:
                    stored, created = await service.post_message(
                        session_id, user_id, event.client_msg_id, text
                    )
                except AppError as exc:
                    await conn.send({"type": "error", "code": exc.code})
                    continue
                ts = stored.created_at.isoformat()
                await conn.send(
                    {"type": "msg.ack", "client_msg_id": event.client_msg_id, "seq": stored.seq, "ts": ts}
                )
                if created:
                    await hub.publish(
                        sid,
                        {"type": "msg.new", "seq": stored.seq, "from": party, "text": stored.body, "ts": ts},
                        exclude=conn,
                    )
    except (WebSocketDisconnect, TimeoutError, asyncio.CancelledError):
        pass
    except Exception as exc:
        log.exception("ws.error", error=type(exc).__name__)
    finally:
        hub.remove(sid, conn)
        WS_CONNECTIONS.dec()
        await conn.close(1000, "bye")
        await asyncio.shield(_after_disconnect(providers, session_id, party, other))


async def _after_disconnect(providers: Providers, session_id: uuid.UUID, party: Party, other: Party) -> None:
    service = providers.samvaad
    sid = str(session_id)
    try:
        s = await service.touch(session_id, party, delta=-1)
        if providers.hub.has(sid, party) or s is None:
            return
        await providers.hub.publish(sid, {"type": "presence", "party": party, "online": False}, to=other)
        if s.state == SessionState.LIVE:
            delay = providers.settings.heartbeat_timeout_seconds + 1

            async def check() -> None:
                await asyncio.sleep(delay)
                await service.check_presence_timeout(session_id)

            service.spawn(check())
    except Exception as exc:
        log.warning("ws.disconnect_cleanup_failed", error=type(exc).__name__)
