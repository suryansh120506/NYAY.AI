"""pgvector in the main Postgres (Supabase): table `advocate_embeddings`, cosine distance (docs/ASSUMPTIONS.md A47).

The candidate filter is an IN on the primary key, the equivalent of Chroma's `where advocate_id $in [...]`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models.tables import AdvocateEmbedding

from .base import VectorHit, VectorRecord, VectorStoreError

_UPDATABLE = ("document", "embedding", "embedding_version", "primary_court_code", "is_verified")


class PgVectorStore:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessionmaker

    async def upsert(self, records: Sequence[VectorRecord]) -> None:
        if not records:
            return
        rows = [
            {
                "advocate_id": r.advocate_id,
                "document": r.document,
                "embedding": r.embedding,
                "embedding_version": r.embedding_version,
                "primary_court_code": r.primary_court_code,
                "is_verified": r.is_verified,
            }
            for r in records
        ]
        stmt = insert(AdvocateEmbedding).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["advocate_id"], set_={c: stmt.excluded[c] for c in _UPDATABLE}
        )
        try:
            async with self._sessions() as db, db.begin():
                await db.execute(stmt)
        except (SQLAlchemyError, OSError) as exc:
            raise VectorStoreError(f"pgvector upsert: {type(exc).__name__}") from exc

    async def query(
        self, embedding: list[float], *, candidate_ids: Sequence[uuid.UUID], top_k: int
    ) -> list[VectorHit]:
        if not candidate_ids:
            return []
        distance = AdvocateEmbedding.embedding.cosine_distance(embedding)
        stmt = (
            select(AdvocateEmbedding.advocate_id, distance.label("distance"))
            .where(AdvocateEmbedding.advocate_id.in_(list(candidate_ids)))
            .order_by(distance)
            .limit(top_k)
        )
        try:
            async with self._sessions() as db:
                rows = (await db.execute(stmt)).all()
        except (SQLAlchemyError, OSError) as exc:
            raise VectorStoreError(f"pgvector query: {type(exc).__name__}") from exc
        return [VectorHit(row.advocate_id, 1.0 - float(row.distance)) for row in rows]

    async def delete(self, advocate_ids: Sequence[uuid.UUID]) -> None:
        try:
            async with self._sessions() as db, db.begin():
                await db.execute(
                    delete(AdvocateEmbedding).where(AdvocateEmbedding.advocate_id.in_(list(advocate_ids)))
                )
        except (SQLAlchemyError, OSError) as exc:
            raise VectorStoreError(f"pgvector delete: {type(exc).__name__}") from exc
