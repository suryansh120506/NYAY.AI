import type { SamvaadClient } from "@/lib/api/clients";
import type { ReserveRequest, SessionInfo, StartRequest, WsTicket } from "@/lib/api/types";
import { requireMockUserId } from "./auth";
import * as server from "./samvaad-server";
import { latency } from "./util";

export class MockSamvaadClient implements SamvaadClient {
  async reserve(request: ReserveRequest): Promise<SessionInfo> {
    await latency(400, 700);
    return server.reserve(
      requireMockUserId(),
      request.advocate_id,
      request.match_id,
      request.document_id,
    );
  }

  async get(sessionId: string): Promise<SessionInfo> {
    await latency(150, 350);
    return server.getSession(requireMockUserId(), sessionId);
  }

  async start(sessionId: string, request: StartRequest): Promise<SessionInfo> {
    await latency(300, 500);
    return server.start(requireMockUserId(), sessionId, request);
  }

  async end(sessionId: string): Promise<SessionInfo> {
    await latency(250, 450);
    return server.end(requireMockUserId(), sessionId);
  }

  async wsTicket(sessionId: string): Promise<WsTicket> {
    await latency(80, 200);
    return server.issueTicket(requireMockUserId(), sessionId);
  }

  async attachDocument(sessionId: string, documentId: string): Promise<SessionInfo> {
    await latency(150, 300);
    return server.attachDocument(requireMockUserId(), sessionId, documentId);
  }

  async rate(sessionId: string, rating: { rating: number; tags: string[] }): Promise<void> {
    await latency(200, 400);
    server.rate(requireMockUserId(), sessionId, rating);
  }
}
