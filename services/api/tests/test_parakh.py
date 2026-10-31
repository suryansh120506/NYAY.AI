"""Parakh (brief §4 step 2.6): jurisdiction filter, degraded mode, standard vs premium shape."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models.enums import CourtType
from app.db.models.tables import Court, User
from app.integrations.vectorstore.memory import MemoryVectorStore
from app.modules.parakh.catalog import MORE_CITIES, PRIMARY_CITIES
from app.modules.parakh.intent import detect_city, keyword_intent

from .api_harness import api_client, make_providers, new_app, settings_for_tests, sign_in

QUERIES = {
    "tenancy": "My landlord will not return my security deposit",
    "cheque_bounce": "The cheque he gave me bounced",
    "consumer": "The seller refuses a refund for a defective product",
    "matrimonial": "I want to file for divorce and maintenance",
    "criminal_bail": "My brother was arrested by the police and needs bail",
    "property": "Dispute over partition of ancestral land",
    "employment": "My employer has not paid my salary",
}


async def _eligible_codes(
    sessionmaker: async_sessionmaker[AsyncSession], state: str, district: str
) -> set[str]:
    async with sessionmaker() as db:
        courts = (await db.scalars(select(Court).where(Court.state_code == state))).all()
    return {c.code for c in courts if c.court_type == CourtType.HIGH_COURT or c.district == district}


def test_keyword_intent_and_city_detection() -> None:
    for area, query in QUERIES.items():
        assert keyword_intent(query).practice_area == area
    assert keyword_intent("मेरे चेक का भुगतान नहीं हुआ").language == "hi"
    assert keyword_intent("mera makan malik deposit nahi de raha").language == "hinglish"
    assert detect_city("लखनऊ में मकान मालिक") == ("lucknow", "UP")
    assert detect_city("somewhere else") is None


async def test_asks_for_the_city_when_unknown(api: httpx.AsyncClient) -> None:
    r = await api.post("/v1/parakh/match", json={"query_text": QUERIES["tenancy"], "locale": "en"})
    body = r.json()
    assert r.status_code == 200
    assert body["results"] == [] and body["follow_up"]["kind"] == "location"
    assert len(body["follow_up"]["primary"]) == 4


@pytest.mark.parametrize(("district", "state"), PRIMARY_CITIES + MORE_CITIES)
async def test_never_returns_an_advocate_outside_the_jurisdiction(
    api: httpx.AsyncClient, sessionmaker: async_sessionmaker[AsyncSession], district: str, state: str
) -> None:
    allowed = await _eligible_codes(sessionmaker, state, district)
    for query in QUERIES.values():
        body = (
            await api.post(
                "/v1/parakh/match",
                json={"query_text": query, "locale": "en", "state": state, "district": district},
            )
        ).json()
        assert 0 < len(body["results"]) <= 3
        for advocate in body["results"]:
            codes = {c["code"] for c in advocate["courts"]}
            assert codes & allowed, (advocate["display_name"], district)


async def test_vector_store_down_degrades_instead_of_failing(
    sessionmaker: async_sessionmaker[AsyncSession], migrated_database: str, seeded: dict[str, object]
) -> None:
    settings = settings_for_tests(migrated_database, vector_store="memory")
    providers = make_providers(settings, sessionmaker)
    assert isinstance(providers.vectors, MemoryVectorStore)
    providers.vectors.fail = True
    async with api_client(new_app(settings, providers), providers) as client:
        r = await client.post(
            "/v1/parakh/match",
            json={"query_text": QUERIES["tenancy"], "locale": "en", "state": "UP", "district": "lucknow"},
        )
    await providers.aclose()
    assert r.status_code == 200
    body = r.json()
    assert body["degraded"] is True
    assert len(body["results"]) == 3


async def test_premium_adds_why_only_for_premium_users(
    api: httpx.AsyncClient, sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    payload = {
        "query_text": QUERIES["cheque_bounce"],
        "locale": "en",
        "state": "DL",
        "district": "delhi",
        "tier": "premium",
    }
    anonymous = (await api.post("/v1/parakh/match", json=payload)).json()
    assert all(r["why"] is None for r in anonymous["results"])

    token, body = await sign_in(api)
    user = body["user"]
    assert isinstance(user, dict)
    async with sessionmaker() as db, db.begin():
        row = await db.scalar(select(User).where(User.id == uuid.UUID(str(user["id"]))))
        assert row is not None
        row.is_premium = True
    premium = (
        await api.post("/v1/parakh/match", json=payload, headers={"Authorization": f"Bearer {token}"})
    ).json()
    whys = [r["why"] for r in premium["results"]]
    assert all(whys)
    for why, result in zip(whys, premium["results"], strict=True):
        assert f"{result['years_experience']} years" in why
        assert not any(word in why.lower() for word in ("win", "best", "guarantee", "success"))

    standard = (
        await api.post(
            "/v1/parakh/match",
            json=payload | {"tier": "standard"},
            headers={"Authorization": f"Bearer {token}"},
        )
    ).json()
    assert all(r["why"] is None for r in standard["results"])


async def test_anonymous_visitors_get_a_signed_cookie(api: httpx.AsyncClient) -> None:
    r = await api.post("/v1/parakh/match", json={"query_text": QUERIES["tenancy"], "locale": "en"})
    assert "nyay_vid" in r.headers.get("set-cookie", "")


async def test_responses_never_expose_scores(api: httpx.AsyncClient) -> None:
    body = (
        await api.post(
            "/v1/parakh/match",
            json={"query_text": QUERIES["tenancy"], "locale": "en", "state": "UP", "district": "agra"},
        )
    ).json()
    for advocate in body["results"]:
        assert not {
            k for k in advocate if any(w in k for w in ("score", "rank", "trust", "praman", "percentile"))
        }


async def test_public_profile_is_factual(api: httpx.AsyncClient, seeded: dict[str, object]) -> None:
    advocate_ids = seeded["advocate_ids"]
    assert isinstance(advocate_ids, list)
    r = await api.get(f"/v1/advocates/{advocate_ids[0]}")
    assert r.status_code == 200
    assert r.json()["display_name"].startswith("Demo ")
    assert (await api.get(f"/v1/advocates/{uuid.uuid4()}")).status_code == 404
