/**
 * Every data source is an interface (brief rule 5). Phase 1 ships fixture/mock implementations in `lib/api/mock`;
 * Phase 2/3 add HTTP implementations behind the same interfaces, selected in `lib/api/index.ts`.
 */
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
} from "./types";
import type { Paise } from "@/lib/money";

export interface NewsClient {
  list(query: NewsQuery): Promise<NewsPage>;
}

export interface ParakhClient {
  match(request: MatchRequest): Promise<MatchResponse>;
}

export interface AuthClient {
  requestOtp(phoneE164: string): Promise<OtpRequestResult>;
  verifyOtp(phoneE164: string, code: string): Promise<AuthSession>;
  current(): AuthSession | null;
  /** Re-establish the session after a page load (HTTP: refresh-token cookie; mock: sessionStorage). */
  restore(): Promise<AuthSession | null>;
  logout(): Promise<void>;
}

export interface WalletClient {
  get(): Promise<Wallet>;
  history(): Promise<WalletTxn[]>;
  createTopup(amountPaise: Paise): Promise<TopupOrder>;
}

/** Opens the payment provider's checkout (Razorpay Checkout in production). */
export interface PaymentCheckout {
  open(order: TopupOrder): Promise<CheckoutResult>;
}

export interface SaranshClient {
  upload(
    file: File,
    options: { consent: true; locale: "en" | "hi"; sessionId?: string | undefined },
  ): Promise<{ document_id: string }>;
  get(documentId: string): Promise<SaranshDocument>;
}

export interface AdvocateClient {
  me(): Promise<AdvocateMe>;
  setAvailability(isAvailable: boolean): Promise<AdvocateMe>;
  setRate(ratePaisePerMin: Paise): Promise<AdvocateMe>;
  sessions(): Promise<AdvocateSession[]>;
  earnings(): Promise<AdvocateEarnings>;
}

export interface SamvaadClient {
  reserve(request: ReserveRequest): Promise<SessionInfo>;
  get(sessionId: string): Promise<SessionInfo>;
  start(sessionId: string, request: StartRequest): Promise<SessionInfo>;
  end(sessionId: string): Promise<SessionInfo>;
  wsTicket(sessionId: string): Promise<WsTicket>;
  attachDocument(sessionId: string, documentId: string): Promise<SessionInfo>;
  rate(sessionId: string, rating: { rating: number; tags: string[] }): Promise<void>;
}
