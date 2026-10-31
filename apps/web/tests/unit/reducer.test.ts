import { describe, expect, it } from "vitest";
import {
  applyServerEvent,
  displayRemainingSeconds,
  elapsedSeconds,
  formatClock,
  initialRoomData,
  type ChatMessage,
  type RoomData,
} from "@/lib/samvaad/reducer";
import type { ServerEvent } from "@/lib/ws/types";

const NOW = Date.parse("2026-10-09T10:00:00Z");

function state(partial: Partial<RoomData> = {}): RoomData {
  return { ...initialRoomData, sessionId: "s1", costPerMinute: 3_590, ...partial };
}

function run(start: RoomData, ...events: ServerEvent[]): RoomData {
  return events.reduce((s, e) => ({ ...s, ...applyServerEvent(s, e, NOW) }), start);
}

const pending = (clientMsgId: string, text: string): ChatMessage => ({
  kind: "message",
  key: `local:${clientMsgId}`,
  clientMsgId,
  seq: null,
  from: "user",
  text,
  ts: new Date(NOW).toISOString(),
  status: "sending",
});

const messages = (s: RoomData) => s.items.filter((i): i is ChatMessage => i.kind === "message");

describe("room state machine (brief §3.3)", () => {
  it("goes live when billing starts and records it once", () => {
    const s = run(
      state({ phase: "connecting" }),
      { type: "session.started", started_at: new Date(NOW).toISOString() },
      { type: "session.started", started_at: new Date(NOW).toISOString() },
    );
    expect(s.phase).toBe("live");
    expect(
      s.items.filter((i) => i.kind === "system" && i.event === "billing_started"),
    ).toHaveLength(1);
  });

  it("only warns from live, and a tick above 2× cost recovers from low balance", () => {
    expect(
      run(state({ phase: "preflight" }), { type: "session.warning", seconds_left: 100 }).phase,
    ).toBe("preflight");
    const low = run(state({ phase: "live" }), { type: "session.warning", seconds_left: 100 });
    expect(low.phase).toBe("low_balance");
    expect(low.lowBalanceOpen).toBe(true);
    const stillLow = run(low, {
      type: "session.tick",
      minute: 5,
      balance_paise: 7_000,
      remaining_seconds: 110,
    });
    expect(stillLow.phase).toBe("low_balance");
    const toppedUp = run(low, {
      type: "session.tick",
      minute: 5,
      balance_paise: 27_000,
      remaining_seconds: 450,
    });
    expect(toppedUp.phase).toBe("live");
    expect(toppedUp.lowBalanceOpen).toBe(false);
  });

  it("ends in the summary with the reason, from any phase", () => {
    const s = run(state({ phase: "low_balance", lowBalanceOpen: true, advocateTyping: true }), {
      type: "session.terminated",
      reason: "wallet_empty",
    });
    expect(s.phase).toBe("summary");
    expect(s.terminatedReason).toBe("wallet_empty");
    expect(s.lowBalanceOpen).toBe(false);
    expect(s.advocateTyping).toBe(false);
  });

  it("takes balance only from the server tick", () => {
    const s = run(state({ phase: "live" }), {
      type: "session.tick",
      minute: 3,
      balance_paise: 14_230,
      remaining_seconds: 215,
    });
    expect(s.balancePaise).toBe(14_230);
    expect(s.minute).toBe(3);
    expect(s.tickAt).toBe(NOW);
  });
});

describe("messages", () => {
  it("marks an optimistic message sent on ack and advances lastSeq", () => {
    const s = run(state({ items: [pending("c1", "hello")] }), {
      type: "msg.ack",
      client_msg_id: "c1",
      seq: 4,
      ts: new Date(NOW).toISOString(),
    });
    expect(messages(s)[0]).toMatchObject({ status: "sent", seq: 4 });
    expect(s.lastSeq).toBe(4);
  });

  it("ignores a duplicate msg.new and inserts replays in seq order", () => {
    const s = run(
      state(),
      { type: "msg.new", seq: 1, from: "advocate", text: "a", ts: "t" },
      { type: "msg.new", seq: 3, from: "advocate", text: "c", ts: "t" },
      { type: "msg.new", seq: 3, from: "advocate", text: "c", ts: "t" },
      { type: "msg.new", seq: 2, from: "user", text: "b", ts: "t" },
    );
    expect(messages(s).map((m) => m.text)).toEqual(["a", "b", "c"]);
    expect(s.lastSeq).toBe(3);
  });

  it("keeps one copy when a resume replay and the outbox ack describe the same message", () => {
    const s = run(
      state({ items: [pending("c1", "hello")] }),
      { type: "msg.new", seq: 7, from: "user", text: "hello", ts: "t" },
      { type: "msg.ack", client_msg_id: "c1", seq: 7, ts: "t" },
    );
    expect(messages(s)).toHaveLength(1);
    expect(messages(s)[0]).toMatchObject({ clientMsgId: "c1", status: "sent", seq: 7 });
  });

  it("clears the typing indicator when the advocate's message lands", () => {
    const s = run(
      state(),
      { type: "typing", party: "advocate", on: true },
      { type: "msg.new", seq: 1, from: "advocate", text: "hi", ts: "t" },
    );
    expect(s.advocateTyping).toBe(false);
  });
});

describe("display interpolation (never billing)", () => {
  it("counts the last tick down locally, scaled by the demo clock rate", () => {
    expect(
      displayRemainingSeconds({ remainingSeconds: 120, tickAt: NOW, clockRate: 1 }, NOW + 30_000),
    ).toBe(90);
    expect(
      displayRemainingSeconds({ remainingSeconds: 120, tickAt: NOW, clockRate: 4 }, NOW + 10_000),
    ).toBe(80);
    expect(
      displayRemainingSeconds({ remainingSeconds: 10, tickAt: NOW, clockRate: 1 }, NOW + 60_000),
    ).toBe(0);
    expect(
      displayRemainingSeconds({ remainingSeconds: null, tickAt: null, clockRate: 1 }, NOW),
    ).toBeNull();
  });

  it("formats the session clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(247)).toBe("04:07");
    expect(formatClock(3_725)).toBe("1:02:05");
    expect(elapsedSeconds(new Date(NOW).toISOString(), 1, NOW + 61_500)).toBe(61);
  });
});
