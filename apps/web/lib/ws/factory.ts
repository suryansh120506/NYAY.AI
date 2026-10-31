import { publicConfig } from "@/lib/config";
import { createMockTransport } from "./mock-socket";
import type { TransportFactory } from "./transport";
import { createWebSocketTransport } from "./websocket-transport";

export const transportFactory: TransportFactory = publicConfig.useMocks
  ? createMockTransport
  : createWebSocketTransport;
