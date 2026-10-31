"""Google Gemini (generateContent). The API key goes in a header, never in the URL, so it can't leak into logs.

TODO(human): verify GEMINI_MODEL against the current model list; the request shape follows the public v1beta API.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .base import LlmError

# Gemini's responseSchema accepts an OpenAPI subset; drop JSON Schema keywords it rejects.
_UNSUPPORTED = {"additionalProperties", "$schema", "title", "default"}


def _to_gemini_schema(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {k: _to_gemini_schema(v) for k, v in schema.items() if k not in _UNSUPPORTED}
    if isinstance(schema, list):
        return [_to_gemini_schema(v) for v in schema]
    return schema


class GeminiLlm:
    name = "gemini"

    def __init__(self, *, api_key: str, model: str, base_url: str, client: httpx.AsyncClient) -> None:
        if not api_key or not model:
            raise ValueError("GEMINI_API_KEY and GEMINI_MODEL are required for LLM_PROVIDER=gemini")
        self._key, self._model, self._base, self._client = api_key, model, base_url.rstrip("/"), client

    async def json(self, *, system: str, user: str, schema: dict[str, Any], timeout: float) -> dict[str, Any]:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": _to_gemini_schema(schema),
            },
        }
        try:
            response = await self._client.post(
                f"{self._base}/models/{self._model}:generateContent",
                json=body,
                headers={"x-goog-api-key": self._key},
                timeout=timeout,
            )
            response.raise_for_status()
            text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text)
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise LlmError(f"gemini: {type(exc).__name__}") from exc
        if not isinstance(parsed, dict):
            raise LlmError("gemini: expected a JSON object")
        return parsed
