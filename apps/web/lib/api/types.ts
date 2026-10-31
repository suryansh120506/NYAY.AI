/**
 * API contract types for Phase 1. They mirror the FastAPI/Pydantic models planned for Phase 2 (brief §1.5).
 * In Phase 2 these become aliases of the `openapi-typescript` output so the frontend never hand-writes wire types.
 * All money fields are integer paise.
 */
import type { Paise } from "@/lib/money";

export type Locale = "en" | "hi";
export type StateCode = "UP" | "DL";

// ----------------------------------------------------------------------------------------------- news
export type NewsCategory = "supreme_court" | "allahabad_hc" | "delhi_hc" | "legislation";
export const NEWS_CATEGORIES: readonly NewsCategory[] = [
  "supreme_court",
  "allahabad_hc",
  "delhi_hc",
  "legislation",
];

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  /** Publisher-provided excerpt, at most 200 characters. */
  excerpt: string;
  canonical_url: string;
  category: NewsCategory;
  published_at: string;
  image_url: string | null;
}

export interface NewsPage {
  items: NewsItem[];
  next_cursor: string | null;
}

export interface NewsQuery {
  category?: NewsCategory | undefined;
  limit?: number | undefined;
  cursor?: string | null | undefined;
}

// ---------------------------------------------------------------------------------------------- parakh
export type PracticeArea =
  | "tenancy"
  | "cheque_bounce"
  | "consumer"
  | "matrimonial"
  | "criminal_bail"
  | "property"
  | "employment";

export type Forum = "police" | "district_court" | "consumer_forum" | "high_court" | "tribunal";
export type MatchTier = "standard" | "premium";

export interface MatchIntent {
  practice_area: PracticeArea | null;
  sub_issue: string | null;
  forum: Forum | null;
  urgency: "low" | "normal" | "high";
  statutes_mentioned: string[];
  language: "hi" | "en" | "hinglish";
}

export interface MatchRequest {
  query_text: string;
  locale: Locale;
  state?: StateCode;
  district?: string;
  court_hint?: string;
  tier: MatchTier;
}

export interface CourtRef {
  code: string;
  /** English name from the API; the UI localises by `code` and falls back to this. */
  name: string;
}

/** Public, factual advocate fields only. No score or ranking signal of any kind is ever part of this type (brief §1.3). */
export interface AdvocateMatch {
  advocate_id: string;
  display_name: string;
  enrolment_no: string;
  state_bar_council: string;
  courts: CourtRef[];
  languages: string[];
  practice_areas: PracticeArea[];
  years_experience: number;
  rate_paise_per_min: Paise;
  platform_fee_paise_per_min: Paise;
  available_now: boolean;
  /** Premium tier only: one sentence built from matched structured fields. */
  why: string | null;
}

export interface CityOption {
  district: string;
  state: StateCode;
}

/** One follow-up question at a time (docs/ASSUMPTIONS.md A13). */
export interface FollowUp {
  kind: "location";
  primary: CityOption[];
  more: CityOption[];
}

export interface MatchResponse {
  match_id: string;
  intent: MatchIntent;
  results: AdvocateMatch[];
  follow_up: FollowUp | null;
  degraded: boolean;
  location: CityOption | null;
}

// ------------------------------------------------------------------------------------------------ auth
export type Role = "user" | "advocate" | "admin";

export interface AuthUser {
  id: string;
  phone_masked: string;
  display_name: string | null;
  role: Role;
  preferred_lang: Locale;
  is_premium: boolean;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
  expires_at: string;
}

export interface OtpRequestResult {
  resend_after_seconds: number;
}

// ---------------------------------------------------------------------------------------------- wallet
export interface Wallet {
  available_paise: Paise;
  held_paise: Paise;
  bonus_paise: Paise;
}

export type WalletTxnKind =
  "topup" | "consultation" | "release" | "bonus_grant" | "bonus_expiry" | "refund";

export interface WalletTxn {
  id: string;
  kind: WalletTxnKind;
  /** Signed: positive adds to the spendable balance, negative spends it. */
  amount_paise: Paise;
  created_at: string;
  advocate_name: string | null;
  minutes: number | null;
}

export interface TopupOrder {
  order_id: string;
  amount_paise: Paise;
  provider: "fake" | "razorpay";
  /** Public key for the provider's browser checkout (Razorpay key id); empty for the fake. */
  key_id?: string;
}

export type CheckoutResult = "paid" | "dismissed" | "failed";

// --------------------------------------------------------------------------------------------- saransh
export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";

export interface SaranshResult {
  /** Exactly three plain-language bullets in the user's UI language, each at most 22 words. */
  bullets: [string, string, string];
  doc_type: string;
  parties: string[];
  dates: Array<{ label: string; iso: string }>;
  amounts: Array<{ label: string; paise: Paise }>;
  deadlines_mentioned: string[];
  language: Locale;
  /** 0..1 */
  confidence: number;
}

export interface SaranshDocument {
  id: string;
  file_name: string;
  status: DocumentStatus;
  result: SaranshResult | null;
  error_code: "unreadable" | "too_many_pages" | null;
  is_demo: boolean;
}

// --------------------------------------------------------------------------------------------- samvaad
export type SessionState = "RESERVED" | "LIVE" | "ENDING" | "SETTLED" | "CANCELLED";
export type EndReason = "wallet_empty" | "user_ended" | "advocate_ended" | "timeout";

export interface SessionAdvocate {
  id: string;
  display_name: string;
  courts: CourtRef[];
  languages: string[];
}

export interface SessionInfo {
  id: string;
  state: SessionState;
  mode: "chat" | "audio" | "video";
  /** Who is looking: the client sees money, the advocate sees minutes and earnings. */
  viewer: "user" | "advocate";
  advocate: SessionAdvocate;
  /** Shown to the advocate only (display name or "Client"; never a phone number). */
  client_name: string | null;
  adv_rate_paise: Paise;
  plat_rate_paise: Paise;
  gst_rate_paise: Paise;
  gst_rate_bps: number;
  held_paise: Paise;
  /** Charged so far; after settlement, net of the prorated refund. */
  consumed_paise: Paise;
  billed_minutes: number;
  /** Seconds actually used, set at settlement (billing is prorated to the second, A60). */
  used_seconds: number | null;
  /** The unused part of the prepaid minutes returned at the end. */
  refunded_paise: Paise;
  /** Spendable wallet money outside this session's hold (auto-extends the hold, A16). */
  wallet_available_paise: Paise;
  started_at: string | null;
  ended_at: string | null;
  end_reason: EndReason | null;
  document_id: string | null;
  summary_shared: boolean;
}

export interface ReserveRequest {
  advocate_id: string;
  match_id?: string | undefined;
  document_id?: string | undefined;
}

export interface StartRequest {
  chat_storage_consent: true;
  keep_transcript: boolean;
  share_summary: boolean;
}

export interface WsTicket {
  ticket: string;
  expires_in: number;
}

// --------------------------------------------------------------------------------------------- advocate
export interface AdvocateMe {
  advocate_id: string;
  display_name: string;
  verification_status: "pending" | "verified" | "rejected";
  is_available: boolean;
  rate_paise_per_min: Paise;
  min_rate_paise: Paise;
  max_rate_paise: Paise;
}

export interface AdvocateSession {
  id: string;
  state: SessionState;
  client_name: string;
  requested_at: string;
  started_at: string | null;
  ended_at: string | null;
  billed_minutes: number;
  used_seconds: number | null;
  /** The advocate's rate × time used: 100 % of it is the advocate's. */
  earned_paise: Paise;
  client_ready: boolean;
  summary_shared: boolean;
}

export interface AdvocateEarnings {
  payable_paise: Paise;
  today_paise: Paise;
  last_7_days_paise: Paise;
  sessions_last_7_days: number;
}

// ---------------------------------------------------------------------------------------------- errors
export type ApiErrorCode =
  | "insufficient_funds"
  | "session_exists"
  | "invalid_phone"
  | "invalid_otp"
  | "rate_limited"
  | "unauthorized"
  | "not_found"
  | "file_too_large"
  | "unsupported_type"
  | "daily_cap"
  | "consent_required"
  | "invalid_amount"
  | "not_live"
  | "forbidden"
  | "unknown";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(code: ApiErrorCode, status: number, details: Record<string, string | number> = {}) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
