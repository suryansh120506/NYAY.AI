"""VectorStore interface (brief §1.3): callers never know whether it is pgvector, Chroma or memory."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


class VectorStoreError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class VectorRecord:
    advocate_id: uuid.UUID
    document: str
    embedding: list[float]
    embedding_version: str
    primary_court_code: str | None
    is_verified: bool


@dataclass(frozen=True, slots=True)
class VectorHit:
    advocate_id: uuid.UUID
    similarity: float  # 1 - cosine distance


class VectorStore(Protocol):
    async def upsert(self, records: Sequence[VectorRecord]) -> None: ...

    async def query(
        self, embedding: list[float], *, candidate_ids: Sequence[uuid.UUID], top_k: int
    ) -> list[VectorHit]: ...

    async def delete(self, advocate_ids: Sequence[uuid.UUID]) -> None: ...
