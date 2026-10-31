import { describe, expect, it, vi } from "vitest";
import { counterpartView, flipParty } from "@/lib/ws/perspective";
import type { TransportFactory } from "@/lib/ws/transport";
import type { ServerEvent } from "@/lib/ws/types";

describe("advocate perspective", () => {
  it("swaps the parties of messages, presence and typing only", () => {
    expect(flipParty({ type: "msg.new", seq: 1, from: "user", text: "hi", ts: "t" })).toMatchObject(
      {
        from: "advocate",
      },
    );
    expect(flipParty({ type: "presence", party: "advocate", online: true })).toEqual({
      type: "presence",
      party: "user",
      online: true,
    });
    expect(flipParty({ type: "typing", party: "user", on: true })).toMatchObject({
      party: "advocate",
    });
    const tick: ServerEvent = {
      type: "session.tick",
      minute: 2,
      balance_paise: 0,
      remaining_seconds: 0,
    };
    expect(flipParty(tick)).toBe(tick);
  });

  it("wraps a transport so inbound events arrive flipped", () => {
    const seen: ServerEvent[] = [];
    const inner: TransportFactory = ({ handlers }) => {
      handlers.onEvent({ type: "msg.new", seq: 3, from: "user", text: "Namaste", ts: "t" });
      return { send: vi.fn(), close: vi.fn() };
    };
    counterpartView(inner)({
      sessionId: "s",
      ticket: "t",
      handlers: { onOpen: vi.fn(), onClose: vi.fn(), onEvent: (e) => seen.push(e) },
    });
    expect(seen).toEqual([{ type: "msg.new", seq: 3, from: "advocate", text: "Namaste", ts: "t" }]);
  });
});
