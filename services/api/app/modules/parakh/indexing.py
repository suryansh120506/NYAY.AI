"""Advocate embeddings (brief §1.3): documents built from headline, practice areas, courts and languages.

Re-run whenever a profile changes (arq job `reindex_advocate`) or the embedding model changes (`reindex_all`).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.providers import Providers
from app.db.models.enums import VerificationStatus
from app.db.models.tables import AdvocateCourt, AdvocateProfile, Court
from app.db.tx import transaction
from app.integrations.vectorstore.base import VectorRecord

from .catalog import AREA_LABELS, LANGUAGE_NAMES


def profile_document(profile: AdvocateProfile, court_names: Sequence[str]) -> str:
    areas = ", ".join(AREA_LABELS["en"].get(a, a) for a in profile.practice_areas)
    langs = ", ".join(LANGUAGE_NAMES["en"].get(code, code) for code in profile.languages)
    return (
        f"{profile.headline}\nPractice areas: {areas}.\nCourts: {', '.join(court_names)}.\n"
        f"Languages: {langs}.\nExperience: {profile.years_experience} years."
    )


async def index_advocates(
    providers: Providers, db: AsyncSession, advocate_ids: Sequence[uuid.UUID] | None = None
) -> int:
    stmt = select(AdvocateProfile)
    if advocate_ids is not None:
        stmt = stmt.where(AdvocateProfile.user_id.in_(list(advocate_ids)))
    profiles = (await db.scalars(stmt)).all()
    if not profiles:
        return 0
    courts: dict[uuid.UUID, list[Court]] = {p.user_id: [] for p in profiles}
    rows = await db.execute(
        select(AdvocateCourt.advocate_id, Court)
        .join(Court, Court.id == AdvocateCourt.court_id)
        .where(AdvocateCourt.advocate_id.in_(list(courts)))
        .order_by(Court.court_type.desc(), Court.code)
    )
    for advocate_id, court in rows:
        courts[advocate_id].append(court)

    documents = [profile_document(p, [c.name for c in courts[p.user_id]]) for p in profiles]
    vectors = await providers.embedder.embed(documents, task="document")
    await providers.vectors.upsert(
        [
            VectorRecord(
                advocate_id=p.user_id,
                document=doc,
                embedding=vec,
                embedding_version=providers.embedder.version,
                primary_court_code=courts[p.user_id][0].code if courts[p.user_id] else None,
                is_verified=p.verification_status == VerificationStatus.VERIFIED,
            )
            for p, doc, vec in zip(profiles, documents, vectors, strict=True)
        ]
    )
    async with transaction(db):
        await db.execute(
            update(AdvocateProfile)
            .where(AdvocateProfile.user_id.in_([p.user_id for p in profiles]))
            .values(embedding_version=providers.embedder.version, embedding_updated_at=datetime.now(UTC))
        )
    return len(profiles)
