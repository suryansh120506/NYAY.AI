from __future__ import annotations

from typing import Any

from .base import LlmError


class FakeLlm:
    """Offline stand-in. Raises, so callers exercise their deterministic fallbacks (keyword intent, templates)."""

    name = "fake"

    async def json(self, *, system: str, user: str, schema: dict[str, Any], timeout: float) -> dict[str, Any]:
        raise LlmError("fake LLM: use the deterministic fallback")
