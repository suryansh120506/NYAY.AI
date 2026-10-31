/**
 * In-tab fake of the Samvaad backend for the offline demo (brief §4 Phase 1 step 6). It follows the real billing
 * semantics from brief §1.3 so the UI is exercised against realistic behaviour:
 *  - prepaid: minute n is debited at the start of minute n, the moment both parties are connected;
 *  - the minute index is computed from `started_at`, missed minutes are billed in order (catch-up);
 *  - a debit for an index already billed is a no-op (the `minute_idx` guard);
 *  - one warning when the spendable balance is ≤ 2 × the per-minute cost, termination when it can't cover a minute;
 *  - a mid-call top-up raises the hold and re-arms the warning; the unused hold is released at the end;
 *  - 30 s without the user connected ends the session (`timeout`).
 * Real minutes are 60 s; the demo shortens them (docs/ASSUMPTIONS.md A23).
 */
import { publicConfig } from "@/lib/config";
import { ApiError, type SessionInfo, type SessionState, type StartRequest } from "@/lib/api/types";
import { detectLang } from "@/lib/text";
import {
  WS_CLOSE,
  type ClientEvent,
  type ServerEvent,
  type TerminationReason,
} from "@/lib/ws/types";
import { db, mutate, persist, type MockSession, type MockUser } from "./db";
import {
  GST_ON_PLATFORM_FEE_PAISE,
  GST_RATE_BPS,
  PLATFORM_FEE_PAISE,
  RESERVATION_TTL_MS,
  RESERVE_CAP_PAISE,
} from "./constants";
import { courtRef, findAdvocate } from "./fixtures";
import { ADVOCATE_GREETING, ADVOCATE_REPLIES } from "./scripts";
import { uid } from "./util";

export interface MockPeer {
  deliver(event: ServerEvent): void;
  serverClose(code: number, reason: string): void;
}

const HEARTBEAT_TIMEOUT_MS = 30_000;
const TICKET_TTL_MS = 30_000;
const RESERVE_MINUTES = 5;
const TERMINAL: ReadonlySet<SessionState> = new Set<SessionState>(["SETTLED", "CANCELLED"]);

const peers = new Map<string, Set<MockPeer>>();
const tickets = new Map<string, { sessionId: string; userId: string; expiresAt: number }>();
const billingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const outages = new Map<string, number>();
const failNextSend = new Set<string>();
const pendingReply = new Set<string>();
let recovered = false;

// ------------------------------------------------------------------------------------------------- time
export function minuteMs(): number {
  return db().minute_ms ?? publicConfig.mockMinuteMs;
}

/** How much faster than real time the demo clock runs (1 in production). */
export function clockRate(): number {
  return 60_000 / minuteMs();
}

export function setMinuteMsOverride(ms: number | null): void {
  mutate((s) => {
    s.minute_ms = ms;
  });
}

// ---------------------------------------------------------------------------------------------- helpers
const cost = (s: MockSession) => s.adv + s.plat + s.gst;

function userOf(s: MockSession): MockUser {
  const user = db().users[s.user_id];
  if (!user) throw new ApiError("unauthorized", 401);
  return user;
}

/** What the user can still spend in this session: the rest of the hold plus wallet money that can extend it (A15). */
function spendable(s: MockSession): number {
  return Math.max(0, s.held - s.consumed) + userOf(s).wallet.available_paise;
}

function remainingSeconds(s: MockSession): number {
  if (s.started_at === null) return 0;
  const affordable = Math.floor(spendable(s) / cost(s));
  const elapsed = ((Date.now() - s.started_at) / 1000) * clockRate();
  return Math.max(0, Math.round((s.minute_idx + affordable) * 60 - elapsed));
}

function broadcast(sessionId: string, event: ServerEvent): void {
  peers.get(sessionId)?.forEach((peer) => peer.deliver(event));
}

function closeAll(sessionId: string, code: number, reason: string): void {
  const set = peers.get(sessionId);
  if (!set) return;
  peers.delete(sessionId);
  set.forEach((peer) => peer.serverClose(code, reason));
}

function sessionFor(userId: string, sessionId: string): MockSession {
  ensureRecovered();
  const session = db().sessions[sessionId];
  if (!session || session.user_id !== userId) throw new ApiError("not_found", 404);
  return session;
}

export function toSessionInfo(s: MockSession): SessionInfo {
  const advocate = findAdvocate(s.advocate_id);
  return {
    id: s.id,
    state: s.state,
    mode: "chat",
    viewer: "user",
    client_name: null,
    advocate: {
      id: s.advocate_id,
      display_name: advocate?.display_name ?? s.advocate_id,
      courts: (advocate?.courts ?? []).map(courtRef),
      languages: advocate?.languages ?? [],
    },
    adv_rate_paise: s.adv,
    plat_rate_paise: s.plat,
    gst_rate_paise: s.gst,
    gst_rate_bps: s.gst_bps,
    held_paise: s.held,
    consumed_paise: s.consumed,
    billed_minutes: s.minute_idx,
    // The offline demo bills whole minutes; the real API prorates the last one to the second (A60).
    used_seconds: s.ended_at === null ? null : s.minute_idx * 60,
    refunded_paise: 0,
    wallet_available_paise: db().users[s.user_id]?.wallet.available_paise ?? 0,
    started_at: s.started_at === null ? null : new Date(s.started_at).toISOString(),
    ended_at: s.ended_at === null ? null : new Date(s.ended_at).toISOString(),
    end_reason: s.end_reason,
    document_id: s.document_id,
    summary_shared: s.summary_shared,
  };
}

// ---------------------------------------------------------------------------------------------- billing
function extendHold(s: MockSession): void {
  const user = userOf(s);
  const amount = Math.min(user.wallet.available_paise, RESERVE_CAP_PAISE);
  if (amount <= 0) return;
  user.wallet.available_paise -= amount;
  user.wallet.held_paise += amount;
  s.held += amount;
}

/** Same contract as the Lua debit script: OK | DUPLICATE | INSUFFICIENT. */
function debit(s: MockSession, minute: number): "OK" | "DUPLICATE" | "INSUFFICIENT" {
  if (s.minute_idx >= minute) return "DUPLICATE";
  const perMinute = cost(s);
  if (s.held - s.consumed < perMinute) extendHold(s);
  if (s.held - s.consumed < perMinute) return "INSUFFICIENT";
  s.consumed += perMinute;
  s.minute_idx = minute;
  userOf(s).wallet.held_paise -= perMinute;
  return "OK";
}

function emitTick(s: MockSession): void {
  broadcast(s.id, {
    type: "session.tick",
    minute: s.minute_idx,
    balance_paise: spendable(s),
    remaining_seconds: remainingSeconds(s),
  });
}

function maybeWarn(s: MockSession): void {
  if (spendable(s) <= 2 * cost(s)) {
    if (!s.warned) {
      s.warned = true;
      broadcast(s.id, { type: "session.warning", seconds_left: remainingSeconds(s) });
    }
  } else {
    s.warned = false;
  }
}

/** Bill every minute that is due up to `at` (catch-up after a late tick). Returns false if the session ended. */
function billThrough(s: MockSession, at: number): boolean {
  if (s.started_at === null) return false;
  const due = Math.floor((at - s.started_at) / minuteMs()) + 1;
  for (let minute = s.minute_idx + 1; minute <= due; minute++) {
    if (debit(s, minute) === "INSUFFICIENT") {
      terminate(s, "wallet_empty");
      return false;
    }
  }
  return true;
}

function scheduleNext(s: MockSession): void {
  const existing = billingTimers.get(s.id);
  if (existing) clearTimeout(existing);
  if (s.state !== "LIVE" || s.started_at === null) return;
  const nextBoundary = s.started_at + s.minute_idx * minuteMs();
  const delay = Math.max(10, nextBoundary - Date.now());
  billingTimers.set(
    s.id,
    setTimeout(() => runTick(s.id), delay),
  );
}

function runTick(sessionId: string): void {
  const s = db().sessions[sessionId];
  if (!s || s.state !== "LIVE") return;
  if (!billThrough(s, Date.now())) return;
  emitTick(s);
  maybeWarn(s);
  persist();
  scheduleNext(s);
}

function terminate(s: MockSession, reason: TerminationReason): void {
  if (TERMINAL.has(s.state)) return;
  const timer = billingTimers.get(s.id);
  if (timer) clearTimeout(timer);
  billingTimers.delete(s.id);
  const wasLive = s.state === "LIVE" || s.state === "ENDING";
  s.state = "ENDING";
  const user = userOf(s);
  const release = s.held - s.consumed;
  user.wallet.held_paise -= release;
  user.wallet.available_paise += release;
  s.state = wasLive ? "SETTLED" : "CANCELLED";
  s.ended_at = Date.now();
  s.end_reason = reason;
  if (wasLive && s.minute_idx > 0) {
    user.history.unshift({
      id: uid("txn"),
      kind: "consultation",
      amount_paise: -s.consumed,
      created_at: new Date().toISOString(),
      advocate_name: findAdvocate(s.advocate_id)?.display_name ?? null,
      minutes: s.minute_idx,
    });
  }
  persist();
  broadcast(s.id, { type: "session.terminated", reason });
  closeAll(s.id, reason === "wallet_empty" ? WS_CLOSE.walletEmpty : WS_CLOSE.normal, reason);
}

// -------------------------------------------------------------------------------------- advocate (fake)
function firstName(advocateId: string): string {
  const name = findAdvocate(advocateId)?.display_name ?? "";
  return name.replace(/^Demo\s+/, "").split(" ")[0] ?? name;
}

function advocateSay(sessionId: string, text: string): void {
  const s = db().sessions[sessionId];
  if (!s || s.state !== "LIVE") return;
  const message = {
    seq: ++s.seq,
    from: "advocate" as const,
    text,
    ts: new Date().toISOString(),
    client_msg_id: null,
  };
  s.messages.push(message);
  persist();
  broadcast(sessionId, { type: "typing", party: "advocate", on: false });
  broadcast(sessionId, {
    type: "msg.new",
    seq: message.seq,
    from: "advocate",
    text,
    ts: message.ts,
  });
}

function advocateTypes(
  sessionId: string,
  text: string,
  typingAfter: number,
  sayAfter: number,
): void {
  if (pendingReply.has(sessionId)) return;
  pendingReply.add(sessionId);
  setTimeout(() => {
    if (db().sessions[sessionId]?.state === "LIVE")
      broadcast(sessionId, { type: "typing", party: "advocate", on: true });
  }, typingAfter);
  setTimeout(() => {
    pendingReply.delete(sessionId);
    advocateSay(sessionId, text);
  }, sayAfter);
}

function goLiveIfReady(s: MockSession): void {
  if (
    s.state !== "RESERVED" ||
    !s.user_ready ||
    !s.advocate_online ||
    (peers.get(s.id)?.size ?? 0) === 0
  )
    return;
  s.state = "LIVE";
  s.started_at = Date.now();
  s.last_user_seen_at = Date.now();
  persist();
  broadcast(s.id, { type: "session.started", started_at: new Date(s.started_at).toISOString() });
  runTick(s.id);
  const lang =
    typeof document !== "undefined" && document.documentElement.lang === "hi" ? "hi" : "en";
  const greeting = ADVOCATE_GREETING[lang](
    firstName(s.advocate_id),
    s.summary_shared && s.document_id !== null,
  );
  advocateTypes(s.id, greeting, 500, 2_000);
}

// --------------------------------------------------------------------------------------------- recovery
function recoverLiveSession(s: MockSession): void {
  // Brief §1.3 step 8: a live session whose user has been gone longer than the heartbeat timeout is billed only
  // up to the timeout and then ended; otherwise billing resumes (with catch-up) as if the worker restarted.
  const cutoff = s.last_user_seen_at + HEARTBEAT_TIMEOUT_MS;
  if (Date.now() > cutoff) {
    if (billThrough(s, cutoff)) terminate(s, "timeout");
    return;
  }
  runTick(s.id);
}

function ensureRecovered(): void {
  if (recovered || typeof window === "undefined") return;
  recovered = true;
  const now = Date.now();
  for (const s of Object.values(db().sessions)) {
    if (s.state === "LIVE") recoverLiveSession(s);
    else if (s.state === "RESERVED" && now - s.requested_at > RESERVATION_TTL_MS)
      terminate(s, "user_ended");
    else if (s.state === "RESERVED" && s.user_ready) s.advocate_online = true;
  }
  persist();
  setInterval(() => {
    for (const s of Object.values(db().sessions)) {
      if (s.state !== "LIVE") continue;
      if ((peers.get(s.id)?.size ?? 0) > 0) s.last_user_seen_at = Date.now();
      else if (Date.now() - s.last_user_seen_at > HEARTBEAT_TIMEOUT_MS) terminate(s, "timeout");
    }
    persist();
  }, 5_000);
}

// --------------------------------------------------------------------------------------------- REST side
export function reserve(
  userId: string,
  advocateId: string,
  matchId?: string,
  documentId?: string,
): SessionInfo {
  ensureRecovered();
  const advocate = findAdvocate(advocateId);
  if (!advocate || advocate.verification_status !== "verified")
    throw new ApiError("not_found", 404);
  const state = db();
  const user = state.users[userId];
  if (!user) throw new ApiError("unauthorized", 401);

  for (const s of Object.values(state.sessions)) {
    if (
      s.user_id === userId &&
      s.state === "RESERVED" &&
      Date.now() - s.requested_at > RESERVATION_TTL_MS
    ) {
      terminate(s, "user_ended");
    }
  }
  const open = Object.values(state.sessions).find(
    (s) => s.user_id === userId && !TERMINAL.has(s.state),
  );
  if (open) throw new ApiError("session_exists", 409, { session_id: open.id });

  const perMinute = advocate.rate_paise_per_min + PLATFORM_FEE_PAISE + GST_ON_PLATFORM_FEE_PAISE;
  const required = perMinute * RESERVE_MINUTES;
  if (user.wallet.available_paise < required) {
    throw new ApiError("insufficient_funds", 402, {
      required_paise: required,
      available_paise: user.wallet.available_paise,
    });
  }

  return mutate(() => {
    const hold = Math.min(user.wallet.available_paise, RESERVE_CAP_PAISE);
    user.wallet.available_paise -= hold;
    user.wallet.held_paise += hold;
    const session: MockSession = {
      id: uid("sess"),
      user_id: userId,
      advocate_id: advocateId,
      match_id: matchId ?? null,
      state: "RESERVED",
      adv: advocate.rate_paise_per_min,
      plat: PLATFORM_FEE_PAISE,
      gst: GST_ON_PLATFORM_FEE_PAISE,
      gst_bps: GST_RATE_BPS,
      held: hold,
      consumed: 0,
      minute_idx: 0,
      requested_at: Date.now(),
      started_at: null,
      ended_at: null,
      end_reason: null,
      document_id: documentId ?? null,
      summary_shared: false,
      chat_consent: false,
      keep_transcript: false,
      user_ready: false,
      advocate_online: false,
      messages: [],
      seq: 0,
      warned: false,
      last_user_seen_at: Date.now(),
      rating: null,
    };
    state.sessions[session.id] = session;
    return toSessionInfo(session);
  });
}

export function getSession(userId: string, sessionId: string): SessionInfo {
  return toSessionInfo(sessionFor(userId, sessionId));
}

export function start(userId: string, sessionId: string, request: StartRequest): SessionInfo {
  const s = sessionFor(userId, sessionId);
  if (!request.chat_storage_consent) throw new ApiError("consent_required", 422);
  if (s.state !== "RESERVED") return toSessionInfo(s);
  s.user_ready = true;
  s.chat_consent = true;
  s.keep_transcript = request.keep_transcript;
  s.summary_shared = request.share_summary && s.document_id !== null;
  persist();
  if (!s.advocate_online) {
    setTimeout(
      () => {
        const current = db().sessions[sessionId];
        if (!current || current.state !== "RESERVED") return;
        current.advocate_online = true;
        persist();
        broadcast(sessionId, { type: "presence", party: "advocate", online: true });
        goLiveIfReady(current);
      },
      1_600 + Math.random() * 900,
    );
  } else {
    goLiveIfReady(s);
  }
  return toSessionInfo(s);
}

export function end(userId: string, sessionId: string): SessionInfo {
  const s = sessionFor(userId, sessionId);
  terminate(s, "user_ended");
  return toSessionInfo(s);
}

export function attachDocument(userId: string, sessionId: string, documentId: string): SessionInfo {
  const s = sessionFor(userId, sessionId);
  s.document_id = documentId;
  persist();
  return toSessionInfo(s);
}

export function rate(
  userId: string,
  sessionId: string,
  rating: { rating: number; tags: string[] },
): void {
  const s = sessionFor(userId, sessionId);
  s.rating = {
    rating: Math.min(5, Math.max(1, Math.round(rating.rating))),
    tags: rating.tags.slice(0, 6),
  };
  persist();
}

export function issueTicket(
  userId: string,
  sessionId: string,
): { ticket: string; expires_in: number } {
  const s = sessionFor(userId, sessionId);
  if (TERMINAL.has(s.state)) throw new ApiError("not_found", 404);
  const ticket = uid("wst");
  tickets.set(ticket, { sessionId, userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return { ticket, expires_in: TICKET_TTL_MS / 1000 };
}

/** Called by the payment webhook mock after it credits `available` (brief §1.3 step 6, mid-call top-up). */
export function onTopupCredited(userId: string, amountPaise: number): void {
  ensureRecovered();
  const s = Object.values(db().sessions).find((x) => x.user_id === userId && x.state === "LIVE");
  if (!s) return;
  const user = userOf(s);
  const move = Math.min(amountPaise, user.wallet.available_paise);
  user.wallet.available_paise -= move;
  user.wallet.held_paise += move;
  s.held += move;
  emitTick(s);
  maybeWarn(s);
  persist();
}

// ------------------------------------------------------------------------------------------- socket side
export function connect(
  ticket: string,
  peer: MockPeer,
): { ok: true; sessionId: string } | { ok: false; code: number; reason: string } {
  ensureRecovered();
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt < Date.now())
    return { ok: false, code: WS_CLOSE.unauthorized, reason: "bad_ticket" };
  const s = db().sessions[entry.sessionId];
  if (!s || TERMINAL.has(s.state))
    return { ok: false, code: WS_CLOSE.sessionOver, reason: "session_over" };
  if ((outages.get(s.id) ?? 0) > Date.now())
    return { ok: false, code: WS_CLOSE.abnormal, reason: "unavailable" };
  const set = peers.get(s.id) ?? new Set<MockPeer>();
  set.add(peer);
  peers.set(s.id, set);
  s.last_user_seen_at = Date.now();
  return { ok: true, sessionId: s.id };
}

/** Initial state for a freshly opened socket (after the client's onOpen). */
export function afterOpen(sessionId: string, peer: MockPeer): void {
  const s = db().sessions[sessionId];
  if (!s) return;
  peer.deliver({ type: "presence", party: "advocate", online: s.advocate_online });
  if (s.state === "LIVE" && s.started_at !== null) {
    peer.deliver({ type: "session.started", started_at: new Date(s.started_at).toISOString() });
    peer.deliver({
      type: "session.tick",
      minute: s.minute_idx,
      balance_paise: spendable(s),
      remaining_seconds: remainingSeconds(s),
    });
    if (s.warned) peer.deliver({ type: "session.warning", seconds_left: remainingSeconds(s) });
  }
  goLiveIfReady(s);
}

export function receive(sessionId: string, peer: MockPeer, event: ClientEvent): void {
  const s = db().sessions[sessionId];
  if (!s) return;
  s.last_user_seen_at = Date.now();
  switch (event.type) {
    case "ping":
      peer.deliver({ type: "pong" });
      return;
    case "resume":
      for (const m of s.messages) {
        if (m.seq > event.last_seq)
          peer.deliver({ type: "msg.new", seq: m.seq, from: m.from, text: m.text, ts: m.ts });
      }
      return;
    case "typing":
      return;
    case "msg.send": {
      if (s.state !== "LIVE") {
        peer.deliver({ type: "error", code: "not_live" });
        return;
      }
      const text = event.text.trim();
      if (text === "" || text.length > 4_000) {
        peer.deliver({ type: "error", code: "invalid_message" });
        return;
      }
      if (failNextSend.delete(s.id)) return; // demo: the server never acks this one
      const existing = s.messages.find((m) => m.client_msg_id === event.client_msg_id);
      const message = existing ?? {
        seq: ++s.seq,
        from: "user" as const,
        text,
        ts: new Date().toISOString(),
        client_msg_id: event.client_msg_id,
      };
      if (!existing) {
        s.messages.push(message);
        persist();
        peers.get(s.id)?.forEach((other) => {
          if (other !== peer)
            other.deliver({
              type: "msg.new",
              seq: message.seq,
              from: "user",
              text,
              ts: message.ts,
            });
        });
        const lang = detectLang(text, "en");
        const replies = ADVOCATE_REPLIES[lang];
        const index = s.messages.filter((m) => m.from === "advocate").length - 1;
        const reply = replies[Math.max(0, index) % replies.length] ?? replies[0] ?? "";
        advocateTypes(s.id, reply, 900, 2_400 + Math.random() * 1_200);
      }
      setTimeout(
        () =>
          peer.deliver({
            type: "msg.ack",
            client_msg_id: event.client_msg_id,
            seq: message.seq,
            ts: message.ts,
          }),
        250 + Math.random() * 350,
      );
      return;
    }
  }
}

export function disconnect(sessionId: string, peer: MockPeer): void {
  peers.get(sessionId)?.delete(peer);
}

// ------------------------------------------------------------------------------------------ demo controls
export const devControls = {
  dropConnection(sessionId: string): void {
    outages.set(sessionId, Date.now() + 4_000);
    closeAll(sessionId, WS_CLOSE.abnormal, "simulated_drop");
  },
  failNextMessage(sessionId: string): void {
    failNextSend.add(sessionId);
  },
  /** Fast-forward the clock to the low-balance point. Bills the skipped minutes, so the ledger stays consistent. */
  skipToLowBalance(sessionId: string): void {
    const s = db().sessions[sessionId];
    if (!s || s.state !== "LIVE" || s.started_at === null) return;
    // Leaves the spendable balance in (1, 2] × cost: exactly where the natural warning fires.
    const skip = Math.max(0, Math.ceil(spendable(s) / cost(s)) - 2);
    s.started_at -= skip * minuteMs();
    runTick(sessionId);
  },
};
