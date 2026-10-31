"""Seed demo data (brief §2.5). Dev/test only and idempotent: safe to run repeatedly.

    uv run python -m scripts.seed

Everything is clearly fictional: advocates are named "Demo …" with DEMO/ enrolment numbers, demo phone numbers are
in a reserved-looking range, and news comes from "Demo" publishers on example.com.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import sys
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.providers import build_providers
from app.core.redis import get_redis
from app.db.models.enums import CourtType, Role, VerificationStatus
from app.db.models.tables import (
    AdvocateCourt,
    AdvocateProfile,
    CaseOutcome,
    Court,
    NewsItem,
    User,
)
from app.db.session import get_sessionmaker
from app.ledger import operations
from app.ledger.posting import ensure_wallet
from app.modules.news.service import invalidate_cache, truncate_excerpt, url_hash
from app.modules.parakh.indexing import index_advocates

FIXTURES = Path(__file__).resolve().parents[1] / "app" / "fixtures"
log = get_logger("seed")

# (code, name, type, state, district). TODO(human): confirm the Allahabad HC / Lucknow Bench territorial split.
COURTS: list[tuple[str, str, CourtType, str, str | None]] = [
    ("ALLAHABAD_HC", "Allahabad High Court", CourtType.HIGH_COURT, "UP", None),
    ("ALLAHABAD_HC_LUCKNOW", "Allahabad HC, Lucknow Bench", CourtType.HIGH_COURT, "UP", None),
    ("DELHI_HC", "Delhi High Court", CourtType.HIGH_COURT, "DL", None),
    ("UP_LUCKNOW_DC", "District Court, Lucknow", CourtType.DISTRICT, "UP", "lucknow"),
    ("UP_KANPUR_NAGAR_DC", "District Court, Kanpur Nagar", CourtType.DISTRICT, "UP", "kanpur_nagar"),
    ("UP_VARANASI_DC", "District Court, Varanasi", CourtType.DISTRICT, "UP", "varanasi"),
    ("UP_PRAYAGRAJ_DC", "District Court, Prayagraj", CourtType.DISTRICT, "UP", "prayagraj"),
    ("UP_AGRA_DC", "District Court, Agra", CourtType.DISTRICT, "UP", "agra"),
    (
        "UP_GAUTAM_BUDDH_NAGAR_DC",
        "District Court, Gautam Buddh Nagar",
        CourtType.DISTRICT,
        "UP",
        "gautam_buddh_nagar",
    ),
    ("UP_GHAZIABAD_DC", "District Court, Ghaziabad", CourtType.DISTRICT, "UP", "ghaziabad"),
    ("DL_TIS_HAZARI", "Tis Hazari Courts", CourtType.DISTRICT, "DL", "delhi"),
    ("DL_PATIALA_HOUSE", "Patiala House Courts", CourtType.DISTRICT, "DL", "delhi"),
    ("DL_SAKET", "Saket Courts", CourtType.DISTRICT, "DL", "delhi"),
    ("DL_KARKARDOOMA", "Karkardooma Courts", CourtType.DISTRICT, "DL", "delhi"),
    ("DL_ROHINI", "Rohini Courts", CourtType.DISTRICT, "DL", "delhi"),
    ("DL_DWARKA", "Dwarka Courts", CourtType.DISTRICT, "DL", "delhi"),
]

# Demo customers: sign in with any of these and code 000000. The last one is premium (shows "Why this advocate").
DEMO_USERS = [
    ("+919000000001", "Demo User One", False),
    ("+919000000002", "Demo User Two", False),
    ("+919000000003", "Demo User Three", False),
    ("+919000000004", "Demo User Four", False),
    ("+919000009999", "Demo Premium User", True),
]
DEMO_ADMIN = ("+919000000000", "Demo Admin")
DEMO_BALANCE_PAISE = 25_000


async def seed_courts(db: AsyncSession) -> dict[str, Any]:
    rows = [
        {"code": c, "name": n, "court_type": t, "state_code": s, "district": d} for c, n, t, s, d in COURTS
    ]
    await db.execute(insert(Court).values(rows).on_conflict_do_nothing(index_elements=["code"]))
    return {court.code: court.id for court in (await db.scalars(select(Court))).all()}


def advocate_phone(index: int) -> str:
    return f"+91800000{index + 1:04d}"


async def seed_user(
    db: AsyncSession,
    phone: str,
    name: str,
    role: Role,
    premium: bool = False,
    user_id: uuid.UUID | None = None,
) -> Any:
    values: dict[str, Any] = {"phone_e164": phone, "display_name": name, "role": role, "is_premium": premium}
    if user_id is not None:
        values["id"] = user_id
        # Stable ids: re-seeding moves an existing demo account to the current phone pattern.
        await db.execute(
            insert(User)
            .values(**values)
            .on_conflict_do_update(index_elements=["id"], set_={"phone_e164": phone})
        )
    else:
        await db.execute(insert(User).values(**values).on_conflict_do_nothing(index_elements=["phone_e164"]))
    user = (await db.execute(select(User).where(User.phone_e164 == phone))).scalar_one()
    await ensure_wallet(db, user.id)
    return user.id


async def seed_advocates(db: AsyncSession, court_ids: dict[str, Any]) -> list[Any]:
    advocates = json.loads((FIXTURES / "advocates.json").read_text(encoding="utf-8"))
    now = datetime.now(UTC)
    ids = []
    for index, adv in enumerate(advocates):
        # Demo advocates sign in like anyone else (code 000000 in dev): +91 80000 00001 … 00040.
        # The fixture's stable id is reused, so the web app's offline mocks and the real API agree on who is who.
        user_id = await seed_user(
            db, advocate_phone(index), adv["display_name"], Role.ADVOCATE, user_id=uuid.UUID(adv["id"])
        )
        await db.execute(
            insert(AdvocateProfile)
            .values(
                user_id=user_id,
                enrolment_no=adv["enrolment_no"],
                state_bar_council=adv["state_bar_council"],
                verification_status=VerificationStatus(adv["verification_status"]),
                verified_at=now,
                headline=adv["headline"],
                years_experience=adv["years_experience"],
                languages=adv["languages"],
                practice_areas=adv["practice_areas"],
                rate_paise_per_min=adv["rate_paise_per_min"],
                is_available=adv["available_now"],
                last_seen_at=now - timedelta(minutes=0 if adv["available_now"] else 10),
                avg_response_seconds=adv["avg_response_seconds"],
            )
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        await db.execute(
            insert(AdvocateCourt)
            .values([{"advocate_id": user_id, "court_id": court_ids[code]} for code in adv["courts"]])
            .on_conflict_do_nothing()
        )
        ids.append(user_id)
    return ids


async def seed_news(db: AsyncSession) -> None:
    items = json.loads((FIXTURES / "news.json").read_text(encoding="utf-8"))
    now = datetime.now(UTC)
    rows = [
        {
            "source": item["source"],
            "title": item["title"],
            "excerpt": truncate_excerpt(item["excerpt"]),
            "canonical_url": item["canonical_url"],
            "url_hash": url_hash(item["canonical_url"]),
            "category": item["category"],
            "published_at": now - timedelta(minutes=int(item["minutes_ago"])),
        }
        for item in items
    ]
    await db.execute(insert(NewsItem).values(rows).on_conflict_do_nothing(index_elements=["url_hash"]))


async def seed_outcomes(db: AsyncSession, advocate_ids: list[Any], court_ids: dict[str, Any]) -> None:
    """FixtureSource case outcomes for Praman (Phase 3). Deterministic, labelled `fixture`, never real cases."""
    rng = random.Random(20261010)
    labels = ["favourable", "unfavourable", "mixed", "unknown"]
    rows = []
    for advocate_id in advocate_ids:
        profile = await db.scalar(select(AdvocateProfile).where(AdvocateProfile.user_id == advocate_id))
        if profile is None or not profile.practice_areas:
            continue
        for n in range(rng.randint(4, 24)):
            ref = hashlib.sha256(f"{advocate_id}:{n}".encode()).hexdigest()[:24]
            rows.append(
                {
                    "advocate_id": advocate_id,
                    "source": "fixture",
                    "source_ref": f"FIXTURE-{ref}",
                    "court_id": rng.choice(list(court_ids.values())),
                    "practice_area": rng.choice(profile.practice_areas),
                    "decided_on": date.today() - timedelta(days=rng.randint(30, 1800)),
                    "outcome_label": rng.choices(labels, weights=[5, 3, 1, 1])[0],
                    "label_confidence": round(rng.uniform(0.55, 0.99), 2),
                    "raw_order_ref": None,
                    "resolved": True,
                }
            )
    if rows:
        await db.execute(
            insert(CaseOutcome)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["source", "source_ref", "advocate_id"])
        )


async def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    if not settings.is_dev:
        print("Refusing to seed: ENV must be dev or test.", file=sys.stderr)
        return 2
    sessions = get_sessionmaker()
    async with sessions() as db:
        async with db.begin():
            court_ids = await seed_courts(db)
            advocate_ids = await seed_advocates(db, court_ids)
            await seed_user(db, *DEMO_ADMIN, Role.ADMIN)
            for phone, name, premium in DEMO_USERS:
                user_id = await seed_user(db, phone, name, Role.USER, premium)
                await operations.topup(
                    db,
                    user_id=user_id,
                    amount=DEMO_BALANCE_PAISE,
                    idempotency_key=f"seed:topup:{phone}",
                    external_ref="seed",
                )
            await seed_news(db)
            await seed_outcomes(db, advocate_ids, court_ids)
        providers = build_providers(settings, redis=get_redis(), sessions=sessions)
        try:
            indexed = await index_advocates(providers, db)
            await invalidate_cache(providers.redis)
        finally:
            await providers.aclose()
    log.info(
        "seed.done",
        courts=len(court_ids),
        advocates=len(advocate_ids),
        indexed=indexed,
        demo_users=len(DEMO_USERS),
    )
    print(
        f"Seeded {len(court_ids)} courts, {len(advocate_ids)} advocates ({indexed} indexed), "
        f"{len(DEMO_USERS)} demo users (+ admin {DEMO_ADMIN[0]}), news fixtures. Sign in with code 000000."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
