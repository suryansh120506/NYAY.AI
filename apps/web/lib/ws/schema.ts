import { z } from "zod";
import type { ServerEvent } from "./types";

const party = z.enum(["user", "advocate"]);
const int = z.number().int();

/** Runtime validation of every inbound envelope: the server is trusted, but a malformed frame must never crash the room. */
const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.started"), started_at: z.string() }),
  z.object({
    type: z.literal("msg.new"),
    seq: int.nonnegative(),
    from: party,
    text: z.string(),
    ts: z.string(),
  }),
  z.object({
    type: z.literal("msg.ack"),
    client_msg_id: z.string().min(1),
    seq: int.nonnegative(),
    ts: z.string(),
  }),
  z.object({ type: z.literal("presence"), party, online: z.boolean() }),
  z.object({ type: z.literal("typing"), party, on: z.boolean() }),
  z.object({
    type: z.literal("session.tick"),
    minute: int.nonnegative(),
    balance_paise: int,
    remaining_seconds: int.nonnegative(),
  }),
  z.object({ type: z.literal("session.warning"), seconds_left: int.nonnegative() }),
  z.object({
    type: z.literal("session.terminated"),
    reason: z.enum(["wallet_empty", "user_ended", "advocate_ended", "timeout"]),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), code: z.string() }),
]);

type Parsed = z.infer<typeof serverEventSchema>;
// Compile-time guard: the schema and the hand-written union in types.ts must describe the same envelope.
const _schemaMatchesTypes: [Parsed] extends [ServerEvent]
  ? [ServerEvent] extends [Parsed]
    ? true
    : false
  : false = true;
void _schemaMatchesTypes;

export function parseServerEvent(raw: unknown): ServerEvent | null {
  const result = serverEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}
