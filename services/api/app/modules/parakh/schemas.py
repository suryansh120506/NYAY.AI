"""Parakh API models. They mirror apps/web/lib/api/types.ts; no score or trust signal ever appears here."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.core.schemas import ApiModel

from .intent import MatchIntent, PracticeAreaLit

StateLit = Literal["UP", "DL"]


class MatchRequestIn(ApiModel):
    query_text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=2000)]
    locale: Literal["en", "hi"] = "en"
    state: StateLit | None = None
    district: Annotated[str, StringConstraints(pattern=r"^[a-z_]{2,40}$")] | None = None
    court_hint: Annotated[str, StringConstraints(max_length=48)] | None = None
    tier: Literal["standard", "premium"] = "standard"
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class CourtRef(ApiModel):
    code: str
    name: str


class AdvocateMatch(ApiModel):
    advocate_id: uuid.UUID
    display_name: str
    enrolment_no: str
    state_bar_council: str
    courts: list[CourtRef]
    languages: list[str]
    practice_areas: list[PracticeAreaLit]
    years_experience: int
    rate_paise_per_min: int
    platform_fee_paise_per_min: int
    available_now: bool
    why: str | None = None


class CityOption(ApiModel):
    district: str
    state: StateLit


class FollowUp(ApiModel):
    kind: Literal["location"] = "location"
    primary: list[CityOption]
    more: list[CityOption]


class MatchResponse(ApiModel):
    match_id: uuid.UUID
    intent: MatchIntent
    results: list[AdvocateMatch]
    follow_up: FollowUp | None
    degraded: bool
    location: CityOption | None


class AdvocateProfileOut(ApiModel):
    """Public, factual profile (brief §0): no ratings, rankings, outcomes or superlatives."""

    advocate_id: uuid.UUID
    display_name: str
    enrolment_no: str
    state_bar_council: str
    headline: str
    courts: list[CourtRef]
    languages: list[str]
    practice_areas: list[PracticeAreaLit]
    years_experience: int
    rate_paise_per_min: int
    platform_fee_paise_per_min: int
    available_now: bool
