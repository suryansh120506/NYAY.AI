/**
 * Compile-time contract between the generated API types and the domain types the UI is built on.
 * If the backend changes a response shape, `pnpm typecheck` fails here instead of the UI breaking at runtime.
 */
import type {
  AdvocateEarnings,
  AdvocateMatch,
  AdvocateMe,
  AdvocateSession,
  AuthSession,
  MatchRequest,
  MatchResponse,
  NewsItem,
  NewsPage,
  ReserveRequest,
  SaranshResult,
  SessionInfo,
  StartRequest,
  Wallet,
  WalletTxn,
  WsTicket,
} from "@/lib/api/types";
import type { Schemas } from "./fetcher";

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

export type ContractChecks = [
  Assert<Extends<Schemas["MatchResponse"], MatchResponse>>,
  Assert<Extends<Schemas["AdvocateMatch"], AdvocateMatch>>,
  Assert<Extends<MatchRequest, Schemas["MatchRequestIn"]>>,
  Assert<Extends<Schemas["AuthSession"], AuthSession>>,
  Assert<Extends<Schemas["WalletOut"], Wallet>>,
  Assert<Extends<Schemas["WalletTxnOut"], WalletTxn>>,
  Assert<Extends<Schemas["NewsItemOut"], NewsItem>>,
  Assert<Extends<Schemas["NewsPage"], NewsPage>>,
  Assert<Extends<Omit<Schemas["SessionOut"], "end_reason">, Omit<SessionInfo, "end_reason">>>,
  Assert<Extends<Schemas["SessionOut"]["end_reason"], SessionInfo["end_reason"] | undefined>>,
  Assert<Extends<ReserveRequest, Schemas["ReserveIn"]>>,
  Assert<Extends<StartRequest, Schemas["StartIn"]>>,
  Assert<Extends<Schemas["WsTicketOut"], WsTicket>>,
  Assert<Extends<Omit<Schemas["SaranshResultOut"], "bullets">, Omit<SaranshResult, "bullets">>>,
  Assert<Extends<Schemas["AdvocateMeOut"], AdvocateMe>>,
  Assert<Extends<Schemas["AdvocateSessionOut"], AdvocateSession>>,
  Assert<Extends<Schemas["EarningsOut"], AdvocateEarnings>>,
];
