"""LLM provider interface. Callers ask for JSON that matches a schema; output is validated before use.

Brief rule 9: models only summarise, extract and match. Prompts never ask for advice or predictions.
"""

from __future__ import annotations

from typing import Any, Protocol


class LlmError(Exception):
    """Any provider failure: network, timeout, refusal, or output that doesn't parse."""


class LlmProvider(Protocol):
    name: str

    async def json(self, *, system: str, user: str, schema: dict[str, Any], timeout: float) -> dict[str, Any]:
        """Temperature 0, JSON-only response conforming to `schema` (validated by the caller)."""
        ...
