/**
 * Typed HTTP access to the FastAPI backend (brief rule 7): every path, body and response type comes from
 * `lib/api/generated/schema.d.ts`, generated from the API's OpenAPI schema (`pnpm gen:api`). Nothing is hand-typed.
 *
 * The access token lives only in memory; the refresh token is an httpOnly cookie the browser sends to /v1/auth.
 * A 401 triggers one silent refresh and a retry.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "@/lib/api/generated/schema";
import { ApiError, type ApiErrorCode, type AuthSession } from "@/lib/api/types";
import { setBridgedSession } from "@/lib/api/session-bridge";
import { publicConfig } from "@/lib/config";

export type Schemas = components["schemas"];

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "insufficient_funds",
  "session_exists",
  "invalid_phone",
  "invalid_otp",
  "rate_limited",
  "unauthorized",
  "not_found",
  "file_too_large",
  "unsupported_type",
  "daily_cap",
  "consent_required",
  "invalid_amount",
  "unknown",
]);

// ------------------------------------------------------------------------------------------------ session
let session: AuthSession | null = null;

export const httpSession = {
  get: (): AuthSession | null => session,
  set(next: AuthSession | null): void {
    session = next;
    setBridgedSession(next);
  },
};

const authMiddleware: Middleware = {
  onRequest({ request }) {
    if (session && !request.url.includes("/v1/auth/")) {
      request.headers.set("Authorization", `Bearer ${session.access_token}`);
    }
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: publicConfig.apiUrl, credentials: "include" });
api.use(authMiddleware);

// ------------------------------------------------------------------------------------------------- errors
export function toApiError(status: number, body: unknown): ApiError {
  const raw = (body ?? {}) as { code?: unknown; details?: unknown };
  const code =
    typeof raw.code === "string" && KNOWN_CODES.has(raw.code)
      ? (raw.code as ApiErrorCode)
      : "unknown";
  const details: Record<string, string | number> = {};
  if (raw.details && typeof raw.details === "object") {
    for (const [key, value] of Object.entries(raw.details as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number") details[key] = value;
    }
  }
  return new ApiError(
    status === 401 && code === "unknown" ? "unauthorized" : code,
    status,
    details,
  );
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

// ----------------------------------------------------------------------------------------------- refresh
let refreshing: Promise<AuthSession | null> | null = null;

/** Single-flight: concurrent 401s share one refresh request. */
export function refreshSession(): Promise<AuthSession | null> {
  refreshing ??= (async () => {
    try {
      const { data, response } = await api.POST("/v1/auth/refresh");
      httpSession.set(response.ok && data ? data : null);
    } catch {
      httpSession.set(null);
    }
    return httpSession.get();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Run a typed request; map failures to ApiError; on 401 refresh once and retry. */
export async function call<T>(
  request: () => Promise<FetchResult<T>>,
  { retryOn401 = true } = {},
): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request();
    if (result.response.status === 401 && retryOn401 && session && (await refreshSession())) {
      result = await request();
    }
  } catch {
    throw new ApiError("unknown", 0);
  }
  if (!result.response.ok || result.data === undefined) {
    throw toApiError(result.response.status, result.error);
  }
  return result.data;
}
