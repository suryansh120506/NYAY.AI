"""Gemini embeddings (batchEmbedContents) with a fixed output dimensionality.

TODO(human): verify GEMINI_EMBEDDING_MODEL supports `outputDimensionality` = EMBEDDING_DIM.
"""

from __future__ import annotations

import math

import httpx

from .base import EmbeddingError, Task

_TASK = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}
_BATCH = 100


class GeminiEmbedder:
    def __init__(
        self, *, api_key: str, model: str, dim: int, base_url: str, client: httpx.AsyncClient
    ) -> None:
        if not api_key or not model:
            raise ValueError(
                "GEMINI_API_KEY and GEMINI_EMBEDDING_MODEL are required for EMBEDDINGS_PROVIDER=gemini"
            )
        self._key, self._model, self._base, self._client = api_key, model, base_url.rstrip("/"), client
        self.dim = dim
        self.version = f"gemini:{model}:{dim}"

    async def embed(self, texts: list[str], *, task: Task) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), _BATCH):
            chunk = texts[start : start + _BATCH]
            body = {
                "requests": [
                    {
                        "model": f"models/{self._model}",
                        "content": {"parts": [{"text": text}]},
                        "taskType": _TASK[task],
                        "outputDimensionality": self.dim,
                    }
                    for text in chunk
                ]
            }
            try:
                response = await self._client.post(
                    f"{self._base}/models/{self._model}:batchEmbedContents",
                    json=body,
                    headers={"x-goog-api-key": self._key},
                    timeout=20,
                )
                response.raise_for_status()
                vectors = [item["values"] for item in response.json()["embeddings"]]
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                raise EmbeddingError(f"gemini embeddings: {type(exc).__name__}") from exc
            for values in vectors:
                if len(values) != self.dim:
                    raise EmbeddingError(f"expected {self.dim} dimensions, got {len(values)}")
                norm = math.sqrt(sum(v * v for v in values)) or 1.0
                out.append([float(v) / norm for v in values])
        return out
