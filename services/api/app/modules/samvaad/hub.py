"""Who is connected to which consultation, and how events reach them (brief §1.3 chat protocol).

`WS_FANOUT=local` (default): one API instance; every event is delivered in-process and costs no Redis request.
`WS_FANOUT=redis`: several API instances; events are also PUBLISHed on `ws:{session}` and every instance relays
the ones it didn't send to its own sockets (one PSUBSCRIBE per instance).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from redis.asyncio import Redis

from app.core.logging import get_logger

Party = Literal["user", "advocate"]
Audience = Literal["all", "user", "advocate"]
log = get_logger("samvaad.hub")


class Connection(Protocol):
    party: Party

    async def send(self, event: dict[str, Any]) -> None: ...

    async def close(self, code: int, reason: str) -> None: ...


@dataclass
class SessionHub:
    redis: Redis | None = None
    mode: Literal["local", "redis"] = "local"
    instance: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    _local: dict[str, set[Connection]] = field(default_factory=lambda: defaultdict(set))
    _relay: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------------------------------- registry
    def add(self, session_id: str, conn: Connection) -> None:
        self._local[session_id].add(conn)

    def remove(self, session_id: str, conn: Connection) -> None:
        conns = self._local.get(session_id)
        if conns is None:
            return
        conns.discard(conn)
        if not conns:
            del self._local[session_id]

    def has(self, session_id: str, party: Party) -> bool:
        return any(c.party == party for c in self._local.get(session_id, ()))

    def connection_count(self) -> int:
        return sum(len(c) for c in self._local.values())

    # ------------------------------------------------------------------------------------------- delivery
    async def publish(
        self,
        session_id: str,
        event: dict[str, Any],
        *,
        to: Audience = "all",
        exclude: Connection | None = None,
        close: tuple[int, str] | None = None,
    ) -> None:
        await self._deliver(session_id, event, to=to, exclude=exclude, close=close)
        if self.mode == "redis" and self.redis is not None:
            payload = {"origin": self.instance, "to": to, "event": event, "close": close}
            try:
                await self.redis.publish(f"ws:{session_id}", json.dumps(payload, separators=(",", ":")))
            except Exception as exc:  # delivery is best effort; state is always recoverable from Postgres
                log.warning("hub.publish_failed", error=type(exc).__name__)

    async def _deliver(
        self,
        session_id: str,
        event: dict[str, Any],
        *,
        to: Audience,
        exclude: Connection | None,
        close: tuple[int, str] | None,
    ) -> None:
        for conn in list(self._local.get(session_id, ())):
            if conn is exclude or (to != "all" and conn.party != to):
                continue
            try:
                await conn.send(event)
                if close is not None:
                    await conn.close(*close)
            except Exception as exc:  # a dead socket is cleaned up by its own handler
                log.debug("hub.deliver_failed", error=type(exc).__name__)

    # ---------------------------------------------------------------------------------------- redis relay
    def start_relay(self, on_error: Callable[[Exception], Awaitable[None]] | None = None) -> None:
        if self.mode != "redis" or self.redis is None or self._relay is not None:
            return
        self._relay = asyncio.create_task(self._run_relay())

    async def _run_relay(self) -> None:
        assert self.redis is not None
        while True:
            try:
                pubsub = self.redis.pubsub()
                await pubsub.psubscribe("ws:*")
                async for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    payload = json.loads(message["data"])
                    if payload.get("origin") == self.instance:
                        continue
                    session_id = str(message["channel"]).removeprefix("ws:")
                    close = payload.get("close")
                    await self._deliver(
                        session_id,
                        payload["event"],
                        to=payload.get("to", "all"),
                        exclude=None,
                        close=(int(close[0]), str(close[1])) if close else None,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("hub.relay_error", error=type(exc).__name__)
                await asyncio.sleep(2)

    async def aclose(self) -> None:
        if self._relay is not None:
            self._relay.cancel()
            self._relay = None
