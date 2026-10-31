import type { SaranshClient } from "@/lib/api/clients";
import { ApiError, type SaranshDocument, type SaranshResult } from "@/lib/api/types";
import { limits } from "@/lib/config";
import { requireMockUserId } from "./auth";
import { db, mutate } from "./db";
import { SARANSH_DAILY_CAP } from "./constants";
import { latency, todayKey, uid } from "./util";

const PROCESSING_MS = 2_600;

/**
 * The mock cannot read files, so it returns one fixed demo summary and marks it `is_demo` so the UI says so.
 * File names containing "unreadable" fail and names containing "blurry" come back with low confidence, so every
 * state can be demonstrated.
 */
const DEMO_RESULT: Record<"en" | "hi", Omit<SaranshResult, "confidence">> = {
  en: {
    bullets: [
      "This appears to be a legal notice sent on behalf of a landlord about a rented flat.",
      "It asks for unpaid rent to be cleared and mentions the security deposit amount.",
      "It mentions a 15-day period for a reply, counted from when the notice is received.",
    ],
    doc_type: "Legal notice",
    parties: ["Landlord (sender)", "Tenant (recipient)"],
    dates: [{ label: "Date on the notice", iso: "2026-09-28" }],
    amounts: [
      { label: "Unpaid rent", paise: 4_500_000 },
      { label: "Security deposit", paise: 9_000_000 },
    ],
    deadlines_mentioned: ["Reply within 15 days of receipt"],
    language: "en",
  },
  hi: {
    bullets: [
      "यह एक मकान मालिक की ओर से भेजा गया क़ानूनी नोटिस लगता है, जो किराये के फ़्लैट के बारे में है।",
      "इसमें बकाया किराया चुकाने की माँग है और सिक्योरिटी डिपॉज़िट की राशि का ज़िक्र है।",
      "इसमें जवाब के लिए 15 दिन की अवधि बताई गई है, जो नोटिस मिलने की तारीख़ से गिनी जाती है।",
    ],
    doc_type: "क़ानूनी नोटिस",
    parties: ["मकान मालिक (भेजने वाले)", "किरायेदार (पाने वाले)"],
    dates: [{ label: "नोटिस की तारीख़", iso: "2026-09-28" }],
    amounts: [
      { label: "बकाया किराया", paise: 4_500_000 },
      { label: "सिक्योरिटी डिपॉज़िट", paise: 9_000_000 },
    ],
    deadlines_mentioned: ["नोटिस मिलने के 15 दिन में जवाब"],
    language: "hi",
  },
};

export class MockSaranshClient implements SaranshClient {
  async upload(
    file: File,
    options: { consent: true; locale: "en" | "hi"; sessionId?: string | undefined },
  ): Promise<{ document_id: string }> {
    const userId = requireMockUserId();
    if (options.consent !== true) throw new ApiError("consent_required", 422);
    if (!(limits.saranshMimeTypes as readonly string[]).includes(file.type))
      throw new ApiError("unsupported_type", 415);
    if (file.size > limits.saranshMaxBytes) throw new ApiError("file_too_large", 413);
    const user = db().users[userId];
    if (!user) throw new ApiError("unauthorized", 401);
    const day = todayKey();
    const used = user.uploads.day === day ? user.uploads.count : 0;
    if (used >= SARANSH_DAILY_CAP) throw new ApiError("daily_cap", 429);
    await latency(500, 900);

    const name = file.name.toLowerCase();
    const outcome = name.includes("unreadable")
      ? "failed"
      : name.includes("blurry")
        ? "low_confidence"
        : "ready";
    const id = uid("doc");
    mutate((s) => {
      const u = s.users[userId];
      if (u) u.uploads = { day, count: used + 1 };
      s.documents[id] = {
        id,
        user_id: userId,
        file_name: file.name,
        mime: file.type,
        bytes: file.size,
        created_at: Date.now(),
        ready_at: Date.now() + PROCESSING_MS,
        outcome,
        locale: options.locale,
        session_id: options.sessionId ?? null,
      };
      const session = options.sessionId ? s.sessions[options.sessionId] : undefined;
      if (session && session.user_id === userId) session.document_id = id;
    });
    return { document_id: id };
  }

  async get(documentId: string): Promise<SaranshDocument> {
    await latency(120, 300);
    const userId = requireMockUserId();
    const doc = db().documents[documentId];
    if (!doc || doc.user_id !== userId) throw new ApiError("not_found", 404);
    const base = { id: doc.id, file_name: doc.file_name, is_demo: true };
    if (Date.now() < doc.ready_at)
      return { ...base, status: "processing", result: null, error_code: null };
    if (doc.outcome === "failed")
      return { ...base, status: "failed", result: null, error_code: "unreadable" };
    return {
      ...base,
      status: "ready",
      error_code: null,
      result: {
        ...DEMO_RESULT[doc.locale],
        confidence: doc.outcome === "low_confidence" ? 0.42 : 0.86,
      },
    };
  }
}
