"""Saransh endpoints (brief §3.2): upload with explicit consent, poll for the summary, delete (DPDP)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone
from pathlib import PurePath
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Response, UploadFile
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbDep, ProvidersDep
from app.core.errors import AppError
from app.core.ratelimit import enforce
from app.core.schemas import ApiModel
from app.db.models.enums import ConsentPurpose, DocumentStatus, SessionState
from app.db.models.tables import Consent, ConsultSession, Document, DocumentSummary
from app.db.tx import transaction

from . import clauses, service

router = APIRouter(prefix="/v1/saransh", tags=["saransh"])
IST = timezone(timedelta(hours=5, minutes=30))
DOCUMENT_POLICY_VERSION = (
    "documents-2026-10"  # TODO(human): version of the reviewed document-processing notice
)


class DatedItem(ApiModel):
    label: str
    iso: str


class AmountItem(ApiModel):
    label: str
    paise: int


class SaranshResultOut(ApiModel):
    bullets: list[str]
    doc_type: str
    parties: list[str]
    dates: list[DatedItem]
    amounts: list[AmountItem]
    deadlines_mentioned: list[str]
    language: Literal["en", "hi"]
    confidence: float


class DocumentOut(ApiModel):
    id: uuid.UUID
    file_name: str
    status: Literal["uploaded", "processing", "ready", "failed"]
    result: SaranshResultOut | None
    error_code: Literal["unreadable", "too_many_pages"] | None
    is_demo: bool


class UploadOut(ApiModel):
    document_id: uuid.UUID


def _safe_name(name: str | None) -> str:
    base = PurePath((name or "document").replace("\\", "/")).name
    return "".join(ch for ch in base if ch.isprintable())[:200] or "document"


@router.post("/documents", response_model=UploadOut, status_code=202)
async def upload_document(
    user: CurrentUser,
    db: DbDep,
    providers: ProvidersDep,
    file: Annotated[UploadFile, File()],
    consent: Annotated[bool, Form()],
    locale: Annotated[Literal["en", "hi"], Form()] = "en",
    session_id: Annotated[uuid.UUID | None, Form()] = None,
) -> UploadOut:
    settings = providers.settings
    if not consent:
        raise AppError("consent_required", 422, "Please agree to document processing first.")
    await enforce(providers.redis, scope="upload", identity=str(user.id), rule=settings.rate_limit_upload)
    data = await file.read(settings.saransh_max_bytes + 1)
    if len(data) > settings.saransh_max_bytes:
        raise AppError(
            "file_too_large", 413, "The file is larger than allowed.", max_bytes=settings.saransh_max_bytes
        )
    mime = service.sniff_mime(data)
    if mime is None:
        raise AppError("unsupported_type", 415, "Upload a PDF, JPG or PNG.")
    day_start = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    used = await db.scalar(
        select(func.count())
        .select_from(Document)
        .where(Document.user_id == user.id, Document.created_at >= day_start)
    )
    if int(used or 0) >= settings.saransh_daily_cap:
        raise AppError("daily_cap", 429, "Daily document limit reached.", limit=settings.saransh_daily_cap)

    async with transaction(db):
        db.add(
            Consent(
                user_id=user.id,
                purpose=ConsentPurpose.DOCUMENT_PROCESSING,
                granted=True,
                policy_version=DOCUMENT_POLICY_VERSION,
            )
        )
        doc = Document(
            user_id=user.id,
            storage_key="",
            file_name=_safe_name(file.filename),
            mime=mime,
            bytes=len(data),
            locale=locale,
            delete_after=datetime.now(UTC) + timedelta(days=settings.retention_days),
        )
        db.add(doc)
        await db.flush()
        doc.storage_key = (
            str(doc.id) if providers.storage.name == "postgres" else f"documents/{user.id}/{doc.id}"
        )
        if session_id is not None:
            s = await db.get(ConsultSession, session_id, with_for_update=True)
            if (
                s is not None
                and s.user_id == user.id
                and s.state not in (SessionState.SETTLED, SessionState.CANCELLED)
            ):
                s.document_id = doc.id
    await providers.storage.put(doc.storage_key, data, mime)
    service.schedule(providers, doc.id)
    return UploadOut(document_id=doc.id)


async def _visible(db: DbDep, user_id: uuid.UUID, document_id: uuid.UUID) -> Document:
    """The owner, or the advocate of a consultation the owner chose to share this summary with."""
    doc = await db.get(Document, document_id)
    if doc is None:
        raise AppError("not_found", 404)
    if doc.user_id == user_id:
        return doc
    shared = await db.scalar(
        select(ConsultSession.id).where(
            ConsultSession.document_id == document_id,
            ConsultSession.advocate_id == user_id,
            ConsultSession.share_summary.is_(True),
        )
    )
    if shared is None:
        raise AppError("not_found", 404)
    return doc


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(document_id: uuid.UUID, user: CurrentUser, db: DbDep) -> DocumentOut:
    doc = await _visible(db, user.id, document_id)
    summary = await db.get(DocumentSummary, document_id) if doc.status == DocumentStatus.READY else None
    result = None
    if summary is not None:
        extracted = summary.extracted or {}
        result = SaranshResultOut(
            bullets=list(summary.bullets),
            doc_type=summary.doc_type,
            parties=list(extracted.get("parties", [])),
            dates=[DatedItem(**d) for d in extracted.get("dates", [])],
            amounts=[AmountItem(**a) for a in extracted.get("amounts", [])],
            deadlines_mentioned=list(extracted.get("deadlines_mentioned", [])),
            language="hi" if summary.language == "hi" else "en",
            confidence=round(float(summary.confidence), 2),
        )
    error = doc.error_code if doc.error_code in ("unreadable", "too_many_pages") else None
    return DocumentOut(
        id=doc.id,
        file_name=doc.file_name,
        status=doc.status.value,
        result=result,
        error_code=error,
        is_demo=bool(summary is not None and summary.ocr_engine == "fake"),
    )


class ClauseOut(ApiModel):
    number: int
    page: int
    start: int
    end: int
    level: Literal["high", "review", "standard"]
    rule: str | None


class ClausesOut(ApiModel):
    # Named risk_points, not score: user-facing schemas never carry a field that reads like a ranking (test_public_schema).
    risk_points: int
    risk_tier: Literal["low", "moderate", "high"]
    clauses: list[ClauseOut]


@router.get("/documents/{document_id}/clauses", response_model=ClausesOut)
async def get_clauses(
    document_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> ClausesOut:
    """Phase 2 contract: clause-level risk for the web analyser. Invisible (404) until SARANSH_CLAUSES_ENABLED."""
    if not providers.settings.saransh_clauses_enabled:
        raise AppError("not_found", 404)
    doc = await _visible(db, user.id, document_id)
    summary = await db.get(DocumentSummary, document_id) if doc.status == DocumentStatus.READY else None
    stored = (summary.extracted or {}).get("clauses") if summary is not None else None
    if stored is None:
        # Not ready yet, or analysed before the flag was on.
        raise AppError("not_found", 404)
    found = [ClauseOut(**c) for c in stored]
    points = clauses.risk_score([c.level for c in found])
    return ClausesOut(risk_points=points, risk_tier=clauses.risk_tier(points), clauses=found)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> Response:
    doc = await db.get(Document, document_id)
    if doc is None or doc.user_id != user.id:
        raise AppError("not_found", 404)
    key = doc.storage_key
    async with transaction(db):
        await db.delete(await db.get(Document, document_id))
    if providers.storage.name != "postgres":  # postgres blobs cascade with the row
        await providers.storage.delete(key)
    return Response(status_code=204)
