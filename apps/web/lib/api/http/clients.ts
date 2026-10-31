import type {
  AdvocateClient,
  AuthClient,
  NewsClient,
  ParakhClient,
  PaymentCheckout,
  SamvaadClient,
  SaranshClient,
  WalletClient,
} from "@/lib/api/clients";
import type {
  AdvocateEarnings,
  AdvocateMe,
  AdvocateSession,
  AuthSession,
  CheckoutResult,
  MatchRequest,
  MatchResponse,
  NewsPage,
  NewsQuery,
  OtpRequestResult,
  ReserveRequest,
  SaranshDocument,
  SessionInfo,
  StartRequest,
  TopupOrder,
  Wallet,
  WalletTxn,
  WsTicket,
} from "@/lib/api/types";
import { publicConfig } from "@/lib/config";
import { api, call, httpSession, refreshSession, toApiError, type Schemas } from "./fetcher";

export class HttpAuthClient implements AuthClient {
  async requestOtp(phoneE164: string): Promise<OtpRequestResult> {
    return call(() => api.POST("/v1/auth/otp/request", { body: { phone_e164: phoneE164 } }), {
      retryOn401: false,
    });
  }

  async verifyOtp(phoneE164: string, code: string): Promise<AuthSession> {
    const session = await call(
      () => api.POST("/v1/auth/otp/verify", { body: { phone_e164: phoneE164, code } }),
      { retryOn401: false },
    );
    httpSession.set(session);
    return session;
  }

  current(): AuthSession | null {
    return httpSession.get();
  }

  restore(): Promise<AuthSession | null> {
    return httpSession.get() ? Promise.resolve(httpSession.get()) : refreshSession();
  }

  async logout(): Promise<void> {
    try {
      await api.POST("/v1/auth/logout");
    } finally {
      httpSession.set(null);
    }
  }
}

export class HttpParakhClient implements ParakhClient {
  async match(request: MatchRequest): Promise<MatchResponse> {
    return call(() => api.POST("/v1/parakh/match", { body: request }));
  }
}

export class HttpWalletClient implements WalletClient {
  async get(): Promise<Wallet> {
    return call(() => api.GET("/v1/wallet"));
  }

  async history(): Promise<WalletTxn[]> {
    const rows = await call(() => api.GET("/v1/wallet/history"));
    return rows.map((row) => ({
      ...row,
      advocate_name: row.advocate_name ?? null,
      minutes: row.minutes ?? null,
    }));
  }

  async createTopup(amountPaise: number): Promise<TopupOrder> {
    const order = await call(() =>
      api.POST("/v1/wallet/topups", { body: { amount_paise: amountPaise } }),
    );
    return {
      order_id: order.order_id,
      amount_paise: order.amount_paise,
      provider: order.provider,
      key_id: order.key_id,
    };
  }
}

// --------------------------------------------------------------------------------------------- checkout
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  handler: () => void;
  modal: { ondismiss: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: () => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("checkout script failed to load"));
    document.head.appendChild(script);
  });
}

/**
 * Fake provider (dev): "pays" through the API's signed dev webhook. Razorpay: opens Razorpay Checkout; the credit is
 * posted by the server when Razorpay's webhook arrives, never by the browser.
 */
export class HttpCheckout implements PaymentCheckout {
  async open(order: TopupOrder): Promise<CheckoutResult> {
    if (order.provider === "fake") {
      const result = await call(() =>
        api.POST("/v1/dev/payments/{order_id}/capture", {
          params: { path: { order_id: order.order_id } },
        }),
      );
      return result.status === "captured" || result.status === "duplicate" ? "paid" : "failed";
    }
    await loadScript(RAZORPAY_CHECKOUT_JS);
    const Razorpay = window.Razorpay;
    if (!Razorpay || !order.key_id) return "failed";
    return new Promise<CheckoutResult>((resolve) => {
      const checkout = new Razorpay({
        key: order.key_id ?? "",
        order_id: order.order_id,
        amount: order.amount_paise,
        currency: "INR",
        name: "Nyay.ai",
        handler: () => resolve("paid"),
        modal: { ondismiss: () => resolve("dismissed") },
      });
      checkout.on("payment.failed", () => resolve("failed"));
      checkout.open();
    });
  }
}

// ------------------------------------------------------------------------------------------------- news
/**
 * Server-side: rendered by the home and /updates pages. API_INTERNAL_URL (server-only, read at request time) lets the
 * web server reach the API on a private address; it falls back to NEXT_PUBLIC_API_URL.
 */
export class HttpNewsClient implements NewsClient {
  async list({ category, limit = 7, cursor }: NewsQuery): Promise<NewsPage> {
    const base = process.env.API_INTERNAL_URL || publicConfig.apiUrl;
    const params = new URLSearchParams({ limit: String(limit) });
    if (category) params.set("category", category);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${base}/v1/news?${params.toString()}`, {
      next: { revalidate: 300 },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw toApiError(response.status, body);
    const page = body as Schemas["NewsPage"];
    return { items: page.items, next_cursor: page.next_cursor };
  }
}

// ---------------------------------------------------------------------------------------------- samvaad
function toSessionInfo(s: Schemas["SessionOut"]): SessionInfo {
  return { ...s, end_reason: s.end_reason ?? null };
}

export class HttpSamvaadClient implements SamvaadClient {
  async reserve(request: ReserveRequest): Promise<SessionInfo> {
    return toSessionInfo(await call(() => api.POST("/v1/samvaad/sessions", { body: request })));
  }

  async get(sessionId: string): Promise<SessionInfo> {
    return toSessionInfo(
      await call(() =>
        api.GET("/v1/samvaad/sessions/{session_id}", {
          params: { path: { session_id: sessionId } },
        }),
      ),
    );
  }

  async start(sessionId: string, request: StartRequest): Promise<SessionInfo> {
    return toSessionInfo(
      await call(() =>
        api.POST("/v1/samvaad/sessions/{session_id}/start", {
          params: { path: { session_id: sessionId } },
          body: request,
        }),
      ),
    );
  }

  async end(sessionId: string): Promise<SessionInfo> {
    return toSessionInfo(
      await call(() =>
        api.POST("/v1/samvaad/sessions/{session_id}/end", {
          params: { path: { session_id: sessionId } },
        }),
      ),
    );
  }

  async wsTicket(sessionId: string): Promise<WsTicket> {
    return call(() =>
      api.POST("/v1/samvaad/sessions/{session_id}/ws-ticket", {
        params: { path: { session_id: sessionId } },
      }),
    );
  }

  async attachDocument(sessionId: string, documentId: string): Promise<SessionInfo> {
    return toSessionInfo(
      await call(() =>
        api.POST("/v1/samvaad/sessions/{session_id}/document", {
          params: { path: { session_id: sessionId } },
          body: { document_id: documentId },
        }),
      ),
    );
  }

  async rate(sessionId: string, rating: { rating: number; tags: string[] }): Promise<void> {
    await call(() =>
      api.POST("/v1/samvaad/sessions/{session_id}/rating", {
        params: { path: { session_id: sessionId } },
        body: rating,
      }),
    );
  }
}

// ---------------------------------------------------------------------------------------------- saransh
export class HttpSaranshClient implements SaranshClient {
  async upload(
    file: File,
    options: { consent: true; locale: "en" | "hi"; sessionId?: string | undefined },
  ): Promise<{ document_id: string }> {
    return call(() =>
      api.POST("/v1/saransh/documents", {
        // The generated type describes the multipart fields; the file itself travels as a Blob.
        body: {
          file: file as unknown as string,
          consent: options.consent,
          locale: options.locale,
          session_id: options.sessionId ?? null,
        },
        bodySerializer: (body) => {
          const form = new FormData();
          form.append("file", file, file.name);
          form.append("consent", String(body.consent));
          form.append("locale", body.locale);
          if (body.session_id) form.append("session_id", body.session_id);
          return form;
        },
      }),
    );
  }

  async get(documentId: string): Promise<SaranshDocument> {
    const doc = await call(() =>
      api.GET("/v1/saransh/documents/{document_id}", {
        params: { path: { document_id: documentId } },
      }),
    );
    const result = doc.result;
    const [first, second, third] = result?.bullets ?? [];
    return {
      ...doc,
      error_code: doc.error_code ?? null,
      result:
        result && first !== undefined && second !== undefined && third !== undefined
          ? { ...result, bullets: [first, second, third] }
          : null,
    };
  }
}

// --------------------------------------------------------------------------------------------- advocate
export class HttpAdvocateClient implements AdvocateClient {
  me(): Promise<AdvocateMe> {
    return call(() => api.GET("/v1/advocate/me"));
  }

  setAvailability(isAvailable: boolean): Promise<AdvocateMe> {
    return call(() =>
      api.PATCH("/v1/advocate/availability", { body: { is_available: isAvailable } }),
    );
  }

  setRate(ratePaisePerMin: number): Promise<AdvocateMe> {
    return call(() =>
      api.PATCH("/v1/advocate/rate", { body: { rate_paise_per_min: ratePaisePerMin } }),
    );
  }

  sessions(): Promise<AdvocateSession[]> {
    return call(() => api.GET("/v1/advocate/sessions"));
  }

  earnings(): Promise<AdvocateEarnings> {
    return call(() => api.GET("/v1/advocate/earnings"));
  }
}
