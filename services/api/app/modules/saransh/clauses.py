"""Saransh clause analysis: the phase 2 contract behind SARANSH_CLAUSES_ENABLED (off by default).

Splits a document into numbered clauses and flags the ones worth asking an advocate about, scored the same way the
web preview explains to readers (apps/web/lib/saransh/analysis.ts): 22 points per high-risk clause, 7 per clause to
review, capped at 100. It counts flagged clauses; it is not a prediction and not legal advice.

Only structure is kept: clause number, page, character offsets into that page's extracted text, level and rule id.
The text itself is never stored, like the rest of Saransh; the viewer renders the person's own file and highlights
by offset.

TODO(human): the rules below are keyword heuristics written by an engineer, not reviewed legal positions. Have an
advocate review (and translate for Hindi documents) before the flag is switched on for real users.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Level = Literal["high", "review", "standard"]
Tier = Literal["low", "moderate", "high"]

POINTS: dict[Level, int] = {"high": 22, "review": 7, "standard": 0}

# A clause starts at a line beginning "3.", "3)" or "Clause 3".
_CLAUSE_START = re.compile(r"(?im)^[ \t]*(?:clause[ \t]+)?(\d{1,2})[.)][ \t]+")

# (rule id, level, pattern). First match wins, so the high-risk rules come first.
_RULE_TABLE: tuple[tuple[str, Level, str], ...] = (
    (
        "deposit_forfeiture",
        "high",
        r"\b(?:deposit|advance)\b.{0,100}\b(?:forfeit\w*|non-refundable|not be (?:refunded|returned))",
    ),
    (
        "entry_without_notice",
        "high",
        r"\b(?:enter|entry|inspect)\w*\b.{0,80}\b(?:at any time|without (?:any |prior )?notice)",
    ),
    (
        "waiver_of_rights",
        "high",
        r"\bwaives?\b.{0,40}\b(?:all|any)\b.{0,20}\b(?:rights?|claims?|remed(?:y|ies))\b",
    ),
    (
        "unilateral_change",
        "review",
        r"\b(?:sole|absolute) discretion\b|\b(?:revise|increase|change)\w*\b.{0,60}\bat any time\b",
    ),
    (
        "termination_without_cause",
        "review",
        r"\bterminat\w*\b.{0,100}\bwithout (?:any )?(?:reason|cause|notice)\b",
    ),
    (
        "all_repairs_on_occupant",
        "review",
        r"\b(?:all|any|every)\s+(?:repairs?|maintenance)\b.{0,100}\b(?:tenant|lessee|licensee)\b",
    ),
    (
        "steep_penalty",
        "review",
        r"\b(?:penalty|interest|late fee)\b.{0,60}\d+(?:\.\d+)?\s*%\s*(?:per|a|each)\s+(?:day|week)\b",
    ),
)
RULES: tuple[tuple[str, Level, re.Pattern[str]], ...] = tuple(
    (rule, level, re.compile(pattern, re.IGNORECASE | re.DOTALL)) for rule, level, pattern in _RULE_TABLE
)


@dataclass(frozen=True, slots=True)
class ClauseFinding:
    number: int
    page: int  # 1-based
    start: int  # offsets into that page's extracted text
    end: int
    level: Level
    rule: str | None


def assess(text: str) -> tuple[Level, str | None]:
    for rule, level, pattern in RULES:
        if pattern.search(text):
            return level, rule
    return "standard", None


def analyse(pages: list[str]) -> list[ClauseFinding]:
    """Every numbered clause on every page, assessed. A document without numbered clauses yields none."""
    findings: list[ClauseFinding] = []
    for page_number, page in enumerate(pages, start=1):
        starts = list(_CLAUSE_START.finditer(page))
        for i, match in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(page)
            level, rule = assess(page[match.start() : end])
            findings.append(
                ClauseFinding(
                    number=int(match.group(1)),
                    page=page_number,
                    start=match.start(),
                    end=len(page[:end].rstrip()),
                    level=level,
                    rule=rule,
                )
            )
    return findings


def risk_score(levels: list[Level]) -> int:
    return min(100, sum(POINTS[level] for level in levels))


def risk_tier(score: int) -> Tier:
    if score >= 60:
        return "high"
    if score >= 30:
        return "moderate"
    return "low"
