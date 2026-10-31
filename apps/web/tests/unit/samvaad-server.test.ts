import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DbModule from "@/lib/api/mock/db";
import type * as ServerModule from "@/lib/api/mock/samvaad-server";
import type { ServerEvent } from "@/lib/ws/types";

/**
 * The offline Samvaad server must follow the billing semantics of brief §1.3, because the Phase 1 UI is built and
 * tested against it: prepaid minute n debited at the start of minute n, one debit per minute index, catch-up for
 * missed minutes, one warning at ≤ 2× cost, termination when a minute can't be covered, unused hold released.
 */

const START = new Date("2026-10-09T10:00:00Z");
const MINUTE = 60_000;
const USER = "user_test";

type Server = typeof ServerModule;
type Db = typeof DbModule;

interface Harness {
  server: Server;
  db: Db;
  advocateId: string;
  cost: number;
}

async function load(): Promise<Harness> {
  const db = await import("@/lib/api/mock/db");
  const auth = await import("@/lib/api/mock/auth");
  const server = await import("@/lib/api/mock/samvaad-server");
  const { ADVOCATES } = await import("@/lib/api/mock/fixtures");
  db.resetMockDb();
  auth.ensureMockUser(USER, false);
  server.setMinuteMsOverride(MINUTE); // real 60 s minutes in tests
  const advocate = ADVOCATES[0];
  if (!advocate) throw new Error("fixtures missing");
  return { server, db, advocateId: advocate.id, cost: advocate.rate_paise_per_min + 500 + 90 };
}

function makePeer() {
  const events: ServerEvent[] = [];
  const closes: number[] = [];
  return {
    events,
    closes,
    deliver: (event: ServerEvent) => events.push(event),
    serverClose: (code: number) => closes.push(code),
    of: <T extends ServerEvent["type"]>(type: T) =>
      events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type),
  };
}

/** Reserve, connect the user, tap Start, let the advocate join: billing starts. */
async function liveSession(h: Harness) {
  const info = h.server.reserve(USER, h.advocateId);
  const peer = makePeer();
  const connected = h.server.connect(h.server.issueTicket(USER, info.id).ticket, peer);
  expect(connected.ok).toBe(true);
  h.server.afterOpen(info.id, peer);
  h.server.start(USER, info.id, {
    chat_storage_consent: true,
    keep_transcript: false,
    share_summary: false,
  });
  await vi.advanceTimersByTimeAsync(3_000); // advocate joins (1.6–2.5 s)
  return {
    id: info.id,
    peer,
    session: () => h.db.db().sessions[info.id]!,
    wallet: () => h.db.db().users[USER]!.wallet,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  vi.resetModules();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reserve", () => {
  it("holds min(available, cap), needs 5 minutes of balance, and allows one open session", async () => {
    const h = await load();
    const info = h.server.reserve(USER, h.advocateId);
    expect(info.state).toBe("RESERVED");
    expect(info.held_paise).toBe(25_000);
    expect(h.db.db().users[USER]!.wallet).toMatchObject({ available_paise: 0, held_paise: 25_000 });
    expect(() => h.server.reserve(USER, h.advocateId)).toThrowError(
      expect.objectContaining({ code: "session_exists" }),
    );
  });

  it("refuses when the wallet covers fewer than 5 minutes", async () => {
    const h = await load();
    h.db.db().users[USER]!.wallet.available_paise = h.cost * 5 - 1;
    expect(() => h.server.reserve(USER, h.advocateId)).toThrowError(
      expect.objectContaining({
        code: "insufficient_funds",
        details: expect.objectContaining({ required_paise: h.cost * 5 }),
      }),
    );
  });
});

describe("billing", () => {
  it("debits minute 1 the moment both parties are connected (prepaid)", async () => {
    const h = await load();
    const s = await liveSession(h);
    expect(s.session().state).toBe("LIVE");
    expect(s.session().minute_idx).toBe(1);
    expect(s.session().consumed).toBe(h.cost);
    expect(s.peer.of("session.started")).toHaveLength(1);
    expect(s.peer.of("session.tick").at(-1)).toMatchObject({
      minute: 1,
      balance_paise: 25_000 - h.cost,
    });
  });

  it("never bills while waiting for the advocate", async () => {
    const h = await load();
    const info = h.server.reserve(USER, h.advocateId);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(h.db.db().sessions[info.id]!.consumed).toBe(0);
  });

  it("bills exactly one debit per minute boundary", async () => {
    const h = await load();
    const s = await liveSession(h);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(s.session().minute_idx).toBe(4);
    expect(s.session().consumed).toBe(4 * h.cost);
  });

  it("catches up missed minutes in order after a late tick, without double charging", async () => {
    const h = await load();
    const s = await liveSession(h);
    const ticksBefore = s.peer.of("session.tick").length;
    // The worker was asleep: wall-clock time jumps 4½ minutes while its pending timer hasn't fired yet.
    vi.setSystemTime(START.getTime() + 3_000 + 4.5 * MINUTE);
    await vi.advanceTimersByTimeAsync(MINUTE); // the overdue tick finally runs
    const startedAt = s.session().started_at!;
    const due = Math.floor((Date.now() - startedAt) / MINUTE) + 1;
    expect(s.session().minute_idx).toBe(due);
    expect(due).toBeGreaterThanOrEqual(6);
    expect(s.session().consumed).toBe(due * h.cost);
    // Several minutes were billed by fewer ticks: that is the catch-up.
    expect(s.peer.of("session.tick").length - ticksBefore).toBeLessThan(due - 1);
    // Running again inside the same minute is a no-op (the minute_idx guard).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.session().consumed).toBe(due * h.cost);
  });

  it("warns once at ≤ 2× cost, then ends at zero and releases the unused hold", async () => {
    const h = await load();
    const s = await liveSession(h);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);

    const affordable = Math.floor(25_000 / h.cost);
    expect(s.peer.of("session.warning")).toHaveLength(1);
    expect(s.peer.of("session.terminated")).toEqual([
      { type: "session.terminated", reason: "wallet_empty" },
    ]);
    expect(s.peer.closes).toEqual([4402]);
    expect(s.session()).toMatchObject({
      state: "SETTLED",
      end_reason: "wallet_empty",
      minute_idx: affordable,
    });

    const wallet = s.wallet();
    expect(wallet.held_paise).toBe(0);
    expect(wallet.available_paise).toBe(25_000 - affordable * h.cost);
    // Money is conserved: nothing created, nothing lost.
    expect(wallet.available_paise + s.session().consumed).toBe(25_000);
    expect(h.db.db().users[USER]!.history[0]).toMatchObject({
      kind: "consultation",
      amount_paise: -affordable * h.cost,
      minutes: affordable,
    });
  });

  it("a mid-call top-up raises the hold, ticks immediately and re-arms the warning", async () => {
    const h = await load();
    const s = await liveSession(h);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(s.peer.of("session.warning")).toHaveLength(1);
    const before = s.peer.of("session.tick").length;

    s.wallet().available_paise += 20_000; // the payment webhook posts the credit first…
    h.server.onTopupCredited(USER, 20_000); // …then the hold is raised for the live session
    expect(s.peer.of("session.tick").length).toBe(before + 1);
    expect(s.session().held).toBe(45_000);
    expect(s.session().warned).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(s.peer.of("session.warning")).toHaveLength(2);
    expect(s.wallet().available_paise + s.session().consumed).toBe(45_000);
  });

  it("ends with `timeout` after 30 s without the user connected", async () => {
    const h = await load();
    const s = await liveSession(h);
    h.server.disconnect(s.id, s.peer);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(s.session()).toMatchObject({ state: "SETTLED", end_reason: "timeout" });
    expect(s.wallet().held_paise).toBe(0);
  });
});

describe("socket protocol", () => {
  it("accepts each WebSocket ticket once", async () => {
    const h = await load();
    const info = h.server.reserve(USER, h.advocateId);
    const { ticket } = h.server.issueTicket(USER, info.id);
    expect(h.server.connect(ticket, makePeer()).ok).toBe(true);
    expect(h.server.connect(ticket, makePeer())).toMatchObject({ ok: false, code: 4401 });
  });

  it("stores a resent message once and acks it with the original seq", async () => {
    const h = await load();
    const s = await liveSession(h);
    const send = { type: "msg.send" as const, client_msg_id: "c-1", text: "hello" };
    h.server.receive(s.id, s.peer, send);
    h.server.receive(s.id, s.peer, send);
    await vi.advanceTimersByTimeAsync(1_000);
    const acks = s.peer.of("msg.ack");
    expect(acks).toHaveLength(2);
    expect(new Set(acks.map((a) => a.seq)).size).toBe(1);
    expect(s.session().messages.filter((m) => m.client_msg_id === "c-1")).toHaveLength(1);
  });

  it("replays everything after last_seq on resume", async () => {
    const h = await load();
    const s = await liveSession(h);
    h.server.receive(s.id, s.peer, { type: "msg.send", client_msg_id: "c-1", text: "one" });
    await vi.advanceTimersByTimeAsync(10_000); // includes the advocate's scripted replies
    const fresh = makePeer();
    h.server.receive(s.id, fresh, { type: "resume", last_seq: 1 });
    const replayed = fresh.of("msg.new").map((m) => m.seq);
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((seq) => seq > 1)).toBe(true);
  });
});
