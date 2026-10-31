"""Samvaad REST models and the realtime envelope (brief §3.3; mirrors apps/web/lib/ws/types.ts)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from app.core.schemas import ApiModel
from app.modules.parakh.schemas import CourtRef

EndReason = Literal["wallet_empty", "user_ended", "advocate_ended", "timeout"]


class SessionAdvocateOut(ApiModel):
    id: uuid.UUID
    display_name: str
    courts: list[CourtRef]
    languages: list[str]


class SessionOut(ApiModel):
    id: uuid.UUID
    state: Literal["RESERVED", "LIVE", "ENDING", "SETTLED", "CANCELLED"]
    mode: Literal["chat", "audio", "video"]
    viewer: Literal["user", "advocate"]
    advocate: SessionAdvocateOut
    client_name: str | None = Field(description="Shown to the advocate only; null for the user")
    adv_rate_paise: int
    plat_rate_paise: int
    gst_rate_paise: int
    gst_rate_bps: int
    held_paise: int
    consumed_paise: int = Field(description="Charged so far; after settlement, net of the prorated refund")
    billed_minutes: int
    used_seconds: int | None
    refunded_paise: int
    wallet_available_paise: int
    started_at: datetime | None
    ended_at: datetime | None
    end_reason: EndReason | None
    document_id: uuid.UUID | None
    summary_shared: bool


class ReserveIn(ApiModel):
    advocate_id: uuid.UUID
    match_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None


class StartIn(ApiModel):
    chat_storage_consent: Literal[True]
    keep_transcript: bool = False
    share_summary: bool = False


class AttachDocumentIn(ApiModel):
    document_id: uuid.UUID


class RatingIn(ApiModel):
    rating: Annotated[int, Field(ge=1, le=5)]
    tags: Annotated[list[Annotated[str, Field(max_length=32)]], Field(max_length=6)] = Field(
        default_factory=list
    )


class WsTicketOut(ApiModel):
    ticket: str
    expires_in: int


class CallTokenOut(ApiModel):
    url: str
    token: str
    room: str
    expires_in: int


class MessageOut(ApiModel):
    seq: int
    sender: Literal["user", "advocate"]
    text: str
    ts: datetime


class AdvocateSessionOut(ApiModel):
    id: uuid.UUID
    state: Literal["RESERVED", "LIVE", "ENDING", "SETTLED", "CANCELLED"]
    client_name: str
    requested_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    billed_minutes: int
    used_seconds: int | None
    earned_paise: int = Field(description="The advocate's rate × time used: 100 % of it is the advocate's")
    client_ready: bool
    summary_shared: bool


class AdvocateMeOut(ApiModel):
    advocate_id: uuid.UUID
    display_name: str
    verification_status: Literal["pending", "verified", "rejected"]
    is_available: bool
    rate_paise_per_min: int
    min_rate_paise: int
    max_rate_paise: int


class AvailabilityIn(ApiModel):
    is_available: bool


class RateIn(ApiModel):
    rate_paise_per_min: Annotated[int, Field(strict=True, gt=0)]


class EarningsOut(ApiModel):
    payable_paise: int = Field(description="Owed to the advocate and not yet paid out")
    today_paise: int
    last_7_days_paise: int
    sessions_last_7_days: int


# ------------------------------------------------------------------------------------------- realtime envelope
class MsgSend(ApiModel):
    type: Literal["msg.send"]
    client_msg_id: Annotated[str, Field(min_length=1, max_length=64)]
    text: Annotated[str, Field(min_length=1, max_length=4000)]


class Typing(ApiModel):
    type: Literal["typing"]
    on: bool


class Resume(ApiModel):
    type: Literal["resume"]
    last_seq: Annotated[int, Field(ge=0)]


class Ping(ApiModel):
    type: Literal["ping"]


ClientEvent = Annotated[MsgSend | Typing | Resume | Ping, Field(discriminator="type")]
client_event = TypeAdapter[MsgSend | Typing | Resume | Ping](ClientEvent)
