from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.core.logging import mask_phone
from app.core.schemas import ApiModel
from app.db.models.tables import User

PhoneE164 = Annotated[str, StringConstraints(pattern=r"^\+91[6-9]\d{9}$")]
OtpCode = Annotated[str, StringConstraints(pattern=r"^\d{6}$")]


class OtpRequestIn(ApiModel):
    phone_e164: PhoneE164


class OtpRequestOut(ApiModel):
    resend_after_seconds: int


class OtpVerifyIn(ApiModel):
    phone_e164: PhoneE164
    code: OtpCode


class AuthUser(ApiModel):
    """Mirrors `AuthUser` in apps/web/lib/api/types.ts. The phone number is only ever returned masked."""

    id: uuid.UUID
    phone_masked: str
    display_name: str | None
    role: Literal["user", "advocate", "admin"]
    preferred_lang: Literal["en", "hi"]
    is_premium: bool

    @classmethod
    def of(cls, user: User) -> AuthUser:
        return cls(
            id=user.id,
            phone_masked=mask_phone(user.phone_e164),
            display_name=user.display_name,
            role=user.role.value,
            preferred_lang=user.preferred_lang.value,
            is_premium=user.is_premium,
        )


class AuthSession(ApiModel):
    user: AuthUser
    access_token: str = Field(description="Bearer token, valid for ACCESS_TOKEN_TTL_SECONDS")
    expires_at: datetime
