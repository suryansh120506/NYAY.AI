from __future__ import annotations

from typing import Literal, Protocol

Task = Literal["document", "query"]


class EmbeddingError(Exception):
    pass


class Embedder(Protocol):
    """Multilingual text → unit vector of `dim` floats. `version` changes whenever vectors become incomparable."""

    dim: int
    version: str

    async def embed(self, texts: list[str], *, task: Task) -> list[list[float]]: ...
