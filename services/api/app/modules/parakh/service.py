"""The Parakh pipeline (brief §1.3 steps 1-7).

Two stages on purpose: court-jurisdiction eligibility is a hard filter in Postgres (multi-court membership can't be
expressed as a vector-store metadata filter), and the vector store only ranks the eligible candidates by meaning.
Ranking inputs are relevance, jurisdiction, availability and the internal trust percentile, never payment.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from pydantic import Field, ValidationError
from sqlalchemy import and_, exists, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Actor
from app.core.logging import get_logger
from app.core.metrics import PARAKH_DEGRADED
from app.core.providers import Providers
from app.core.schemas import ApiModel
from app.db.models.enums import CourtType, MatchTier, UserStatus, VerificationStatus
from app.db.models.tables import AdvocateCourt, AdvocateProfile, Court, MatchRequest, User
from app.db.tx import transaction
from app.integrations.embeddings.base import EmbeddingError
from app.integrations.llm.base import LlmError
from app.integrations.vectorstore.base import VectorStoreError

from .catalog import AREA_LABELS, LANGUAGE_NAMES, MORE_CITIES, PRIMARY_CITIES, SUPPORTED_DISTRICTS
from .intent import MatchIntent, detect_city, extract_intent
from .schemas import AdvocateMatch, CityOption, CourtRef, FollowUp, MatchRequestIn, MatchResponse

log = get_logger("parakh")

CANDIDATE_CAP = 500
SEMANTIC_TOP_K = 50
RESULTS = 3
SOON_WINDOW = timedelta(minutes=30)
COLD_START_PERCENTILE = 50.0  # new advocates sit at the cohort median: neither buried nor boosted
_BANNED = re.compile(
    r"\b(win|won|wins|winning|best|top|guarantee\w*|success|assured|expert|leading|#1)\b", re.I
)


@dataclass(frozen=True, slots=True)
class Candidate:
    profile: AdvocateProfile
    display_name: str


def _languages_for(intent: MatchIntent) -> list[str]:
    return {"hi": ["hi"], "en": ["en"], "hinglish": ["hi", "en"]}[intent.language]


async def eligible_candidates(
    db: AsyncSession, *, state: str, district: str, languages: list[str]
) -> list[Candidate]:
    """Step 3: verified, available now or within 30 minutes, practising in a court with jurisdiction, speaking one
    of the user's languages. TODO(human): conflict checks need a conflicts table (not in the brief's schema)."""
    in_jurisdiction = exists().where(
        AdvocateCourt.advocate_id == AdvocateProfile.user_id,
        AdvocateCourt.court_id == Court.id,
        Court.state_code == state,
        or_(Court.court_type == CourtType.HIGH_COURT, Court.district == district),
    )
    recently_seen = AdvocateProfile.last_seen_at > datetime.now(UTC) - SOON_WINDOW
    rows = await db.execute(
        select(AdvocateProfile, User.display_name)
        .join(User, User.id == AdvocateProfile.user_id)
        .where(
            User.status == UserStatus.ACTIVE,
            AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
            or_(AdvocateProfile.is_available, recently_seen),
            in_jurisdiction,
            AdvocateProfile.languages.overlap(languages),
        )
        .order_by(AdvocateProfile.user_id)
        .limit(CANDIDATE_CAP)
    )
    return [Candidate(profile, name or "") for profile, name in rows]


async def _trust_percentiles(
    db: AsyncSession, ids: list[uuid.UUID], area: str | None
) -> dict[uuid.UUID, float]:
    if not ids or area is None:
        return {}
    rows = await db.execute(
        text(
            "SELECT advocate_id, percentile FROM praman_latest WHERE practice_area = :area AND advocate_id = ANY(:ids)"
        ),
        {"area": area, "ids": ids},
    )
    return {row.advocate_id: float(row.percentile) for row in rows}


def _availability(profile: AdvocateProfile) -> float:
    if not profile.is_available:
        return 0.3
    response = min(profile.avg_response_seconds or 300, 300)
    return 1.0 - response / 600


async def courts_for(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[CourtRef]]:
    out: dict[uuid.UUID, list[CourtRef]] = {i: [] for i in ids}
    rows = await db.execute(
        select(AdvocateCourt.advocate_id, Court.code, Court.name)
        .join(Court, Court.id == AdvocateCourt.court_id)
        .where(AdvocateCourt.advocate_id.in_(ids))
        .order_by(Court.court_type.desc(), Court.code)
    )
    for advocate_id, code, name in rows:
        out[advocate_id].append(CourtRef(code=code, name=name))
    return out


class _Why(ApiModel):
    why: str = Field(min_length=10, max_length=220)


_WHY_SYSTEM = """Write ONE plain sentence (at most 25 words) telling a member of the public why this advocate's
practice matches their matter. Use ONLY the fields provided. Never mention outcomes, success, winning, rankings,
quality, guarantees or anything not in the fields. Write in the requested language. Return JSON {"why": "..."}."""


def _why_template(c: Candidate, courts: list[CourtRef], area: str | None, locale: str) -> str:
    chosen = area if area in c.profile.practice_areas else (c.profile.practice_areas or [""])[0]
    area_name = AREA_LABELS[locale].get(chosen or "", chosen or "")
    court = courts[0].name if courts else ""
    names = [LANGUAGE_NAMES[locale].get(x, x) for x in c.profile.languages]
    joiner = " और " if locale == "hi" else " and "
    langs = names[0] if len(names) == 1 else ", ".join(names[:-1]) + joiner + names[-1]
    if locale == "hi":
        return (
            f"{court} में {area_name} मामलों में प्रैक्टिस, {langs} बोलते हैं, {c.profile.years_experience} वर्ष का अनुभव।"
        )
    return f"Practises {area_name} matters at {court}, speaks {langs}, and has {c.profile.years_experience} years in practice."


async def _why(
    providers: Providers, c: Candidate, courts: list[CourtRef], area: str | None, locale: str
) -> str:
    """Step 6 (premium): built from matched structured fields only; validated, with a template fallback."""
    template = _why_template(c, courts, area, locale)
    fields = {
        "language": "Hindi" if locale == "hi" else "English",
        "matter_type": AREA_LABELS["en"].get(area or "", "general"),
        "practice_areas": [AREA_LABELS["en"].get(a, a) for a in c.profile.practice_areas],
        "courts": [ct.name for ct in courts],
        "languages": [LANGUAGE_NAMES["en"].get(x, x) for x in c.profile.languages],
        "years_experience": c.profile.years_experience,
    }
    try:
        raw = await providers.llm.json(
            system=_WHY_SYSTEM,
            user=str(fields),
            schema={"type": "object", "properties": {"why": {"type": "string"}}, "required": ["why"]},
            timeout=providers.settings.llm_timeout_seconds,
        )
        why = _Why.model_validate(raw).why.strip()
    except (LlmError, ValidationError):
        return template
    return template if _BANNED.search(why) else why


def _resolve_location(req: MatchRequestIn) -> tuple[str, str] | None:
    if req.district and req.state and SUPPORTED_DISTRICTS.get(req.district) == req.state:
        return req.district, req.state
    return detect_city(req.query_text)


async def match(req: MatchRequestIn, actor: Actor, providers: Providers, db: AsyncSession) -> MatchResponse:
    settings = providers.settings
    tier = (
        "premium"
        if req.tier == "premium" and actor.user is not None and actor.user.is_premium
        else "standard"
    )
    intent, intent_source = await extract_intent(
        req.query_text, providers.llm, timeout=settings.llm_timeout_seconds
    )
    location = _resolve_location(req)

    results: list[AdvocateMatch] = []
    follow_up: FollowUp | None = None
    degraded = False
    scores: dict[str, float] = {}

    if location is None:
        follow_up = FollowUp(
            primary=[CityOption(district=d, state=s) for d, s in PRIMARY_CITIES],
            more=[CityOption(district=d, state=s) for d, s in MORE_CITIES],
        )
    else:
        district, state = location
        candidates = await eligible_candidates(
            db, state=state, district=district, languages=_languages_for(intent)
        )
        by_id = {c.profile.user_id: c for c in candidates}
        semantic: dict[uuid.UUID, float] = {}
        if candidates:
            area_hint = AREA_LABELS["en"].get(intent.practice_area or "", "")
            try:
                [query_vector] = await providers.embedder.embed(
                    [f"{req.query_text}\n{area_hint}"], task="query"
                )
                hits = await providers.vectors.query(
                    query_vector, candidate_ids=list(by_id), top_k=SEMANTIC_TOP_K
                )
                semantic = {h.advocate_id: max(0.0, min(1.0, h.similarity)) for h in hits}
            except (VectorStoreError, EmbeddingError) as exc:
                # Step 7: never 500 because search is down; rank by trust + availability instead.
                degraded = True
                PARAKH_DEGRADED.inc()
                log.warning("parakh.degraded", reason=type(exc).__name__)
        pool = list(by_id) if degraded else [i for i in by_id if i in semantic]
        trust = await _trust_percentiles(db, pool, intent.practice_area)
        rates = [by_id[i].profile.rate_paise_per_min for i in pool]
        low, high = (min(rates), max(rates)) if rates else (0, 0)
        for advocate_id in pool:
            profile = by_id[advocate_id].profile
            price_fit = 0.5 if high == low else 1 - (profile.rate_paise_per_min - low) / (high - low)
            scores[str(advocate_id)] = (
                settings.parakh_weight_semantic * semantic.get(advocate_id, 0.0)
                + settings.parakh_weight_trust * trust.get(advocate_id, COLD_START_PERCENTILE) / 100
                + settings.parakh_weight_availability * _availability(profile)
                + settings.parakh_weight_price * price_fit
            )
        top = sorted(pool, key=lambda i: (-scores[str(i)], str(i)))[:RESULTS]
        courts = await courts_for(db, top)
        whys: list[str | None] = [None] * len(top)
        if tier == "premium":
            whys = list(
                await asyncio.gather(
                    *(_why(providers, by_id[i], courts[i], intent.practice_area, req.locale) for i in top)
                )
            )
        for advocate_id, why in zip(top, whys, strict=True):
            c = by_id[advocate_id]
            results.append(
                AdvocateMatch(
                    advocate_id=advocate_id,
                    display_name=c.display_name,
                    enrolment_no=c.profile.enrolment_no,
                    state_bar_council=c.profile.state_bar_council,
                    courts=courts[advocate_id],
                    languages=list(c.profile.languages),
                    practice_areas=list(c.profile.practice_areas),
                    years_experience=c.profile.years_experience,
                    rate_paise_per_min=c.profile.rate_paise_per_min,
                    platform_fee_paise_per_min=settings.platform_fee_paise_per_min,
                    available_now=c.profile.is_available,
                    why=why,
                )
            )

    record = MatchRequest(
        user_id=actor.user_id,
        visitor_id=actor.visitor_id,
        query_text=req.query_text,
        locale=req.locale,
        intent=intent.model_dump() | {"source": intent_source},
        tier=MatchTier(tier),
        results={
            "advocate_ids": [str(r.advocate_id) for r in results],
            "scores": {str(r.advocate_id): round(scores.get(str(r.advocate_id), 0.0), 4) for r in results},
            "degraded": degraded,
            "location": list(location) if location else None,
        },
    )
    async with transaction(db):
        db.add(record)
    return MatchResponse(
        match_id=record.id,
        intent=intent,
        results=results,
        follow_up=follow_up,
        degraded=degraded,
        location=CityOption(district=location[0], state=location[1]) if location else None,
    )


async def public_profile(
    db: AsyncSession, advocate_id: uuid.UUID
) -> tuple[AdvocateProfile, str | None] | None:
    row = (
        await db.execute(
            select(AdvocateProfile, User.display_name)
            .join(User, User.id == AdvocateProfile.user_id)
            .where(
                and_(
                    AdvocateProfile.user_id == advocate_id,
                    AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
                    User.status == UserStatus.ACTIVE,
                )
            )
        )
    ).first()
    return (row[0], row[1]) if row else None
