"""TrustScore arithmetic (brief §1.2 Praman). Pure functions; internal only, never shown to users.

score = 100 × (0.5 · outcomes + 0.3 · client ratings + 0.2 · reliability), every component in [0, 1] and shrunk
toward its cohort mean (empirical Bayes), so a handful of cases can neither make nor break an advocate:

  outcomes     recency-weighted share of favourable outcomes (mixed = ½) among resolved cases whose label confidence
               is ≥ 0.7, half-life 2 years, shrinkage k = 20; fewer than 10 resolved cases → the cohort mean
  ratings      session ratings mapped 1..5 → 0..1, shrinkage k = 10
  reliability  share of settled consultations the advocate did not walk out of, shrinkage k = 10

TODO(human): weights, k values and the half-life are placeholders to be reviewed (docs/ASSUMPTIONS.md A64).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

WEIGHTS = {"outcomes": 0.5, "ratings": 0.3, "reliability": 0.2}
K_OUTCOMES = 20
K_RATINGS = 10
K_RELIABILITY = 10
MIN_RESOLVED = 10
MIN_LABEL_CONFIDENCE = 0.7
HALF_LIFE_DAYS = 730
OUTCOME_VALUE = {"favourable": 1.0, "mixed": 0.5, "unfavourable": 0.0}


@dataclass(frozen=True, slots=True)
class Outcome:
    label: str
    confidence: float
    decided_on: date | None
    resolved: bool


def recency_weight(decided_on: date | None, today: date) -> float:
    if decided_on is None:
        return 0.5
    age = max(0, (today - decided_on).days)
    return float(0.5 ** (age / HALF_LIFE_DAYS))


def usable(outcomes: list[Outcome]) -> list[Outcome]:
    return [
        o
        for o in outcomes
        if o.resolved and o.confidence >= MIN_LABEL_CONFIDENCE and o.label in OUTCOME_VALUE
    ]


def weighted_rate(outcomes: list[Outcome], today: date) -> tuple[float, float]:
    """(rate, effective sample size)."""
    weights = [recency_weight(o.decided_on, today) for o in outcomes]
    total = sum(weights)
    if total == 0:
        return 0.0, 0.0
    return sum(w * OUTCOME_VALUE[o.label] for w, o in zip(weights, outcomes, strict=True)) / total, total


def shrink(value: float, n: float, prior: float, k: float) -> float:
    return (n * value + k * prior) / (n + k)


@dataclass(frozen=True, slots=True)
class Components:
    outcomes: float
    ratings: float
    reliability: float
    resolved: int

    @property
    def score(self) -> float:
        return 100 * (
            WEIGHTS["outcomes"] * self.outcomes
            + WEIGHTS["ratings"] * self.ratings
            + WEIGHTS["reliability"] * self.reliability
        )

    @property
    def confidence(self) -> str:
        return "high" if self.resolved >= 30 else "medium" if self.resolved >= MIN_RESOLVED else "low"


def outcome_component(outcomes: list[Outcome], prior: float, today: date) -> tuple[float, int]:
    good = usable(outcomes)
    if len(good) < MIN_RESOLVED:
        return prior, len(good)
    rate, n_eff = weighted_rate(good, today)
    return shrink(rate, n_eff, prior, K_OUTCOMES), len(good)


def percentile_ranks(scores: dict[str, float]) -> dict[str, float]:
    """Mid-rank percentile in 0..100 within a cohort (ties share a rank)."""
    values = sorted(scores.values())
    n = len(values)
    out = {}
    for key, value in scores.items():
        below = sum(1 for v in values if v < value)
        equal = sum(1 for v in values if v == value)
        out[key] = 100 * (below + 0.5 * equal) / n if n else 50.0
    return out
