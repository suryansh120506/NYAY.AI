"""OTP delivery. Only the fake exists until an SMS provider is chosen (TODO(human)).

Brief §1.4: the fake prints the OTP to the API log and accepts 000000, and only when ENV=dev/test.
"""

from __future__ import annotations

import secrets
from typing import Protocol

from app.core.logging import get_logger, mask_phone

log = get_logger("otp")


class OtpProvider(Protocol):
    name: str

    def generate(self) -> str: ...

    async def send(self, phone_e164: str, code: str) -> None: ...


class FakeOtpProvider:
    name = "fake"

    def __init__(self, *, dev: bool) -> None:
        if not dev:
            raise RuntimeError("The fake OTP provider is only allowed when ENV is dev or test")

    def generate(self) -> str:
        return "000000"

    async def send(self, phone_e164: str, code: str) -> None:
        # The one place a code is logged, allowed by the brief for the dev fake only.
        log.info("otp.fake_sent", phone=mask_phone(phone_e164), dev_otp=code)


def random_code() -> str:
    """For real providers: 6 digits from a CSPRNG."""
    return f"{secrets.randbelow(1_000_000):06d}"
