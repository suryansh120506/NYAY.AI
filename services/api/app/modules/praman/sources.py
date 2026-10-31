"""Where case outcomes come from (brief §1.2 Praman). Every source implements `CaseOutcomeSource`.

FixtureSource         the seeded, clearly fictional `fixture` rows (dev and demo)
ECourtsSource         gated: PRAMAN_LIVE_SOURCES=false by default and not implemented
IndianKanoonSource    gated: same

TODO(human): real sources need a lawful basis first: a licensed API or written permission, robots.txt and ToS
compliance, no CAPTCHA circumvention, and a legal review of matching orders to advocates (names are ambiguous).
Until then the live adapters refuse to run.
"""

from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.tables import CaseOutcome

from .scoring import Outcome


class SourceDisabled(Exception):
    pass


class CaseOutcomeSource(Protocol):
    name: str

    async def outcomes(self, db: AsyncSession) -> dict[tuple[str, str], list[Outcome]]:
        """(advocate_id, practice_area) → outcomes."""
        ...


class FixtureSource:
    name = "fixture"

    async def outcomes(self, db: AsyncSession) -> dict[tuple[str, str], list[Outcome]]:
        rows = (
            await db.execute(
                select(
                    CaseOutcome.advocate_id,
                    CaseOutcome.practice_area,
                    CaseOutcome.outcome_label,
                    CaseOutcome.label_confidence,
                    CaseOutcome.decided_on,
                    CaseOutcome.resolved,
                ).where(CaseOutcome.advocate_id.is_not(None))
            )
        ).all()
        out: dict[tuple[str, str], list[Outcome]] = {}
        for advocate_id, area, label, confidence, decided_on, resolved in rows:
            out.setdefault((str(advocate_id), area), []).append(
                Outcome(
                    label=str(label),
                    confidence=float(confidence),
                    decided_on=decided_on,
                    resolved=bool(resolved),
                )
            )
        return out


class _GatedSource:
    name = "gated"

    def __init__(self, *, enabled: bool) -> None:
        self.enabled = enabled

    async def outcomes(self, db: AsyncSession) -> dict[tuple[str, str], list[Outcome]]:
        if not self.enabled:
            raise SourceDisabled(f"{self.name} is disabled (PRAMAN_LIVE_SOURCES=false)")
        raise NotImplementedError(
            f"TODO(human): {self.name} needs a licensed, ToS-compliant data agreement first"
        )


class ECourtsSource(_GatedSource):
    name = "ecourts"


class IndianKanoonSource(_GatedSource):
    name = "indiankanoon"
