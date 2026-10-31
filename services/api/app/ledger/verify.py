"""Recompute wallets from the ledger and report drift (brief §2.2 `ledger/verify.py`).

Run as a job (`uv run python -m app.ledger.verify`) or via GET /v1/admin/ledger/health. Any drift or any unbalanced
transaction is an incident: see docs/ARCHITECTURE.md "Alert: ledger imbalance".
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import configure_logging, get_logger


@dataclass(frozen=True, slots=True)
class WalletDrift:
    user_id: uuid.UUID
    column: str
    projected: int
    from_ledger: int


@dataclass(frozen=True, slots=True)
class LedgerHealth:
    system_total: int
    unbalanced_txns: int
    drift: list[WalletDrift] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.system_total == 0 and self.unbalanced_txns == 0 and not self.drift

    @property
    def imbalance(self) -> int:
        """The number the gate script prints: 0 means every paisa is accounted for."""
        return abs(self.system_total) + self.unbalanced_txns + len(self.drift)


_RECOMPUTE = text(
    """
    WITH ledger AS (
        SELECT a.owner_user_id AS user_id,
               COALESCE(-SUM(e.amount_paise) FILTER (WHERE a.kind = 'user_available'), 0) AS available_paise,
               COALESCE(-SUM(e.amount_paise) FILTER (WHERE a.kind = 'user_held'), 0)      AS held_paise,
               COALESCE(-SUM(e.amount_paise) FILTER (WHERE a.kind = 'user_bonus'), 0)     AS bonus_paise
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id
         WHERE a.kind IN ('user_available', 'user_held', 'user_bonus')
         GROUP BY a.owner_user_id
    )
    SELECT w.user_id,
           w.available_paise, COALESCE(l.available_paise, 0) AS l_available,
           w.held_paise,      COALESCE(l.held_paise, 0)      AS l_held,
           w.bonus_paise,     COALESCE(l.bonus_paise, 0)     AS l_bonus
      FROM wallets w
      FULL OUTER JOIN ledger l ON l.user_id = w.user_id
     WHERE COALESCE(w.available_paise, 0) <> COALESCE(l.available_paise, 0)
        OR COALESCE(w.held_paise, 0)      <> COALESCE(l.held_paise, 0)
        OR COALESCE(w.bonus_paise, 0)     <> COALESCE(l.bonus_paise, 0)
    """
)


async def check(db: AsyncSession) -> LedgerHealth:
    total = int(await db.scalar(text("SELECT COALESCE(SUM(amount_paise), 0) FROM ledger_entries")) or 0)
    unbalanced = int(
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM (SELECT txn_id FROM ledger_entries GROUP BY txn_id "
                "HAVING SUM(amount_paise) <> 0 OR COUNT(*) < 2) t"
            )
        )
        or 0
    )
    drift: list[WalletDrift] = []
    for row in (await db.execute(_RECOMPUTE)).mappings():
        for column, ledger_column in (
            ("available_paise", "l_available"),
            ("held_paise", "l_held"),
            ("bonus_paise", "l_bonus"),
        ):
            projected, from_ledger = int(row[column] or 0), int(row[ledger_column] or 0)
            if projected != from_ledger:
                drift.append(WalletDrift(row["user_id"], column, projected, from_ledger))
    return LedgerHealth(system_total=total, unbalanced_txns=unbalanced, drift=drift)


async def _main() -> int:
    from app.core.config import get_settings
    from app.db.session import get_sessionmaker

    configure_logging(get_settings().log_level)
    log = get_logger("ledger.verify")
    async with get_sessionmaker()() as db:
        health = await check(db)
    if health.ok:
        log.info("ledger.ok", system_total=health.system_total)
        return 0
    log.error(
        "ledger.drift_detected",
        system_total=health.system_total,
        unbalanced_txns=health.unbalanced_txns,
        drift=[d.__dict__ for d in health.drift[:50]],
    )
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
