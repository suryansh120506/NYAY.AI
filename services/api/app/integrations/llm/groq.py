"""Groq (OpenAI-compatible chat completions, JSON mode).

TODO(human): verify GROQ_MODEL against the current model list.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .base import LlmError


class GroqLlm:
    name = "groq"

    def __init__(self, *, api_key: str, model: str, base_url: str, client: httpx.AsyncClient) -> None:
        if not api_key or not model:
            raise ValueError("GROQ_API_KEY and GROQ_MODEL are required for LLM_PROVIDER=groq")
        self._key, self._model, self._base, self._client = api_key, model, base_url.rstrip("/"), client

    async def json(self, *, system: str, user: str, schema: dict[str, Any], timeout: float) -> dict[str, Any]:
        # JSON mode guarantees an object; the schema is stated in the system prompt and validated by the caller.
        body = {
            "model": self._model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": f"{system}\n\nRespond with JSON matching this schema:\n{json.dumps(schema)}",
                },
                {"role": "user", "content": user},
            ],
        }
        try:
            response = await self._client.post(
                f"{self._base}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=timeout,
            )
            response.raise_for_status()
            parsed = json.loads(response.json()["choices"][0]["message"]["content"])
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise LlmError(f"groq: {type(exc).__name__}") from exc
        if not isinstance(parsed, dict):
            raise LlmError("groq: expected a JSON object")
        return parsed
