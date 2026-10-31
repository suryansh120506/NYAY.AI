/**
 * The mock "database" behind every Phase 1 client. Lives in memory and is mirrored to sessionStorage so a demo
 * survives page reloads within the tab. It deliberately mirrors the real money rules: integer paise, a hold that
 * moves from `available` to `held`, per-minute debits out of `held`, and a release of the unused hold at the end.
 */
import type { AuthSession, EndReason, SessionState, Wallet, WalletTxn } from "@/lib/api/types";
import { safeStorage } from "./util";

export interface MockUser {
  id: string;
  is_premium: boolean;
  wallet: Wallet;
  history: WalletTxn[];
  uploads: { day: string; count: number };
}

export interface MockMessage {
  seq: number;
  from: "user" | "advocate";
  text: string;
  ts: string;
  client_msg_id: string | null;
}

export interface MockSession {
  id: string;
  user_id: string;
  advocate_id: string;
  match_id: string | null;
  state: SessionState;
  adv: number;
  plat: number;
  gst: number;
  gst_bps: number;
  /** Total moved into the hold for this session (grows with top-ups and hold extensions). */
  held: number;
  consumed: number;
  minute_idx: number;
  requested_at: number;
  started_at: number | null;
  ended_at: number | null;
  end_reason: EndReason | null;
  document_id: string | null;
  summary_shared: boolean;
  chat_consent: boolean;
  keep_transcript: boolean;
  user_ready: boolean;
  advocate_online: boolean;
  messages: MockMessage[];
  seq: number;
  warned: boolean;
  last_user_seen_at: number;
  rating: { rating: number; tags: string[] } | null;
}

export interface MockDocument {
  id: string;
  user_id: string;
  file_name: string;
  mime: string;
  bytes: number;
  created_at: number;
  ready_at: number;
  outcome: "ready" | "low_confidence" | "failed";
  locale: "en" | "hi";
  session_id: string | null;
}

interface MockState {
  version: 1;
  users: Record<string, MockUser>;
  sessions: Record<string, MockSession>;
  documents: Record<string, MockDocument>;
  auth: AuthSession | null;
  /** Demo override of the billed-minute length (?mockMinuteMs=), docs/ASSUMPTIONS.md A23. */
  minute_ms: number | null;
}

const KEY = "nyay.mock.v1";

const empty = (): MockState => ({
  version: 1,
  users: {},
  sessions: {},
  documents: {},
  auth: null,
  minute_ms: null,
});

let state: MockState | null = null;

export function db(): MockState {
  if (!state) state = safeStorage.get<MockState>(KEY) ?? empty();
  return state;
}

export function persist(): void {
  if (state) safeStorage.set(KEY, state);
}

/** Mutate and persist in one step. */
export function mutate<T>(fn: (s: MockState) => T): T {
  const result = fn(db());
  persist();
  return result;
}

export function resetMockDb(): void {
  state = empty();
  persist();
}
