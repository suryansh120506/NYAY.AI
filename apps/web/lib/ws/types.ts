/**
 * Samvaad realtime envelope (brief §3.3). Defined once; mirrors the backend Pydantic models.
 * Addition: server → client `typing` so the client-sent `typing {on}` has a receiver (docs/ASSUMPTIONS.md A28).
 */
export type Party = "user" | "advocate";
export type TerminationReason = "wallet_empty" | "user_ended" | "advocate_ended" | "timeout";

export type ServerEvent =
  | { type: "session.started"; started_at: string }
  | { type: "msg.new"; seq: number; from: Party; text: string; ts: string }
  | { type: "msg.ack"; client_msg_id: string; seq: number; ts: string }
  | { type: "presence"; party: Party; online: boolean }
  | { type: "typing"; party: Party; on: boolean }
  | { type: "session.tick"; minute: number; balance_paise: number; remaining_seconds: number }
  | { type: "session.warning"; seconds_left: number }
  | { type: "session.terminated"; reason: TerminationReason }
  | { type: "pong" }
  | { type: "error"; code: string };

export type ClientEvent =
  | { type: "msg.send"; client_msg_id: string; text: string }
  | { type: "typing"; on: boolean }
  | { type: "resume"; last_seq: number }
  | { type: "ping" };

/** Close codes the gateway uses. */
export const WS_CLOSE = {
  normal: 1000,
  abnormal: 1006,
  unauthorized: 4401,
  walletEmpty: 4402,
  sessionOver: 4410,
} as const;
