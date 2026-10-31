from __future__ import annotations

import uuid

from fastapi import APIRouter, Request

from app.core.deps import ActorDep, DbDep, ProvidersDep, client_ip
from app.core.errors import AppError
from app.core.ratelimit import enforce

from .schemas import AdvocateProfileOut, MatchRequestIn, MatchResponse
from .service import courts_for, match, public_profile

router = APIRouter(tags=["parakh"])


@router.post("/v1/parakh/match", response_model=MatchResponse)
async def parakh_match(
    body: MatchRequestIn, request: Request, actor: ActorDep, providers: ProvidersDep, db: DbDep
) -> MatchResponse:
    """Open to anonymous visitors (signed visitor cookie), text only, rate-limited per IP and per visitor/user."""
    rule = providers.settings.rate_limit_match
    await enforce(providers.redis, scope="match-ip", identity=client_ip(request), rule=rule)
    await enforce(providers.redis, scope="match-actor", identity=actor.key, rule=rule)
    return await match(body, actor, providers, db)


@router.get("/v1/advocates/{advocate_id}", response_model=AdvocateProfileOut)
async def advocate_profile(advocate_id: uuid.UUID, providers: ProvidersDep, db: DbDep) -> AdvocateProfileOut:
    row = await public_profile(db, advocate_id)
    if row is None:
        raise AppError("not_found", 404)
    profile, name = row
    courts = (await courts_for(db, [advocate_id]))[advocate_id]
    return AdvocateProfileOut(
        advocate_id=advocate_id,
        display_name=name or "",
        enrolment_no=profile.enrolment_no,
        state_bar_council=profile.state_bar_council,
        headline=profile.headline,
        courts=courts,
        languages=list(profile.languages),
        practice_areas=list(profile.practice_areas),
        years_experience=profile.years_experience,
        rate_paise_per_min=profile.rate_paise_per_min,
        platform_fee_paise_per_min=providers.settings.platform_fee_paise_per_min,
        available_now=profile.is_available,
    )
