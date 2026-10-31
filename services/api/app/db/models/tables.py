"""Every table from brief §2.2 (plus `bonus_grants` and `advocate_embeddings`, docs/ASSUMPTIONS.md A45, A47).

Conventions: UUID keys from gen_random_uuid(), timestamptz in UTC, money as BIGINT paise with CHECK constraints,
an index on every foreign key.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    REAL,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, created_at, str_enum, updated_at, uuid_pk
from .enums import (
    AccountKind,
    ConsentPurpose,
    CourtType,
    DocumentStatus,
    Lang,
    MatchTier,
    NewsCategory,
    OutcomeLabel,
    OutcomeSource,
    PaymentStatus,
    PayoutStatus,
    Role,
    SessionMode,
    SessionState,
    TxnKind,
    UserStatus,
    VerificationStatus,
)

EMBEDDING_DIM = 768  # must match EMBEDDING_DIM in .env and migration 0001 (brief §2.4)


def fk(target: str, *, nullable: bool = False, ondelete: str = "RESTRICT") -> Mapped[Any]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=True
    )


# ================================================================================================ identity
class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uuid_pk()
    phone_e164: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    role: Mapped[Role] = mapped_column(
        str_enum(Role, "user_role"), nullable=False, server_default=Role.USER.value
    )
    display_name: Mapped[str | None] = mapped_column(String(120))
    preferred_lang: Mapped[Lang] = mapped_column(
        str_enum(Lang, "user_lang"), nullable=False, server_default="en"
    )
    is_premium: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus, "user_status"), nullable=False, server_default=UserStatus.ACTIVE.value
    )
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    purpose: Mapped[ConsentPurpose] = mapped_column(
        str_enum(ConsentPurpose, "consent_purpose"), nullable=False
    )
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_at: Mapped[datetime] = created_at()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    device_info: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = created_at()


# ===================================================================================== advocates & courts
class Court(Base):
    __tablename__ = "courts"
    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    court_type: Mapped[CourtType] = mapped_column(str_enum(CourtType, "court_type"), nullable=False)
    state_code: Mapped[str] = mapped_column(String(4), nullable=False)
    district: Mapped[str | None] = mapped_column(String(64))
    parent_court_id: Mapped[uuid.UUID | None] = fk("courts.id", nullable=True)
    __table_args__ = (Index("ix_courts_state_district", "state_code", "district"),)


class AdvocateProfile(Base):
    __tablename__ = "advocate_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    enrolment_no: Mapped[str] = mapped_column(String(48), nullable=False)
    state_bar_council: Mapped[str] = mapped_column(String(96), nullable=False)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        str_enum(VerificationStatus, "verification_status"),
        nullable=False,
        server_default=VerificationStatus.PENDING.value,
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    headline: Mapped[str] = mapped_column(String(240), nullable=False, server_default="")
    years_experience: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(8)), nullable=False, server_default="{}")
    practice_areas: Mapped[list[str]] = mapped_column(ARRAY(String(32)), nullable=False, server_default="{}")
    rate_paise_per_min: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    avg_response_seconds: Mapped[int | None] = mapped_column(Integer)
    embedding_version: Mapped[str | None] = mapped_column(String(64))
    embedding_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
    __table_args__ = (
        UniqueConstraint("state_bar_council", "enrolment_no"),
        CheckConstraint("rate_paise_per_min > 0", name="rate_positive"),
        CheckConstraint("years_experience >= 0", name="experience_non_negative"),
        Index("ix_advocate_profiles_practice_areas", "practice_areas", postgresql_using="gin"),
        Index("ix_advocate_profiles_languages", "languages", postgresql_using="gin"),
    )


class AdvocateCourt(Base):
    __tablename__ = "advocate_courts"
    advocate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("advocate_profiles.user_id", ondelete="CASCADE"), index=True
    )
    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id", ondelete="CASCADE"), index=True
    )
    __table_args__ = (PrimaryKeyConstraint("advocate_id", "court_id"),)


class AdvocateEmbedding(Base):
    """pgvector replacement for the Chroma collection `advocates_v1` (A47). Scalars only besides the vector."""

    __tablename__ = "advocate_embeddings"
    advocate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("advocate_profiles.user_id", ondelete="CASCADE"), primary_key=True
    )
    document: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    embedding_version: Mapped[str] = mapped_column(String(64), nullable=False)
    primary_court_code: Mapped[str | None] = mapped_column(String(48))
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    updated_at: Mapped[datetime] = updated_at()
    __table_args__ = (
        Index(
            "ix_advocate_embeddings_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


# ================================================================================================== money
class LedgerAccount(Base):
    __tablename__ = "ledger_accounts"
    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[AccountKind] = mapped_column(str_enum(AccountKind, "account_kind"), nullable=False)
    owner_user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (UniqueConstraint("kind", "owner_user_id", postgresql_nulls_not_distinct=True),)


class LedgerTxn(Base):
    __tablename__ = "ledger_txns"
    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[TxnKind] = mapped_column(str_enum(TxnKind, "txn_kind"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    session_id: Mapped[uuid.UUID | None] = fk("sessions.id", nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = created_at()


class LedgerEntry(Base):
    """Append-only. Signed amounts: positive = debit, negative = credit; every txn sums to zero (deferred trigger)."""

    __tablename__ = "ledger_entries"
    id: Mapped[uuid.UUID] = uuid_pk()
    txn_id: Mapped[uuid.UUID] = fk("ledger_txns.id")
    account_id: Mapped[uuid.UUID] = fk("ledger_accounts.id")
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("amount_paise <> 0", name="amount_non_zero"),)


class Wallet(Base):
    """Projection of the ledger, updated in the same transaction as the entries (brief §2.2)."""

    __tablename__ = "wallets"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    available_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    held_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    bonus_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    updated_at: Mapped[datetime] = updated_at()
    __table_args__ = (
        CheckConstraint("available_paise >= 0", name="available_non_negative"),
        CheckConstraint("held_paise >= 0", name="held_non_negative"),
        CheckConstraint("bonus_paise >= 0", name="bonus_non_negative"),
    )


class BonusGrant(Base):
    """Bonus credit is non-refundable and expires (brief §1.4); this records when each grant lapses (A45)."""

    __tablename__ = "bonus_grants"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str] = mapped_column(String(80), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("amount_paise > 0", name="amount_positive"),)


class PaymentOrder(Base):
    __tablename__ = "payment_orders"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_order_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        str_enum(PaymentStatus, "payment_status"), nullable=False, server_default=PaymentStatus.CREATED.value
    )
    raw_webhook: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
    __table_args__ = (CheckConstraint("amount_paise > 0", name="amount_positive"),)


class Payout(Base):
    __tablename__ = "payouts"
    id: Mapped[uuid.UUID] = uuid_pk()
    advocate_id: Mapped[uuid.UUID] = fk("advocate_profiles.user_id")
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[PayoutStatus] = mapped_column(
        str_enum(PayoutStatus, "payout_status"), nullable=False, server_default=PayoutStatus.PENDING.value
    )
    provider_ref: Mapped[str | None] = mapped_column(String(64))
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("amount_paise > 0", name="amount_positive"),)


# ========================================================================================== consultations
class ConsultSession(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    advocate_id: Mapped[uuid.UUID] = fk("advocate_profiles.user_id")
    mode: Mapped[SessionMode] = mapped_column(
        str_enum(SessionMode, "session_mode"), nullable=False, server_default=SessionMode.CHAT.value
    )
    state: Mapped[SessionState] = mapped_column(
        str_enum(SessionState, "session_state"), nullable=False, server_default=SessionState.RESERVED.value
    )
    adv_rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    plat_rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    gst_rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    held_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    billed_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Part of the hold that came from bonus credit (spent first, returned to bonus on release).
    held_bonus_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    # Prorated settlement (owner decision A60): seconds actually used and the unused part of charged minutes returned.
    used_seconds: Mapped[int | None] = mapped_column(Integer)
    refunded_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    user_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    keep_transcript: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    share_summary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # Per-session message sequence counter (UPDATE … RETURNING keeps seq strictly increasing across instances).
    last_seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Presence, kept in Postgres so it costs no Redis requests and survives an API restart: open sockets per party
    # and the last sign of life (connect, ping, disconnect). Offline = no fresh sign of life for HEARTBEAT_TIMEOUT.
    user_conns: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    advocate_conns: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    user_last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    advocate_last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(String(32))
    requested_at: Mapped[datetime] = created_at()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    match_id: Mapped[uuid.UUID | None] = fk("match_requests.id", nullable=True, ondelete="SET NULL")
    document_id: Mapped[uuid.UUID | None] = fk("documents.id", nullable=True, ondelete="SET NULL")
    __table_args__ = (
        CheckConstraint("adv_rate_paise > 0", name="adv_rate_positive"),
        CheckConstraint("plat_rate_paise >= 0", name="plat_rate_non_negative"),
        CheckConstraint("gst_rate_paise >= 0", name="gst_rate_non_negative"),
        CheckConstraint("held_paise >= 0", name="held_non_negative"),
        CheckConstraint("billed_minutes >= 0", name="billed_non_negative"),
        CheckConstraint("held_bonus_paise >= 0 AND held_bonus_paise <= held_paise", name="held_bonus_range"),
        CheckConstraint("refunded_paise >= 0", name="refunded_non_negative"),
        Index("ix_sessions_state", "state", postgresql_where=text("state IN ('RESERVED','LIVE','ENDING')")),
        Index("ix_sessions_advocate_requested", "advocate_id", "requested_at"),
        # Invariant (a): one live (non-terminal) session per user.
        Index(
            "uq_sessions_one_open_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("state IN ('RESERVED','LIVE','ENDING')"),
        ),
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = fk("sessions.id", ondelete="CASCADE")
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    sender_id: Mapped[uuid.UUID] = fk("users.id")
    client_msg_id: Mapped[str] = mapped_column(String(64), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at()
    delete_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    __table_args__ = (UniqueConstraint("session_id", "seq"), UniqueConstraint("session_id", "client_msg_id"))


class SessionRating(Base):
    __tablename__ = "session_ratings"
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(32)), nullable=False, server_default="{}")
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),)


# ============================================================================ parakh, saransh, praman, news
class MatchRequest(Base):
    __tablename__ = "match_requests"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    visitor_id: Mapped[str | None] = mapped_column(String(64), index=True)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    intent: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    tier: Mapped[MatchTier] = mapped_column(str_enum(MatchTier, "match_tier"), nullable=False)
    results: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    chosen_advocate_id: Mapped[uuid.UUID | None] = fk("advocate_profiles.user_id", nullable=True)
    created_at: Mapped[datetime] = created_at()


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    storage_key: Mapped[str] = mapped_column(String(256), nullable=False)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False, server_default="")
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    page_count: Mapped[int | None] = mapped_column(SmallInteger)
    status: Mapped[DocumentStatus] = mapped_column(
        str_enum(DocumentStatus, "document_status"),
        nullable=False,
        server_default=DocumentStatus.UPLOADED.value,
    )
    error_code: Mapped[str | None] = mapped_column(String(32))
    locale: Mapped[str] = mapped_column(String(8), nullable=False, server_default="en")
    delete_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("bytes > 0", name="bytes_positive"),)


class DocumentBlob(Base):
    """STORAGE_PROVIDER=postgres: document bytes kept in the database, so dev setups need no bucket and no local
    files (A61). Production uses an S3-compatible bucket (Supabase Storage) instead."""

    __tablename__ = "document_blobs"
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class DocumentSummary(Base):
    __tablename__ = "document_summaries"
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    bullets: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    confidence: Mapped[float] = mapped_column(REAL, nullable=False)
    ocr_engine: Mapped[str | None] = mapped_column(String(32))
    llm_model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (CheckConstraint("cardinality(bullets) = 3", name="three_bullets"),)


class CaseOutcome(Base):
    __tablename__ = "case_outcomes"
    id: Mapped[uuid.UUID] = uuid_pk()
    advocate_id: Mapped[uuid.UUID | None] = fk("advocate_profiles.user_id", nullable=True)
    source: Mapped[OutcomeSource] = mapped_column(str_enum(OutcomeSource, "outcome_source"), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    court_id: Mapped[uuid.UUID | None] = fk("courts.id", nullable=True)
    practice_area: Mapped[str] = mapped_column(String(32), nullable=False)
    decided_on: Mapped[date | None] = mapped_column(Date)
    outcome_label: Mapped[OutcomeLabel] = mapped_column(
        str_enum(OutcomeLabel, "outcome_label"), nullable=False
    )
    label_confidence: Mapped[float] = mapped_column(REAL, nullable=False)
    raw_order_ref: Mapped[str | None] = mapped_column(String(256))
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    __table_args__ = (
        UniqueConstraint("source", "source_ref", "advocate_id", postgresql_nulls_not_distinct=True),
        CheckConstraint("label_confidence BETWEEN 0 AND 1", name="confidence_range"),
    )


class PramanScore(Base):
    """Append-only score history; `praman_latest` view selects the newest row per advocate and cohort."""

    __tablename__ = "praman_scores"
    id: Mapped[uuid.UUID] = uuid_pk()
    advocate_id: Mapped[uuid.UUID] = fk("advocate_profiles.user_id")
    practice_area: Mapped[str] = mapped_column(String(32), nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    percentile: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    components: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[str] = mapped_column(String(16), nullable=False)
    computed_at: Mapped[datetime] = created_at()
    __table_args__ = (
        CheckConstraint("score BETWEEN 0 AND 100", name="score_range"),
        CheckConstraint("percentile BETWEEN 0 AND 100", name="percentile_range"),
        Index("ix_praman_scores_latest", "advocate_id", "practice_area", "computed_at"),
    )


class NewsItem(Base):
    __tablename__ = "news_items"
    id: Mapped[uuid.UUID] = uuid_pk()
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    title: Mapped[str] = mapped_column(String(400), nullable=False)
    excerpt: Mapped[str] = mapped_column(String(200), nullable=False, server_default="")
    canonical_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    category: Mapped[NewsCategory] = mapped_column(str_enum(NewsCategory, "news_category"), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = created_at()
    __table_args__ = (
        CheckConstraint("char_length(excerpt) <= 200", name="excerpt_length"),
        Index("ix_news_items_feed", "category", "published_at", "id"),
        Index("ix_news_items_published", "published_at", "id"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[uuid.UUID] = uuid_pk()
    actor_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = created_at()
