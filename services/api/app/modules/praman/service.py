"""Weekly Praman run: compute every advocate's TrustScore per practice area and append it to `praman_scores`.

Parakh reads only the cohort percentile (`praman_latest`) as one ranking input; no response ever includes it, and
only admins can see the components (audited).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.models.enums import VerificationStatus
from app.db.models.tables import AdvocateProfile, PramanScore
from app.db.tx import transaction

from .scoring import (
    K_RATINGS,
    K_RELIABILITY,
    Components,
    Outcome,
    outcome_component,
    percentile_ranks,
    shrink,
    usable,
    weighted_rate,
)
from .sources import CaseOutcomeSource, ECourtsSource, FixtureSource, IndianKanoonSource, SourceDisabled

log = get_logger("praman")

_SESSION_STATS = text(
    """
    SELECT s.advocate_id::text AS advocate_id,
           AVG((r.rating - 1) / 4.0) AS rating_mean,
           COUNT(r.rating) AS ratings,
           COUNT(*) FILTER (WHERE s.state = 'SETTLED') AS settled,
           COUNT(*) FILTER (WHERE s.state = 'SETTLED' AND s.end_reason IS DISTINCT FROM 'advocate_ended') AS stayed
      FROM sessions s
      LEFT JOIN session_ratings r ON r.session_id = s.id
     GROUP BY s.advocate_id
    """
)


def sources(settings: Settings) -> list[CaseOutcomeSource]:
    live = settings.praman_live_sources
    return [FixtureSource(), ECourtsSource(enabled=live), IndianKanoonSource(enabled=live)]


async def compute_all(db: AsyncSession, settings: Settings, today: date | None = None) -> int:
    today = today or date.today()
    outcomes: dict[tuple[str, str], list[Outcome]] = {}
    for source in sources(settings):
        try:
            for key, items in (await source.outcomes(db)).items():
                outcomes.setdefault(key, []).extend(items)
        except SourceDisabled:
            continue
    advocates = (
        await db.execute(
            select(AdvocateProfile.user_id, AdvocateProfile.practice_areas).where(
                AdvocateProfile.verification_status == VerificationStatus.VERIFIED
            )
        )
    ).all()
    stats = {row.advocate_id: row for row in (await db.execute(_SESSION_STATS)).all()}
    await db.commit()

    # Cohort priors: the mean outcome rate per practice area, the mean rating and the mean reliability overall.
    area_rates: dict[str, list[float]] = {}
    for (_, area), items in outcomes.items():
        good = usable(items)
        if good:
            area_rates.setdefault(area, []).append(weighted_rate(good, today)[0])
    area_prior = {area: sum(v) / len(v) for area, v in area_rates.items()}
    rated = [float(s.rating_mean) for s in stats.values() if s.ratings]
    rating_prior = sum(rated) / len(rated) if rated else 0.75
    reliability_prior = 0.9

    components: dict[str, dict[str, Components]] = {}
    for advocate_id, areas in advocates:
        aid = str(advocate_id)
        st = stats.get(aid)
        ratings = (
            shrink(float(st.rating_mean), int(st.ratings), rating_prior, K_RATINGS)
            if st and st.ratings
            else rating_prior
        )
        reliability = (
            shrink(int(st.stayed) / int(st.settled), int(st.settled), reliability_prior, K_RELIABILITY)
            if st and st.settled
            else reliability_prior
        )
        for area in areas:
            outcome, resolved = outcome_component(
                outcomes.get((aid, area), []), area_prior.get(area, 0.5), today
            )
            components.setdefault(area, {})[aid] = Components(outcome, ratings, reliability, resolved)

    written = 0
    async with transaction(db):
        for area, cohort in components.items():
            percentiles = percentile_ranks({aid: c.score for aid, c in cohort.items()})
            for aid, c in cohort.items():
                db.add(
                    PramanScore(
                        advocate_id=aid,
                        practice_area=area,
                        score=Decimal(f"{c.score:.2f}"),
                        percentile=Decimal(f"{percentiles[aid]:.2f}"),
                        components={
                            "outcomes": round(c.outcomes, 4),
                            "ratings": round(c.ratings, 4),
                            "reliability": round(c.reliability, 4),
                        },
                        sample_size=c.resolved,
                        confidence=c.confidence,
                    )
                )
                written += 1
    log.info("praman.computed", rows=written)
    return written
