/**
 * Pure state transitions for the Samvaad room (brief §3.3 state machine:
 * preflight → connecting → live → low_balance → ending → summary). Kept free of React and Zustand so it is easy
 * to unit-test. The server's `session.tick` is the only source of truth for balance and billed minutes.
 */
import type { Party, ServerEvent, TerminationReason } from "@/lib/ws/types";

export type RoomPhase = "preflight" | "connecting" | "live" | "low_balance" | "ending" | "summary";
export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";
export type MessageStatus = "sending" | "sent" | "failed" | "received";

export interface ChatMessage {
  kind: "message";
  key: string;
  clientMsgId: string | null;
  seq: number | null;
  from: Party;
  text: string;
  ts: string;
  status: MessageStatus;
}

export interface SystemLine {
  kind: "system";
  key: string;
  ts: string;
  event: "billing_started" | "low_balance" | "ended";
}

export type TimelineItem = ChatMessage | SystemLine;

export interface RoomData {
  sessionId: string | null;
  phase: RoomPhase;
  connection: ConnectionStatus;
  advocateOnline: boolean;
  advocateTyping: boolean;
  startedAt: string | null;
  minute: number;
  balancePaise: number | null;
  remainingSeconds: number | null;
  /** Local receipt time of the last tick, used only to interpolate the display between ticks. */
  tickAt: number | null;
  costPerMinute: number;
  /** 1 in production; > 1 when the offline demo shortens minutes. */
  clockRate: number;
  terminatedReason: TerminationReason | null;
  lowBalanceOpen: boolean;
  items: TimelineItem[];
  lastSeq: number;
}

export const initialRoomData: RoomData = {
  sessionId: null,
  phase: "preflight",
  connection: "idle",
  advocateOnline: false,
  advocateTyping: false,
  startedAt: null,
  minute: 0,
  balancePaise: null,
  remainingSeconds: null,
  tickAt: null,
  costPerMinute: 0,
  clockRate: 1,
  terminatedReason: null,
  lowBalanceOpen: false,
  items: [],
  lastSeq: 0,
};

const ACTIVE: ReadonlySet<RoomPhase> = new Set<RoomPhase>(["live", "low_balance", "ending"]);

export function isActivePhase(phase: RoomPhase): boolean {
  return ACTIVE.has(phase);
}

function withSystemLine(
  items: TimelineItem[],
  event: SystemLine["event"],
  ts: string,
  once: boolean,
): TimelineItem[] {
  if (once && items.some((item) => item.kind === "system" && item.event === event)) return items;
  return [...items, { kind: "system", key: `sys:${event}:${items.length}`, ts, event }];
}

/** Insert a confirmed message by seq so replays after a reconnect land in order. */
function insertBySeq(items: TimelineItem[], message: ChatMessage): TimelineItem[] {
  const seq = message.seq ?? Number.POSITIVE_INFINITY;
  const index = items.findIndex(
    (item) => item.kind === "message" && item.seq !== null && item.seq > seq,
  );
  if (index === -1) return [...items, message];
  return [...items.slice(0, index), message, ...items.slice(index)];
}

export function applyServerEvent(
  state: RoomData,
  event: ServerEvent,
  now: number,
): Partial<RoomData> {
  switch (event.type) {
    case "session.started": {
      const phase =
        state.phase === "preflight" || state.phase === "connecting" ? "live" : state.phase;
      return {
        startedAt: event.started_at,
        phase,
        items: withSystemLine(state.items, "billing_started", event.started_at, true),
      };
    }

    case "msg.ack": {
      const index = state.items.findIndex(
        (item) => item.kind === "message" && item.clientMsgId === event.client_msg_id,
      );
      if (index === -1) return {};
      const acked: ChatMessage = {
        ...(state.items[index] as ChatMessage),
        seq: event.seq,
        ts: event.ts,
        status: "sent",
      };
      // A replay after reconnect may already have inserted this message (msg.new carries no client id): keep one.
      const items = state.items
        .map((item, i) => (i === index ? acked : item))
        .filter((item, i) => i === index || item.kind !== "message" || item.seq !== event.seq);
      return { items, lastSeq: Math.max(state.lastSeq, event.seq) };
    }

    case "msg.new": {
      if (state.items.some((item) => item.kind === "message" && item.seq === event.seq)) return {};
      const message: ChatMessage = {
        kind: "message",
        key: `seq:${event.seq}`,
        clientMsgId: null,
        seq: event.seq,
        from: event.from,
        text: event.text,
        ts: event.ts,
        status: event.from === "user" ? "sent" : "received",
      };
      return {
        items: insertBySeq(state.items, message),
        lastSeq: Math.max(state.lastSeq, event.seq),
        advocateTyping: event.from === "advocate" ? false : state.advocateTyping,
      };
    }

    case "presence":
      return event.party === "advocate" ? { advocateOnline: event.online } : {};

    case "typing":
      return event.party === "advocate" ? { advocateTyping: event.on } : {};

    case "session.tick": {
      const recovered =
        state.phase === "low_balance" && event.balance_paise > 2 * state.costPerMinute;
      return {
        minute: event.minute,
        balancePaise: event.balance_paise,
        remainingSeconds: event.remaining_seconds,
        tickAt: now,
        ...(recovered ? { phase: "live" as const, lowBalanceOpen: false } : {}),
      };
    }

    case "session.warning": {
      if (state.phase !== "live") return {};
      return {
        phase: "low_balance",
        lowBalanceOpen: true,
        items: withSystemLine(state.items, "low_balance", new Date(now).toISOString(), false),
      };
    }

    case "session.terminated":
      if (state.phase === "summary") return {};
      return {
        phase: "summary",
        terminatedReason: event.reason,
        advocateTyping: false,
        lowBalanceOpen: false,
        items: withSystemLine(state.items, "ended", new Date(now).toISOString(), true),
      };

    case "pong":
    case "error":
      return {};
  }
}

/** Seconds of balance left right now: the last tick, counted down locally for display only. */
export function displayRemainingSeconds(
  state: Pick<RoomData, "remainingSeconds" | "tickAt" | "clockRate">,
  now: number,
): number | null {
  if (state.remainingSeconds === null || state.tickAt === null) return null;
  const elapsed = ((now - state.tickAt) / 1000) * state.clockRate;
  return Math.max(0, Math.round(state.remainingSeconds - elapsed));
}

export function elapsedSeconds(startedAt: string | null, clockRate: number, now: number): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor(((now - Date.parse(startedAt)) / 1000) * clockRate));
}

/** mm:ss, or h:mm:ss past an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
