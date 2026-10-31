from __future__ import annotations

import uuid
from collections.abc import Sequence

from .base import VectorHit, VectorRecord, VectorStoreError


class MemoryVectorStore:
    """Tests only. Setting `fail = True` simulates an outage to exercise Parakh's degraded mode."""

    def __init__(self) -> None:
        self.records: dict[uuid.UUID, VectorRecord] = {}
        self.fail = False

    async def upsert(self, records: Sequence[VectorRecord]) -> None:
        self._check()
        for record in records:
            self.records[record.advocate_id] = record

    async def query(
        self, embedding: list[float], *, candidate_ids: Sequence[uuid.UUID], top_k: int
    ) -> list[VectorHit]:
        self._check()
        hits = [
            VectorHit(rid, sum(a * b for a, b in zip(embedding, rec.embedding, strict=True)))
            for rid in candidate_ids
            if (rec := self.records.get(rid)) is not None
        ]
        return sorted(hits, key=lambda h: h.similarity, reverse=True)[:top_k]

    async def delete(self, advocate_ids: Sequence[uuid.UUID]) -> None:
        self._check()
        for rid in advocate_ids:
            self.records.pop(rid, None)

    def _check(self) -> None:
        if self.fail:
            raise VectorStoreError("memory vector store: simulated outage")
