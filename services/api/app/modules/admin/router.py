"""Admin-only endpoints. Every action is written to the audit log."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import select, text

from app.core.deps import DbDep, ProvidersDep, require_role
from app.core.errors import AppError
from app.core.schemas import ApiModel
from app.db.models.enums import Role, VerificationStatus
from app.db.models.tables import AdvocateProfile, AuditLog, BonusGrant, User
from app.db.tx import transaction
from app.ledger import operations, verify
from app.modules.parakh.indexing import index_advocates

router = APIRouter(prefix="/v1/admin", tags=["admin"])
AdminUser = Annotated[User, Depends(require_role(Role.ADMIN))]


class DriftOut(ApiModel):
    user_id: uuid.UUID
    column: str
    projected: int
    from_ledger: int


class LedgerHealthOut(ApiModel):
    ok: bool
    imbalance: int
    system_total: int
    unbalanced_txns: int
    drift: list[DriftOut]


class VerifyOut(ApiModel):
    advocate_id: uuid.UUID
    verification_status: str
    reindexed: bool


class BonusIn(ApiModel):
    user_id: uuid.UUID
    amount_paise: Annotated[int, Field(strict=True, gt=0, le=1_000_000)]
    reason: Annotated[str, Field(min_length=3, max_length=80)]
    valid_days: Annotated[int, Field(ge=1, le=365)] = 30


@router.get("/ledger/health", response_model=LedgerHealthOut)
async def ledger_health(admin: AdminUser, db: DbDep) -> LedgerHealthOut:
    health = await verify.check(db)
    return LedgerHealthOut(
        ok=health.ok,
        imbalance=health.imbalance,
        system_total=health.system_total,
        unbalanced_txns=health.unbalanced_txns,
        drift=[DriftOut(**d.__dict__) for d in health.drift[:100]],
    )


@router.post("/advocates/{advocate_id}/verify", response_model=VerifyOut)
async def verify_advocate(
    advocate_id: uuid.UUID, admin: AdminUser, db: DbDep, providers: ProvidersDep
) -> VerifyOut:
    async with transaction(db):
        profile = await db.scalar(
            select(AdvocateProfile).where(AdvocateProfile.user_id == advocate_id).with_for_update()
        )
        if profile is None:
            raise AppError("not_found", 404)
        profile.verification_status = VerificationStatus.VERIFIED
        profile.verified_at = datetime.now(UTC)
        db.add(
            AuditLog(
                actor_id=admin.id, action="advocate_verified", entity="advocate", entity_id=str(advocate_id)
            )
        )
    reindexed = await index_advocates(providers, db, [advocate_id]) == 1
    return VerifyOut(advocate_id=advocate_id, verification_status="verified", reindexed=reindexed)


class PramanRowOut(ApiModel):
    practice_area: str
    score: float
    percentile: float
    components: dict[str, float]
    sample_size: int
    confidence: str
    computed_at: datetime


class PramanOut(ApiModel):
    advocate_id: uuid.UUID
    rows: list[PramanRowOut]


@router.get("/praman/{advocate_id}", response_model=PramanOut)
async def praman_for_advocate(advocate_id: uuid.UUID, admin: AdminUser, db: DbDep) -> PramanOut:
    """Internal TrustScore (brief §1.2): admins only, every read written to the audit log, never shown to users."""
    rows = (
        (
            await db.execute(
                text(
                    "SELECT practice_area, score, percentile, components, sample_size, confidence, computed_at"
                    " FROM praman_latest WHERE advocate_id = :id ORDER BY practice_area"
                ),
                {"id": advocate_id},
            )
        )
        .mappings()
        .all()
    )
    async with transaction(db):
        db.add(
            AuditLog(actor_id=admin.id, action="praman_viewed", entity="advocate", entity_id=str(advocate_id))
        )
    return PramanOut(
        advocate_id=advocate_id,
        rows=[
            PramanRowOut(
                practice_area=r["practice_area"],
                score=float(r["score"]),
                percentile=float(r["percentile"]),
                components={k: float(v) for k, v in (r["components"] or {}).items()},
                sample_size=int(r["sample_size"]),
                confidence=str(r["confidence"]),
                computed_at=r["computed_at"],
            )
            for r in rows
        ],
    )


@router.post("/praman/recompute", status_code=202)
async def praman_recompute(admin: AdminUser, db: DbDep, providers: ProvidersDep) -> dict[str, int]:
    from app.modules.praman.service import compute_all

    async with transaction(db):
        db.add(AuditLog(actor_id=admin.id, action="praman_recomputed", entity="praman", entity_id=None))
    return {"rows": await compute_all(db, providers.settings)}


@router.post("/bonus", status_code=201)
async def grant_bonus(body: BonusIn, admin: AdminUser, db: DbDep) -> dict[str, str]:
    """Non-refundable, expiring credit, spent before the paid balance (brief §1.4)."""
    async with transaction(db):
        grant = BonusGrant(
            user_id=body.user_id,
            amount_paise=body.amount_paise,
            reason=body.reason,
            expires_at=datetime.now(UTC) + timedelta(days=body.valid_days),
        )
        db.add(grant)
        await db.flush()
        await operations.grant_bonus(
            db, user_id=body.user_id, amount=body.amount_paise, idempotency_key=f"bonus:{grant.id}"
        )
        db.add(
            AuditLog(
                actor_id=admin.id,
                action="bonus_granted",
                entity="user",
                entity_id=str(body.user_id),
                meta={"amount_paise": body.amount_paise, "reason": body.reason},
            )
        )
    return {"grant_id": str(grant.id)}
