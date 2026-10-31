"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SamvaadClient } from "@/lib/api/clients";
import { ApiError } from "@/lib/api/types";
import { limits } from "@/lib/config";
import { outbox, useRoomStore } from "@/lib/samvaad/store";
import type { SamvaadTransport, TransportFactory } from "./transport";
import { WS_CLOSE, type ClientEvent } from "./types";

const PING_INTERVAL_MS = 20_000;
const ACK_TIMEOUT_MS = 8_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const TYPING_THROTTLE_MS = 2_000;

/** Exponential backoff with jitter, 0.5 s → 8 s (brief §3.3). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return base / 2 + random() * (base / 2);
}

function newClientMsgId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface Options {
  sessionId: string;
  /** Connect only once the room exists for this user (pre-flight onwards) and stop after the summary. */
  enabled: boolean;
  client: SamvaadClient;
  factory: TransportFactory;
}

/**
 * Brief §3.3 `useSamvaadSocket`: obtain a one-time ticket, connect, `resume {last_seq}`, ping every 20 s, reconnect
 * with backoff + jitter, keep an outbox of unacknowledged messages and resend after reconnect. Never runs a billing
 * timer: balance and minutes come only from the server's `session.tick`.
 */
export function useSamvaadSocket({ sessionId, enabled, client, factory }: Options) {
  const transportRef = useRef<SamvaadTransport | null>(null);
  const openRef = useRef(false);
  const ackTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastTypingAt = useRef(0);

  const clearAck = useCallback((clientMsgId: string) => {
    const timer = ackTimers.current.get(clientMsgId);
    if (timer) clearTimeout(timer);
    ackTimers.current.delete(clientMsgId);
  }, []);

  const clearAllAcks = useCallback(() => {
    ackTimers.current.forEach((timer) => clearTimeout(timer));
    ackTimers.current.clear();
  }, []);

  const armAck = useCallback(
    (clientMsgId: string) => {
      clearAck(clientMsgId);
      ackTimers.current.set(
        clientMsgId,
        setTimeout(() => {
          ackTimers.current.delete(clientMsgId);
          useRoomStore.getState().setMessageStatus(clientMsgId, "failed");
        }, ACK_TIMEOUT_MS),
      );
    },
    [clearAck],
  );

  const transmit = useCallback((event: ClientEvent) => {
    if (openRef.current) transportRef.current?.send(event);
  }, []);

  const transmitMessage = useCallback(
    (clientMsgId: string, text: string) => {
      if (!openRef.current) return; // stays in the outbox until the next open
      transmit({ type: "msg.send", client_msg_id: clientMsgId, text });
      armAck(clientMsgId);
    },
    [armAck, transmit],
  );

  useEffect(() => {
    if (!enabled) return;
    const store = useRoomStore.getState;
    let disposed = false;
    let attempt = 0;
    let connecting = false;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const shouldStop = (code: number) =>
      code === WS_CLOSE.walletEmpty || code === WS_CLOSE.sessionOver || store().phase === "summary";

    const scheduleReconnect = () => {
      if (disposed) return;
      store().setConnection("reconnecting");
      const delay = backoffDelay(attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (disposed || connecting || openRef.current) return;
      connecting = true;
      store().setConnection(attempt === 0 ? "connecting" : "reconnecting");
      let ticket: string;
      try {
        ticket = (await client.wsTicket(sessionId)).ticket;
      } catch (error) {
        connecting = false;
        if (error instanceof ApiError && error.code === "not_found") {
          store().setConnection("closed");
          return;
        }
        scheduleReconnect();
        return;
      }
      if (disposed) {
        connecting = false;
        return;
      }
      transportRef.current = factory({
        sessionId,
        ticket,
        handlers: {
          onOpen: () => {
            connecting = false;
            if (disposed) return;
            openRef.current = true;
            attempt = 0;
            store().setConnection("open");
            transmit({ type: "resume", last_seq: store().lastSeq });
            for (const message of outbox(store()))
              transmitMessage(message.clientMsgId ?? "", message.text);
            pingTimer = setInterval(() => transmit({ type: "ping" }), PING_INTERVAL_MS);
          },
          onEvent: (event) => {
            if (disposed) return;
            if (event.type === "msg.ack") clearAck(event.client_msg_id);
            store().apply(event);
          },
          onClose: (code) => {
            connecting = false;
            openRef.current = false;
            transportRef.current = null;
            if (pingTimer) clearInterval(pingTimer);
            clearAllAcks(); // unacked messages stay "sending" in the outbox and are resent on reconnect
            if (disposed) return;
            if (shouldStop(code)) {
              store().setConnection("closed");
              return;
            }
            scheduleReconnect();
          },
        },
      });
    };

    const onOnline = () => {
      if (openRef.current || connecting) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      attempt = 0;
      void connect();
    };

    window.addEventListener("online", onOnline);
    void connect();

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearAllAcks();
      openRef.current = false;
      transportRef.current?.close(WS_CLOSE.normal, "leaving");
      transportRef.current = null;
    };
  }, [enabled, sessionId, client, factory, transmit, transmitMessage, clearAck, clearAllAcks]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, limits.messageMaxLength);
      if (trimmed === "") return;
      const clientMsgId = newClientMsgId();
      useRoomStore.getState().addOptimistic(clientMsgId, trimmed);
      transmitMessage(clientMsgId, trimmed);
    },
    [transmitMessage],
  );

  const retry = useCallback(
    (clientMsgId: string) => {
      const message = useRoomStore
        .getState()
        .items.find((item) => item.kind === "message" && item.clientMsgId === clientMsgId);
      if (!message || message.kind !== "message") return;
      useRoomStore.getState().setMessageStatus(clientMsgId, "sending");
      transmitMessage(clientMsgId, message.text);
    },
    [transmitMessage],
  );

  const sendTyping = useCallback(
    (on: boolean) => {
      const now = Date.now();
      if (on && now - lastTypingAt.current < TYPING_THROTTLE_MS) return;
      lastTypingAt.current = on ? now : 0;
      transmit({ type: "typing", on });
    },
    [transmit],
  );

  return { send, retry, sendTyping };
}
