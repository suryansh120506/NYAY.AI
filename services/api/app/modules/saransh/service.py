"""Saransh pipeline: upload → (native PDF text | OCR) → summary (brief §1.2, §4 step 3.6).

Runs in the API process right after the upload (no job queue: no Redis cost); `recover_stuck` (worker, every
5 minutes) re-runs anything an API restart interrupted. The extracted text exists only in memory while the
summary is made: it is never stored and never logged. Documents are deleted after RETENTION_DAYS.
"""

from __future__ import annotations

import asyncio
import io
import uuid
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.logging import get_logger
from app.core.metrics import SARANSH_DOCUMENTS
from app.db.models.enums import DocumentStatus
from app.db.models.tables import Document, DocumentSummary
from app.db.tx import transaction
from app.integrations.ocr.providers import OcrError

from .clauses import analyse as analyse_clauses
from .summarize import summarise

if TYPE_CHECKING:
    from app.core.providers import Providers

log = get_logger("saransh")
NATIVE_TEXT_MIN_CHARS = 200
_tasks: set[asyncio.Task[Any]] = set()


def sniff_mime(data: bytes) -> str | None:
    """Trust the bytes, not the browser's Content-Type."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def pdf_page_texts(data: bytes) -> tuple[int, list[str]]:
    """Page count and the text layer of the first 16 pages, one string per page."""
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise PdfReadError("encrypted")
    return len(reader.pages), [(page.extract_text() or "") for page in reader.pages[:16]]


def schedule(providers: Providers, document_id: uuid.UUID) -> None:
    task = asyncio.create_task(process(providers, document_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _fail(providers: Providers, document_id: uuid.UUID, code: str) -> None:
    async with providers.sessions() as db, db.begin():
        doc = await db.get(Document, document_id, with_for_update=True)
        if doc is not None:
            doc.status = DocumentStatus.FAILED
            doc.error_code = code
    SARANSH_DOCUMENTS.labels(status=code).inc()
    log.info("saransh.failed", document_id=str(document_id), code=code)


async def process(providers: Providers, document_id: uuid.UUID) -> None:
    settings = providers.settings
    async with providers.sessions() as db, db.begin():
        doc = await db.get(Document, document_id, with_for_update=True)
        if doc is None or doc.status in (DocumentStatus.READY, DocumentStatus.FAILED):
            return
        doc.status = DocumentStatus.PROCESSING
        mime, locale, key = doc.mime, doc.locale, doc.storage_key
    try:
        data = await providers.storage.get(key)
        text, confidence, engine, pages = "", 0, "", None
        page_texts: list[str] = []
        if mime == "application/pdf":
            try:
                pages, page_texts = pdf_page_texts(data)
                text = "\n".join(page_texts)
            except (PdfReadError, ValueError, KeyError):
                await _fail(providers, document_id, "unreadable")
                return
            if pages > settings.saransh_max_pages:
                await _fail(providers, document_id, "too_many_pages")
                return
            if len(text.strip()) >= NATIVE_TEXT_MIN_CHARS:
                confidence, engine = 95, "pdf-text"
        if not engine:
            try:
                ocr = await providers.ocr.read(data, mime)
            except OcrError:
                await _fail(providers, document_id, "unreadable")
                return
            text, confidence, engine = ocr.text, ocr.confidence, ocr.engine
            pages = pages or ocr.pages
            page_texts = [ocr.text]  # OCR returns one block; clause offsets then refer to it as page 1
        if len(text.split()) < 8 or confidence < settings.ocr_min_confidence // 2:
            await _fail(providers, document_id, "unreadable")
            return
        summary = await summarise(
            providers.llm, text, locale, timeout=max(10.0, settings.llm_timeout_seconds * 4)
        )
        # Structure only (numbers, offsets, levels), never the clause text.
        clauses = (
            [asdict(c) for c in analyse_clauses(page_texts)] if settings.saransh_clauses_enabled else None
        )
        del text, page_texts  # never stored
        # Below the OCR threshold the summary is still shown, flagged low-confidence (the UI says to read the original).
        summary_confidence = min(summary.confidence, confidence / 100)
        async with providers.sessions() as db, db.begin():
            doc = await db.get(Document, document_id, with_for_update=True)
            if doc is None:
                return
            await db.execute(
                insert(DocumentSummary)
                .values(
                    document_id=document_id,
                    bullets=summary.bullets,
                    doc_type=summary.doc_type,
                    extracted={
                        "parties": summary.parties,
                        "dates": summary.dates,
                        "amounts": summary.amounts,
                        "deadlines_mentioned": summary.deadlines_mentioned,
                        **({"clauses": clauses} if clauses is not None else {}),
                    },
                    language=summary.language,
                    confidence=summary_confidence,
                    ocr_engine=engine,
                    llm_model=summary.model,
                )
                .on_conflict_do_nothing(index_elements=["document_id"])
            )
            doc.status = DocumentStatus.READY
            doc.page_count = pages
            doc.error_code = None
        SARANSH_DOCUMENTS.labels(status="ready").inc()
        log.info(
            "saransh.ready", document_id=str(document_id), engine=engine, llm=summary.model or "extractive"
        )
    except Exception as exc:
        log.exception("saransh.error", document_id=str(document_id), error=type(exc).__name__)
        await _fail(providers, document_id, "unreadable")


async def recover_stuck(providers: Providers) -> int:
    """Re-run documents left UPLOADED/PROCESSING for more than 5 minutes (an API restart mid-pipeline)."""
    cutoff = datetime.now(UTC) - timedelta(minutes=5)
    async with providers.sessions() as db:
        ids = (
            await db.scalars(
                select(Document.id).where(
                    Document.status.in_((DocumentStatus.UPLOADED, DocumentStatus.PROCESSING)),
                    Document.created_at < cutoff,
                )
            )
        ).all()
    for document_id in ids:
        async with providers.sessions() as db, transaction(db):
            doc = await db.get(Document, document_id, with_for_update=True)
            if doc is not None and doc.status == DocumentStatus.PROCESSING:
                doc.status = DocumentStatus.UPLOADED
        await process(providers, document_id)
    return len(ids)
