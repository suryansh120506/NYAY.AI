from __future__ import annotations

from typing import Any

from app.core.logging import get_logger

from .base import LlmError, LlmProvider

log = get_logger("llm")


class LlmChain:
    """Primary, then fallback. Each call raises LlmError if every provider fails, so callers degrade gracefully."""

    def __init__(self, providers: list[LlmProvider]) -> None:
        self.providers = providers
        self.name = "+".join(p.name for p in providers) or "none"

    async def json(self, *, system: str, user: str, schema: dict[str, Any], timeout: float) -> dict[str, Any]:
        for provider in self.providers:
            try:
                return await provider.json(system=system, user=user, schema=schema, timeout=timeout)
            except LlmError as exc:
                log.warning("llm.provider_failed", provider=provider.name, reason=str(exc))
        raise LlmError("all LLM providers failed")
