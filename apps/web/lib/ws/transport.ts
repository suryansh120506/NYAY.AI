import type { ClientEvent, ServerEvent } from "./types";

export interface TransportHandlers {
  onOpen(): void;
  onEvent(event: ServerEvent): void;
  onClose(code: number, reason: string): void;
}

/** One connection attempt. Real: a WebSocket. Offline: MockSamvaadSocket. The hook above it is identical. */
export interface SamvaadTransport {
  send(event: ClientEvent): void;
  close(code?: number, reason?: string): void;
}

export type TransportFactory = (args: {
  sessionId: string;
  ticket: string;
  handlers: TransportHandlers;
}) => SamvaadTransport;
