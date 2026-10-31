"""Audio/video calls (brief §4 step 3.8): an interface plus a LiveKit implementation, off unless ENABLE_CALLS=true.

The API only mints short-lived room tokens; media never passes through it. Billing is the same per-minute meter as
chat, so a call costs nothing extra in Redis.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol

import jwt


@dataclass(frozen=True, slots=True)
class CallToken:
    url: str
    token: str
    room: str
    expires_in: int


class CallProvider(Protocol):
    name: str

    def token(self, *, room: str, identity: str, display_name: str, ttl_seconds: int = 900) -> CallToken: ...


class LiveKitProvider:
    """LiveKit access token: an HS256 JWT signed with the API secret (LiveKit's documented token format)."""

    name = "livekit"

    def __init__(self, *, url: str, api_key: str, api_secret: str) -> None:
        if not (url and api_key and api_secret):
            raise ValueError(
                "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required when ENABLE_CALLS=true"
            )
        self._url, self._key, self._secret = url, api_key, api_secret

    def token(self, *, room: str, identity: str, display_name: str, ttl_seconds: int = 900) -> CallToken:
        now = int(time.time())
        claims = {
            "iss": self._key,
            "sub": identity,
            "name": display_name,
            "nbf": now - 5,
            "exp": now + ttl_seconds,
            "video": {"room": room, "roomJoin": True, "canPublish": True, "canSubscribe": True},
        }
        return CallToken(
            url=self._url,
            token=jwt.encode(claims, self._secret, algorithm="HS256"),
            room=room,
            expires_in=ttl_seconds,
        )
