"""Tokens: 15-minute access JWT, opaque rotating refresh tokens (stored hashed), signed visitor ids."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from .config import Settings

ALGORITHM = "HS256"


@dataclass(frozen=True, slots=True)
class AccessClaims:
    user_id: uuid.UUID
    role: str
    expires_at: datetime


def issue_access_token(settings: Settings, *, user_id: uuid.UUID, role: str) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires = now + timedelta(seconds=settings.access_token_ttl_seconds)
    token = jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "iat": int(now.timestamp()),
            "exp": int(expires.timestamp()),
            "typ": "access",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=ALGORITHM,
    )
    return token, expires


def decode_access_token(settings: Settings, token: str) -> AccessClaims | None:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[ALGORITHM],
            options={"require": ["sub", "exp", "role"]},
        )
    except jwt.PyJWTError:
        return None
    if claims.get("typ") != "access":
        return None
    try:
        return AccessClaims(
            uuid.UUID(claims["sub"]), str(claims["role"]), datetime.fromtimestamp(claims["exp"], UTC)
        )
    except (ValueError, KeyError):
        return None


def new_refresh_token() -> tuple[str, str]:
    """(token for the cookie, sha256 hash for the database). The raw token is never stored."""
    token = secrets.token_urlsafe(48)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------------------------------- visitor cookie
def _mac(settings: Settings, value: str) -> str:
    digest = hmac.new(
        settings.visitor_cookie_secret.get_secret_value().encode(), value.encode(), hashlib.sha256
    )
    return base64.urlsafe_b64encode(digest.digest()[:18]).decode().rstrip("=")


def new_visitor_cookie(settings: Settings) -> tuple[str, str]:
    visitor_id = secrets.token_hex(12)
    return visitor_id, f"{visitor_id}.{_mac(settings, visitor_id)}"


def read_visitor_cookie(settings: Settings, cookie: str | None) -> str | None:
    if not cookie or "." not in cookie:
        return None
    visitor_id, mac = cookie.rsplit(".", 1)
    return visitor_id if hmac.compare_digest(mac, _mac(settings, visitor_id)) else None


def hash_otp(phone_e164: str, code: str, settings: Settings) -> str:
    """OTP codes are stored only as a keyed hash, scoped to the phone number."""
    key = settings.jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"{phone_e164}:{code}".encode(), hashlib.sha256).hexdigest()
