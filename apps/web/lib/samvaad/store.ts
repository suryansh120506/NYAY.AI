"use client";

import { create } from "zustand";
import type { ServerEvent } from "@/lib/ws/types";
import {
  applyServerEvent,
  initialRoomData,
  type ChatMessage,
  type ConnectionStatus,
  type MessageStatus,
  type RoomData,
  type RoomPhase,
} from "./reducer";

interface RoomActions {
  reset(
    sessionId: string,
    options: { costPerMinute: number; clockRate: number; phase: RoomPhase },
  ): void;
  setPhase(phase: RoomPhase): void;
  setConnection(connection: ConnectionStatus): void;
  setCostPerMinute(costPerMinute: number): void;
  apply(event: ServerEvent, now?: number): void;
  addOptimistic(clientMsgId: string, text: string): void;
  setMessageStatus(clientMsgId: string, status: MessageStatus): void;
  setLowBalanceOpen(open: boolean): void;
}

export type RoomStore = RoomData & RoomActions;

/** Chat/session state only (brief §1.1: Zustand is reserved for this). */
export const useRoomStore = create<RoomStore>()((set) => ({
  ...initialRoomData,

  reset: (sessionId, { costPerMinute, clockRate, phase }) =>
    set({ ...initialRoomData, sessionId, costPerMinute, clockRate, phase }),

  setPhase: (phase) => set({ phase }),

  setConnection: (connection) => set({ connection }),

  setCostPerMinute: (costPerMinute) => set({ costPerMinute }),

  apply: (event, now = Date.now()) => set((state) => applyServerEvent(state, event, now)),

  addOptimistic: (clientMsgId, text) =>
    set((state) => {
      const message: ChatMessage = {
        kind: "message",
        key: `local:${clientMsgId}`,
        clientMsgId,
        seq: null,
        from: "user",
        text,
        ts: new Date().toISOString(),
        status: "sending",
      };
      return { items: [...state.items, message] };
    }),

  setMessageStatus: (clientMsgId, status) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.kind === "message" && item.clientMsgId === clientMsgId && item.status !== "sent"
          ? { ...item, status }
          : item,
      ),
    })),

  setLowBalanceOpen: (lowBalanceOpen) => set({ lowBalanceOpen }),
}));

/** Unacknowledged own messages, oldest first: resent after every reconnect (the server de-duplicates). */
export function outbox(state: RoomData): ChatMessage[] {
  return state.items.filter(
    (item): item is ChatMessage =>
      item.kind === "message" && item.clientMsgId !== null && item.status === "sending",
  );
}
