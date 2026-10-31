import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SamvaadClient } from "@/lib/api/clients";
import type { ChatMessage } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import type { SamvaadTransport, TransportFactory, TransportHandlers } from "@/lib/ws/transport";
import type { ClientEvent, ServerEvent } from "@/lib/ws/types";
import { backoffDelay, useSamvaadSocket } from "@/lib/ws/useSamvaadSocket";

class FakeTransport implements SamvaadTransport {
  sent: ClientEvent[] = [];
  closed = false;
  constructor(private readonly handlers: TransportHandlers) {}
  open() {
    this.handlers.onOpen();
  }
  emit(event: ServerEvent) {
    this.handlers.onEvent(event);
  }
  drop(code: number) {
    this.handlers.onClose(code, "test");
  }
  send(event: ClientEvent) {
    this.sent.push(event);
  }
  close() {
    this.closed = true;
  }
}

let transports: FakeTransport[] = [];
const factory: TransportFactory = ({ handlers }) => {
  const transport = new FakeTransport(handlers);
  transports.push(transport);
  return transport;
};
const client = {
  wsTicket: vi.fn(async () => ({ ticket: "ticket", expires_in: 30 })),
} as unknown as SamvaadClient;

const latest = () => transports.at(-1)!;
const messages = () =>
  useRoomStore.getState().items.filter((i): i is ChatMessage => i.kind === "message");
const sends = (t: FakeTransport) =>
  t.sent.filter((e): e is Extract<ClientEvent, { type: "msg.send" }> => e.type === "msg.send");

async function connected() {
  const hook = renderHook(() =>
    useSamvaadSocket({ sessionId: "s1", enabled: true, client, factory }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // ticket request resolves
  });
  act(() => latest().open());
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  transports = [];
  useRoomStore.getState().reset("s1", { costPerMinute: 1_000, clockRate: 1, phase: "live" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSamvaadSocket (brief §3.3)", () => {
  it("connects with a one-time ticket and resumes from the last seen seq", async () => {
    useRoomStore.setState({ lastSeq: 12 });
    await connected();
    expect(client.wsTicket).toHaveBeenCalledWith("s1");
    expect(latest().sent[0]).toEqual({ type: "resume", last_seq: 12 });
    expect(useRoomStore.getState().connection).toBe("open");
  });

  it("sends optimistically and marks the message sent on ack", async () => {
    const { result } = await connected();
    act(() => result.current.send("  hello  "));
    expect(messages()[0]).toMatchObject({ text: "hello", status: "sending" });
    const [sent] = sends(latest());
    expect(sent?.text).toBe("hello");
    act(() =>
      latest().emit({ type: "msg.ack", client_msg_id: sent!.client_msg_id, seq: 1, ts: "t" }),
    );
    expect(messages()[0]).toMatchObject({ status: "sent", seq: 1 });
  });

  it("fails a message after 8 s without an ack and retries it with the same id", async () => {
    const { result } = await connected();
    act(() => result.current.send("are you there?"));
    const id = sends(latest())[0]!.client_msg_id;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(messages()[0]?.status).toBe("failed");
    act(() => result.current.retry(id));
    expect(messages()[0]?.status).toBe("sending");
    expect(sends(latest()).map((s) => s.client_msg_id)).toEqual([id, id]);
  });

  it("queues while disconnected and flushes the outbox after reconnecting", async () => {
    const { result } = await connected();
    act(() => latest().drop(1006));
    expect(useRoomStore.getState().connection).toBe("reconnecting");
    act(() => result.current.send("sent while offline"));
    expect(messages()[0]?.status).toBe("sending");
    const first = latest();
    expect(sends(first)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600); // first backoff is 0.25–0.5 s
    });
    expect(transports).toHaveLength(2);
    act(() => latest().open());
    expect(latest().sent[0]?.type).toBe("resume");
    expect(sends(latest()).map((s) => s.text)).toEqual(["sent while offline"]);
  });

  it("does not reconnect after the wallet-empty close (4402)", async () => {
    await connected();
    act(() => latest().drop(4402));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(transports).toHaveLength(1);
    expect(useRoomStore.getState().connection).toBe("closed");
  });

  it("pings every 20 s and throttles typing to one event per 2 s", async () => {
    const { result } = await connected();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(latest().sent.filter((e) => e.type === "ping")).toHaveLength(1);
    act(() => {
      result.current.sendTyping(true);
      result.current.sendTyping(true);
    });
    expect(latest().sent.filter((e) => e.type === "typing")).toHaveLength(1);
  });

  it("closes the socket when the room unmounts", async () => {
    const { unmount } = await connected();
    unmount();
    expect(latest().closed).toBe(true);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially from 0.5 s to 8 s with jitter", () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(0, () => 1)).toBe(500);
    expect(backoffDelay(3, () => 1)).toBe(4_000);
    expect(backoffDelay(10, () => 1)).toBe(8_000);
    expect(backoffDelay(10, () => 0)).toBe(4_000);
  });
});
