from enum import StrEnum


class Role(StrEnum):
    USER = "user"
    ADVOCATE = "advocate"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETION_REQUESTED = "deletion_requested"


class Lang(StrEnum):
    EN = "en"
    HI = "hi"


class ConsentPurpose(StrEnum):
    DOCUMENT_PROCESSING = "document_processing"
    CHAT_STORAGE = "chat_storage"
    MARKETING = "marketing"
    DATA_RETENTION_EXTENDED = "data_retention_extended"


class CourtType(StrEnum):
    HIGH_COURT = "high_court"
    DISTRICT = "district"
    TRIBUNAL = "tribunal"
    CONSUMER = "consumer"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class AccountKind(StrEnum):
    USER_AVAILABLE = "user_available"
    USER_HELD = "user_held"
    USER_BONUS = "user_bonus"
    ADVOCATE_PAYABLE = "advocate_payable"
    PLATFORM_REVENUE = "platform_revenue"
    GST_PAYABLE = "gst_payable"
    GATEWAY_CLEARING = "gateway_clearing"
    BONUS_EXPENSE = "bonus_expense"


class TxnKind(StrEnum):
    TOPUP = "topup"
    RESERVE = "reserve"
    MINUTE_DEBIT = "minute_debit"
    RELEASE = "release"
    REFUND = "refund"
    PAYOUT = "payout"
    BONUS_GRANT = "bonus_grant"
    BONUS_EXPIRY = "bonus_expiry"


class PaymentStatus(StrEnum):
    CREATED = "created"
    CAPTURED = "captured"
    FAILED = "failed"
    REFUNDED = "refunded"


class PayoutStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"


class SessionMode(StrEnum):
    CHAT = "chat"
    AUDIO = "audio"
    VIDEO = "video"


class SessionState(StrEnum):
    RESERVED = "RESERVED"
    LIVE = "LIVE"
    ENDING = "ENDING"
    SETTLED = "SETTLED"
    CANCELLED = "CANCELLED"


class MatchTier(StrEnum):
    STANDARD = "standard"
    PREMIUM = "premium"


class DocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class OutcomeSource(StrEnum):
    ECOURTS = "ecourts"
    INDIANKANOON = "indiankanoon"
    FIXTURE = "fixture"


class OutcomeLabel(StrEnum):
    FAVOURABLE = "favourable"
    UNFAVOURABLE = "unfavourable"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class NewsCategory(StrEnum):
    SUPREME_COURT = "supreme_court"
    ALLAHABAD_HC = "allahabad_hc"
    DELHI_HC = "delhi_hc"
    LEGISLATION = "legislation"


class PracticeArea(StrEnum):
    TENANCY = "tenancy"
    CHEQUE_BOUNCE = "cheque_bounce"
    CONSUMER = "consumer"
    MATRIMONIAL = "matrimonial"
    CRIMINAL_BAIL = "criminal_bail"
    PROPERTY = "property"
    EMPLOYMENT = "employment"
