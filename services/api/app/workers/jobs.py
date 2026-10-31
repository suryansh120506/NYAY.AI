"""Background jobs, run by `app.workers.scheduler` (`pnpm worker`).

Every job takes the Providers bundle and is safe to re-run: a missed or doubled run never changes money or data
twice (idempotency keys, ON CONFLICT, append-only scores).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select

from app.core.logging import get_logger
from app.core.providers import Providers
from app.db.models.tables import BonusGrant, Document, Message, Wallet
from app.db.tx import transaction
from app.ledger import operations, verify
from app.modules.news.ingest import ingest_all
from app.modules.parakh.indexing import index_advocates

log = get_logger("jobs")


async def ingest_news(providers: Providers) -> int:
    async with providers.sessions() as db:
        return await ingest_all(
            http=providers.http, redis=providers.redis, db=db, agent=providers.settings.news_user_agent
        )


async def reindex_all(providers: Providers) -> int:
    async with providers.sessions() as db:
        return await index_advocates(providers, db)


async def expire_bonuses(providers: Providers) -> int:
    """Expired grants give back whatever bonus is still unspent (bonus is spent first, so it is FIFO-safe)."""
    expired = 0
    async with providers.sessions() as db:
        grants = (
            await db.scalars(
                select(BonusGrant).where(
                    BonusGrant.expires_at <= datetime.now(UTC), BonusGrant.expired_at.is_(None)
                )
            )
        ).all()
        await db.commit()
        for grant in grants:
            async with transaction(db):
                wallet = await db.scalar(
                    select(Wallet).where(Wallet.user_id == grant.user_id).with_for_update()
                )
                amount = min(grant.amount_paise, wallet.bonus_paise if wallet else 0)
                if amount > 0:
                    await operations.expire_bonus(
                        db, user_id=grant.user_id, amount=amount, idempotency_key=f"bonus-expiry:{grant.id}"
                    )
                db.add(grant)
                grant.expired_at = datetime.now(UTC)
            expired += 1
    return expired


async def verify_ledger(providers: Providers) -> bool:
    """Nightly reconciler: wallets vs entries, every transaction balanced, system total zero."""
    async with providers.sessions() as db:
        health = await verify.check(db)
    if not health.ok:
        log.error("ledger.drift_detected", imbalance=health.imbalance, unbalanced_txns=health.unbalanced_txns)
    return health.ok


async def purge_expired(providers: Providers) -> int:
    """DPDP retention (A32): chat messages and documents past `delete_after` are deleted, document bytes included."""
    now = datetime.now(UTC)
    removed = 0
    async with providers.sessions() as db:
        async with transaction(db):
            result = await db.execute(delete(Message).where(Message.delete_after <= now))
            removed += int(result.rowcount or 0)  # type: ignore[attr-defined]
        docs = (await db.scalars(select(Document).where(Document.delete_after <= now))).all()
        await db.commit()
        for doc in docs:
            await providers.storage.delete(doc.storage_key)
            async with transaction(db):
                await db.execute(delete(Document).where(Document.id == doc.id))
            removed += 1
    if removed:
        log.info("retention.purged", rows=removed)
    return removed


async def recover_documents(providers: Providers) -> int:
    from app.modules.saransh.service import recover_stuck

    return await recover_stuck(providers)


async def compute_praman(providers: Providers) -> int:
    from app.modules.praman.service import compute_all

    async with providers.sessions() as db:
        return await compute_all(db, providers.settings)
