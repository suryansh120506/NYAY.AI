"""The signed-in user: profile, consent records and DPDP rights (brief §0: consent, export, deletion request)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep
from app.core.schemas import ApiModel
from app.db.models.enums import ConsentPurpose, Lang, UserStatus
from app.db.models.tables import (
    AuditLog,
    Consent,
    ConsultSession,
    Document,
    DocumentSummary,
    MatchRequest,
    Message,
    PaymentOrder,
    Wallet,
)
from app.db.tx import transaction
from app.modules.auth.schemas import AuthUser

router = APIRouter(prefix="/v1/me", tags=["users"])


class ProfilePatch(ApiModel):
    display_name: str | None = Field(default=None, max_length=120)
    preferred_lang: Literal["en", "hi"] | None = None


class ConsentIn(ApiModel):
    purpose: Literal["document_processing", "chat_storage", "marketing", "data_retention_extended"]
    granted: bool
    # TODO(human): policy versions come from the reviewed privacy policy.
    policy_version: str = Field(min_length=1, max_length=32)


class ConsentOut(ApiModel):
    purpose: str
    granted: bool
    policy_version: str
    granted_at: datetime


class DeletionRequestOut(ApiModel):
    status: Literal["deletion_requested"]
    requested_at: datetime


@router.get("", response_model=AuthUser)
async def me(user: CurrentUser) -> AuthUser:
    return AuthUser.of(user)


@router.patch("", response_model=AuthUser)
async def update_me(body: ProfilePatch, user: CurrentUser, db: DbDep) -> AuthUser:
    async with transaction(db):
        db.add(user)
        if body.display_name is not None:
            user.display_name = body.display_name.strip() or None
        if body.preferred_lang is not None:
            user.preferred_lang = Lang(body.preferred_lang)
    return AuthUser.of(user)


@router.post("/consents", response_model=ConsentOut, status_code=201)
async def record_consent(body: ConsentIn, user: CurrentUser, db: DbDep) -> ConsentOut:
    """Append-only consent history: a withdrawal is a new row with granted=false (and revokes the previous one)."""
    now = datetime.now(UTC)
    async with transaction(db):
        previous = await db.scalars(
            select(Consent).where(
                Consent.user_id == user.id,
                Consent.purpose == ConsentPurpose(body.purpose),
                Consent.revoked_at.is_(None),
            )
        )
        for row in previous:
            row.revoked_at = now
        consent = Consent(
            user_id=user.id,
            purpose=ConsentPurpose(body.purpose),
            granted=body.granted,
            policy_version=body.policy_version,
        )
        db.add(consent)
        await db.flush()
    return ConsentOut(
        purpose=body.purpose,
        granted=body.granted,
        policy_version=body.policy_version,
        granted_at=consent.granted_at,
    )


@router.post("/export")
async def export_my_data(user: CurrentUser, db: DbDep) -> dict[str, Any]:
    """Everything we hold about the caller, as JSON: profile, consents, wallet, payments, searches, consultations
    (with the messages still within retention) and documents (with their summaries)."""
    async with transaction(db):
        consents = (await db.scalars(select(Consent).where(Consent.user_id == user.id))).all()
        sessions = (await db.scalars(select(ConsultSession).where(ConsultSession.user_id == user.id))).all()
        messages = (
            (
                await db.scalars(
                    select(Message)
                    .where(Message.session_id.in_([s.id for s in sessions]))
                    .order_by(Message.session_id, Message.seq)
                )
            ).all()
            if sessions
            else []
        )
        documents = (await db.scalars(select(Document).where(Document.user_id == user.id))).all()
        summaries = (
            {
                s.document_id: s
                for s in (
                    await db.scalars(
                        select(DocumentSummary).where(
                            DocumentSummary.document_id.in_([d.id for d in documents])
                        )
                    )
                ).all()
            }
            if documents
            else {}
        )
        wallet = await db.scalar(select(Wallet).where(Wallet.user_id == user.id))
        orders = (await db.scalars(select(PaymentOrder).where(PaymentOrder.user_id == user.id))).all()
        matches = (await db.scalars(select(MatchRequest).where(MatchRequest.user_id == user.id))).all()
        db.add(AuditLog(actor_id=user.id, action="data_export", entity="user", entity_id=str(user.id)))
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "profile": {
            "id": str(user.id),
            "phone_e164": user.phone_e164,
            "display_name": user.display_name,
            "preferred_lang": user.preferred_lang.value,
            "created_at": user.created_at.isoformat(),
        },
        "consents": [
            {
                "purpose": c.purpose.value,
                "granted": c.granted,
                "policy_version": c.policy_version,
                "granted_at": c.granted_at.isoformat(),
                "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None,
            }
            for c in consents
        ],
        "wallet": {
            "available_paise": wallet.available_paise if wallet else 0,
            "held_paise": wallet.held_paise if wallet else 0,
            "bonus_paise": wallet.bonus_paise if wallet else 0,
        },
        "payment_orders": [
            {
                "provider": o.provider,
                "amount_paise": o.amount_paise,
                "status": o.status.value,
                "created_at": o.created_at.isoformat(),
            }
            for o in orders
        ],
        "match_requests": [
            {"query_text": m.query_text, "locale": m.locale, "created_at": m.created_at.isoformat()}
            for m in matches
        ],
        "consultations": [
            {
                "id": str(s.id),
                "state": s.state.value,
                "requested_at": s.requested_at.isoformat(),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "billed_minutes": s.billed_minutes,
                "used_seconds": s.used_seconds,
                "charged_paise": s.billed_minutes * (s.adv_rate_paise + s.plat_rate_paise + s.gst_rate_paise)
                - s.refunded_paise,
                "messages": [
                    {
                        "seq": m.seq,
                        "from": "me" if m.sender_id == user.id else "advocate",
                        "text": m.body,
                        "sent_at": m.created_at.isoformat(),
                    }
                    for m in messages
                    if m.session_id == s.id
                ],
            }
            for s in sessions
        ],
        "documents": [
            {
                "id": str(d.id),
                "file_name": d.file_name,
                "status": d.status.value,
                "uploaded_at": d.created_at.isoformat(),
                "delete_after": d.delete_after.isoformat() if d.delete_after else None,
                "summary": list(summaries[d.id].bullets) if d.id in summaries else None,
            }
            for d in documents
        ],
    }


@router.post("/delete-request", response_model=DeletionRequestOut, status_code=202)
async def request_deletion(user: CurrentUser, db: DbDep) -> DeletionRequestOut:
    """Records the request; an operator completes it. Ledger rows are kept (legal retention) but de-identified.

    TODO(human): legal review of retention obligations for financial records vs. DPDP erasure.
    """
    now = datetime.now(UTC)
    async with transaction(db):
        db.add(user)
        user.status = UserStatus.DELETION_REQUESTED
        db.add(AuditLog(actor_id=user.id, action="deletion_requested", entity="user", entity_id=str(user.id)))
    return DeletionRequestOut(status="deletion_requested", requested_at=now)
