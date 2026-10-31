import * as server from "@/lib/api/mock/samvaad-server";
import { parseServerEvent } from "./schema";
import type { SamvaadTransport, TransportFactory, TransportHandlers } from "./transport";
import type { ClientEvent, ServerEvent } from "./types";

/**
 * Offline transport (brief §4 step 6). Talks to the in-tab fake server with the same asynchrony and the same
 * JSON round-trip + schema validation as a real socket, so reconnects, resume and outbox logic are exercised.
 * Delivery is FIFO: events queued before a server-side close still arrive before the close, like a real socket.
 */
export class MockSamvaadSocket implements SamvaadTransport, server.MockPeer {
  private sessionId: string | null = null;
  private clientClosed = false;
  private serverClosed = false;

  constructor(
    ticket: string,
    private readonly handlers: TransportHandlers,
  ) {
    setTimeout(
      () => {
        if (this.clientClosed) return;
        const result = server.connect(ticket, this);
        if (!result.ok) {
          this.serverClosed = true;
          handlers.onClose(result.code, result.reason);
          return;
        }
        this.sessionId = result.sessionId;
        handlers.onOpen();
        server.afterOpen(result.sessionId, this);
      },
      120 + Math.random() * 180,
    );
  }

  private get closed(): boolean {
    return this.clientClosed || this.serverClosed;
  }

  send(event: ClientEvent): void {
    const sessionId = this.sessionId;
    if (this.closed || !sessionId) return;
    const wire = JSON.parse(JSON.stringify(event)) as ClientEvent;
    setTimeout(() => {
      if (!this.closed) server.receive(sessionId, this, wire);
    }, 30);
  }

  close(code = 1000, reason = "client"): void {
    if (this.closed) return;
    this.clientClosed = true;
    if (this.sessionId) server.disconnect(this.sessionId, this);
    setTimeout(() => this.handlers.onClose(code, reason), 0);
  }

  deliver(event: ServerEvent): void {
    if (this.closed) return;
    const parsed = parseServerEvent(JSON.parse(JSON.stringify(event)));
    setTimeout(() => {
      if (!this.clientClosed && parsed) this.handlers.onEvent(parsed);
    }, 20);
  }

  serverClose(code: number, reason: string): void {
    if (this.closed) return;
    this.serverClosed = true;
    setTimeout(() => {
      if (!this.clientClosed) this.handlers.onClose(code, reason);
    }, 25);
  }
}

export const createMockTransport: TransportFactory = ({ ticket, handlers }) =>
  new MockSamvaadSocket(ticket, handlers);
