"""Samvaad REST endpoints (brief §3.2) for the user, plus the advocate's side of a consultation."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, DbDep, ProvidersDep, require_role
from app.core.errors import AppError
from app.core.memlimit import limiter
from app.core.providers import Providers
from app.db.models.enums import Role, SessionState
from app.db.models.tables import AdvocateProfile, ConsultSession, SessionRating, User, Wallet
from app.db.tx import transaction
from app.integrations.calls.providers import LiveKitProvider
from app.modules.parakh.service import courts_for

from .schemas import (
    AdvocateMeOut,
    AdvocateSessionOut,
    AttachDocumentIn,
    AvailabilityIn,
    CallTokenOut,
    EarningsOut,
    RateIn,
    RatingIn,
    ReserveIn,
    SessionAdvocateOut,
    SessionOut,
    StartIn,
    WsTicketOut,
)
from .service import OPEN, rates_of

router = APIRouter(tags=["samvaad"])
AdvocateUser = Annotated[User, Depends(require_role(Role.ADVOCATE))]
TICKET_TTL_SECONDS = 30


def ticket_key(ticket: str) -> str:
    return f"wsticket:{ticket}"


def client_label(user: User | None) -> str:
    """The advocate sees the client's chosen display name or just "Client": never the phone number."""
    return (user.display_name if user and user.display_name else None) or "Client"


async def session_out(db: AsyncSession, providers: Providers, s: ConsultSession, viewer: str) -> SessionOut:
    advocate = await db.get(User, s.advocate_id)
    profile = await db.get(AdvocateProfile, s.advocate_id)
    courts = (await courts_for(db, [s.advocate_id])).get(s.advocate_id, [])
    wallet = await db.get(Wallet, s.user_id) if viewer == "user" else None
    client = await db.get(User, s.user_id) if viewer == "advocate" else None
    charged = int(s.billed_minutes) * rates_of(s).cost
    return SessionOut(
        id=s.id,
        state=s.state.value,
        mode=s.mode.value,
        viewer=viewer,
        advocate=SessionAdvocateOut(
            id=s.advocate_id,
            display_name=(advocate.display_name if advocate else None) or "",
            courts=courts,
            languages=list(profile.languages) if profile else [],
        ),
        client_name=client_label(client) if viewer == "advocate" else None,
        adv_rate_paise=int(s.adv_rate_paise),
        plat_rate_paise=int(s.plat_rate_paise),
        gst_rate_paise=int(s.gst_rate_paise),
        gst_rate_bps=providers.settings.gst_rate_bps,
        held_paise=int(s.held_paise) if viewer == "user" else 0,
        consumed_paise=charged - int(s.refunded_paise),
        billed_minutes=int(s.billed_minutes),
        used_seconds=s.used_seconds,
        refunded_paise=int(s.refunded_paise),
        wallet_available_paise=int(wallet.available_paise) + int(wallet.bonus_paise) if wallet else 0,
        started_at=s.started_at,
        ended_at=s.ended_at,
        end_reason=s.end_reason,
        document_id=s.document_id,
        summary_shared=s.share_summary,
    )


# ------------------------------------------------------------------------------------------------ user side
@router.post("/v1/samvaad/sessions", response_model=SessionOut, status_code=201)
async def reserve_session(
    body: ReserveIn, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> SessionOut:
    limiter.check(f"reserve:{user.id}", "10/60")
    s = await providers.samvaad.reserve(
        db, user, advocate_id=body.advocate_id, match_id=body.match_id, document_id=body.document_id
    )
    return await session_out(db, providers, s, "user")


@router.get("/v1/samvaad/sessions/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> SessionOut:
    s, party = await providers.samvaad.for_party(db, session_id, user)
    return await session_out(db, providers, s, party)


@router.post("/v1/samvaad/sessions/{session_id}/start", response_model=SessionOut)
async def start_session(
    session_id: uuid.UUID, body: StartIn, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> SessionOut:
    s = await providers.samvaad.start(
        db, user, session_id, keep_transcript=body.keep_transcript, share_summary=body.share_summary
    )
    return await session_out(db, providers, s, "user")


@router.post("/v1/samvaad/sessions/{session_id}/end", response_model=SessionOut)
async def end_session(
    session_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> SessionOut:
    """The final trigger (A60): settles to the second and refunds the unused part of the prepaid minutes."""
    s = await providers.samvaad.end(db, user, session_id)
    party = "user" if s.user_id == user.id else "advocate"
    return await session_out(db, providers, s, party)


@router.post("/v1/samvaad/sessions/{session_id}/ws-ticket", response_model=WsTicketOut)
async def ws_ticket(
    session_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> WsTicketOut:
    """One-time, 30-second ticket for the WebSocket URL: the long-lived token never appears in a URL."""
    limiter.check(f"ws:{user.id}", providers.settings.rate_limit_ws)
    s, party = await providers.samvaad.for_party(db, session_id, user)
    if s.state in (SessionState.SETTLED, SessionState.CANCELLED):
        raise AppError("not_found", 404)
    ticket = secrets.token_urlsafe(24)
    await providers.redis.set(ticket_key(ticket), f"{s.id}:{user.id}:{party}", ex=TICKET_TTL_SECONDS)
    return WsTicketOut(ticket=ticket, expires_in=TICKET_TTL_SECONDS)


@router.post("/v1/samvaad/sessions/{session_id}/document", response_model=SessionOut)
async def attach_document(
    session_id: uuid.UUID, body: AttachDocumentIn, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> SessionOut:
    s = await providers.samvaad.attach_document(db, user, session_id, body.document_id)
    return await session_out(db, providers, s, "user")


@router.post("/v1/samvaad/sessions/{session_id}/rating", status_code=204)
async def rate_session(session_id: uuid.UUID, body: RatingIn, user: CurrentUser, db: DbDep) -> Response:
    s = await db.get(ConsultSession, session_id)
    if s is None or s.user_id != user.id or s.state != SessionState.SETTLED:
        raise AppError("not_found", 404)
    async with transaction(db):
        await db.execute(
            insert(SessionRating)
            .values(session_id=session_id, rating=body.rating, tags=body.tags)
            .on_conflict_do_nothing(index_elements=["session_id"])
        )
    return Response(status_code=204)


@router.post("/v1/samvaad/sessions/{session_id}/call-token", response_model=CallTokenOut)
async def call_token(
    session_id: uuid.UUID, user: CurrentUser, db: DbDep, providers: ProvidersDep
) -> CallTokenOut:
    """Audio/video room token for a LIVE session (ENABLE_CALLS=true only; the UI shows Audio as "coming soon")."""
    settings = providers.settings
    if not settings.enable_calls:
        raise AppError("not_found", 404, "Calls are not available yet.")
    s, party = await providers.samvaad.for_party(db, session_id, user)
    if s.state != SessionState.LIVE:
        raise AppError("not_live", 409, "The consultation is not live.")
    provider = LiveKitProvider(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret.get_secret_value(),
    )
    token = provider.token(room=f"samvaad-{s.id}", identity=f"{party}-{user.id}", display_name=party)
    return CallTokenOut(url=token.url, token=token.token, room=token.room, expires_in=token.expires_in)


# -------------------------------------------------------------------------------------------- advocate side
async def _profile(db: AsyncSession, advocate: User) -> AdvocateProfile:
    profile = await db.get(AdvocateProfile, advocate.id)
    if profile is None:
        raise AppError("not_found", 404, "No advocate profile for this account.")
    return profile


def _me(advocate: User, profile: AdvocateProfile, providers: Providers) -> AdvocateMeOut:
    return AdvocateMeOut(
        advocate_id=advocate.id,
        display_name=advocate.display_name or "",
        verification_status=profile.verification_status.value,
        is_available=profile.is_available,
        rate_paise_per_min=int(profile.rate_paise_per_min),
        min_rate_paise=providers.settings.advocate_min_rate_paise,
        max_rate_paise=providers.settings.advocate_max_rate_paise,
    )


@router.get("/v1/advocate/me", response_model=AdvocateMeOut)
async def advocate_me(advocate: AdvocateUser, db: DbDep, providers: ProvidersDep) -> AdvocateMeOut:
    return _me(advocate, await _profile(db, advocate), providers)


@router.patch("/v1/advocate/availability", response_model=AdvocateMeOut)
async def set_availability(
    body: AvailabilityIn, advocate: AdvocateUser, db: DbDep, providers: ProvidersDep
) -> AdvocateMeOut:
    async with transaction(db):
        profile = await _profile(db, advocate)
        profile.is_available = body.is_available
        profile.last_seen_at = datetime.now(UTC)
    return _me(advocate, profile, providers)


@router.patch("/v1/advocate/rate", response_model=AdvocateMeOut)
async def set_rate(body: RateIn, advocate: AdvocateUser, db: DbDep, providers: ProvidersDep) -> AdvocateMeOut:
    """Applies to new consultations only: a reserved or live session keeps the rate it was booked at."""
    settings = providers.settings
    if not settings.advocate_min_rate_paise <= body.rate_paise_per_min <= settings.advocate_max_rate_paise:
        raise AppError(
            "invalid_amount",
            422,
            "Rate is outside the allowed range.",
            min_paise=settings.advocate_min_rate_paise,
            max_paise=settings.advocate_max_rate_paise,
        )
    async with transaction(db):
        profile = await _profile(db, advocate)
        profile.rate_paise_per_min = body.rate_paise_per_min
    return _me(advocate, profile, providers)


@router.get("/v1/advocate/sessions", response_model=list[AdvocateSessionOut])
async def advocate_sessions(advocate: AdvocateUser, db: DbDep) -> list[AdvocateSessionOut]:
    """Open requests first, then the last 30 days. Polled by the dashboard (Postgres only, no Redis)."""
    since = datetime.now(UTC) - timedelta(days=30)
    rows = (
        await db.execute(
            select(ConsultSession, User)
            .join(User, User.id == ConsultSession.user_id)
            .where(
                ConsultSession.advocate_id == advocate.id,
                (ConsultSession.state.in_(OPEN)) | (ConsultSession.requested_at >= since),
            )
            .order_by(ConsultSession.state.in_(OPEN).desc(), ConsultSession.requested_at.desc())
            .limit(100)
        )
    ).all()
    out = []
    for s, client in rows:
        used = s.used_seconds if s.used_seconds is not None else int(s.billed_minutes) * 60
        out.append(
            AdvocateSessionOut(
                id=s.id,
                state=s.state.value,
                client_name=client_label(client),
                requested_at=s.requested_at,
                started_at=s.started_at,
                ended_at=s.ended_at,
                billed_minutes=int(s.billed_minutes),
                used_seconds=s.used_seconds,
                earned_paise=int(s.adv_rate_paise) * used // 60,
                client_ready=s.user_ready_at is not None,
                summary_shared=s.share_summary,
            )
        )
    return out


_EARNINGS = text(
    """
    SELECT COALESCE(-SUM(e.amount_paise), 0) AS payable,
           COALESCE(-SUM(e.amount_paise) FILTER (WHERE e.created_at >= :today), 0) AS today,
           COALESCE(-SUM(e.amount_paise) FILTER (WHERE e.created_at >= :week), 0) AS week
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
     WHERE a.kind = 'advocate_payable' AND a.owner_user_id = :advocate_id
    """
)


@router.get("/v1/advocate/earnings", response_model=EarningsOut)
async def advocate_earnings(advocate: AdvocateUser, db: DbDep) -> EarningsOut:
    now = datetime.now(UTC)
    week = now - timedelta(days=7)
    row = (
        await db.execute(
            _EARNINGS,
            {
                "advocate_id": advocate.id,
                "today": now.replace(hour=0, minute=0, second=0, microsecond=0),
                "week": week,
            },
        )
    ).one()
    sessions = await db.scalar(
        select(func.count())
        .select_from(ConsultSession)
        .where(
            ConsultSession.advocate_id == advocate.id,
            ConsultSession.state == SessionState.SETTLED,
            ConsultSession.ended_at >= week,
        )
    )
    # TODO(human): payouts (schedule, TDS, bank details) are not built; `payable` is what the platform owes.
    return EarningsOut(
        payable_paise=int(row.payable),
        today_paise=int(row.today),
        last_7_days_paise=int(row.week),
        sessions_last_7_days=int(sessions or 0),
    )
