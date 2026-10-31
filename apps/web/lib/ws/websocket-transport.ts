import { publicConfig } from "@/lib/config";
import { parseServerEvent } from "./schema";
import type { TransportFactory } from "./transport";

/**
 * Real transport (wired in Phase 3). The long-lived JWT never goes in the URL: the hook first exchanges it for a
 * one-time ticket (brief §1.3 chat protocol).
 */
export const createWebSocketTransport: TransportFactory = ({ sessionId, ticket, handlers }) => {
  const url = `${publicConfig.wsUrl}/ws/samvaad/${encodeURIComponent(sessionId)}?ticket=${encodeURIComponent(ticket)}`;
  const socket = new WebSocket(url);
  let closed = false;

  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (message: MessageEvent<unknown>) => {
    if (typeof message.data !== "string") return;
    let raw: unknown;
    try {
      raw = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = parseServerEvent(raw);
    if (event) handlers.onEvent(event);
  };
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    handlers.onClose(event.code, event.reason);
  };

  return {
    send(event) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    },
    close(code = 1000, reason = "client") {
      socket.close(code, reason);
    },
  };
};
