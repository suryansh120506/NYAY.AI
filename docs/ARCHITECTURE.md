# Architecture

Living document, current as of Phase 3 (realtime consultations, per-minute billing, document summaries, internal
TrustScore). Decisions are numbered in [`ASSUMPTIONS.md`](ASSUMPTIONS.md).

## Shape

A modular monolith (brief §1.1): one Next.js app, one FastAPI app with a package per module, and one background
worker. Postgres is the system of record; Redis holds only short-lived real-time state.

```
 browser ──► Next.js (apps/web) ──HTTPS──► FastAPI (services/api) ──► Postgres (Supabase)  ledger, sessions, chat, docs, pgvector
    │                                        │   ├─ billing engine     └► Redis (Upstash)   billing meters, OTP, Redis rate limits, caches
    └──────────── WebSocket /ws/samvaad ─────┘   └─ Saransh jobs       └► Gemini / Groq     intent, summaries, OCR, embeddings
                                                                       └► Razorpay          orders + signed webhooks
 pnpm worker (asyncio scheduler) ──────────────────────────────────────► news, bonus expiry, retention purge, Praman, ledger check
```

## Configuration and portability (A46)

- **One `.env` at the repo root** configures everything. FastAPI reads it through `app/core/config.py`; Next.js
  through `next.config.ts`. Real environment variables always win.
- The app holds **no state**: no SQLite, no runtime files, no hard-coded hosts. Document bytes go to Postgres
  (`STORAGE_PROVIDER=postgres`) or an S3-compatible bucket.
- Every external provider is an interface with a fake. With no keys set, OTP, payments, LLM, embeddings and OCR run
  offline; only `DATABASE_URL` and `REDIS_URL` are required. The API refuses to start if a required setting is
  missing and names it.
- `scripts/bundle.py` zips the repo without `.env`, dependencies or build output, and refuses files that look like
  credentials.

## Backend modules (`services/api/app`)

| Package                           | Responsibility                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`                           | settings, PII-masked logging, errors, JWT/refresh/visitor cookies, Redis + in-memory rate limits, middleware, metrics, providers                                                             |
| `db/`                             | SQLAlchemy models, Alembic migrations (0001–0003), session factory, `transaction()` helper                                                                                                   |
| `ledger/`                         | integer-paise money, accounts, `post()` (balanced entries + wallet projection), operations (incl. prorated refund), `verify`                                                                 |
| `modules/auth`, `users`           | phone OTP, access JWT, rotating refresh cookie; profile, consents, DPDP export and deletion request                                                                                          |
| `modules/wallet`, `payments`      | balances, history (one netted line per consultation), top-up orders, signed webhooks (→ mid-call hold extension)                                                                             |
| `modules/parakh`                  | intent extraction, jurisdiction filter, vector rank, rerank (uses the Praman percentile internally), public advocate profile                                                                 |
| `modules/samvaad`                 | `meter.py` (Redis Lua), `billing.py` (pure money rules), `service.py` (lifecycle), `engine.py` (60 s billing), `gateway.py` (WS), `hub.py` (fan-out), `router.py` (REST incl. advocate desk) |
| `modules/saransh`                 | upload, text/OCR, summary with validation and fallback, recovery                                                                                                                             |
| `modules/praman`                  | outcome sources (fixture + gated stubs), shrinkage scoring, weekly computation                                                                                                               |
| `modules/news`, `admin`, `health` | feed + RSS ingestion; ledger health, verification, bonus, audited Praman read; liveness, readiness, `/metrics`                                                                               |
| `integrations/`                   | LLM, embeddings, vector store, payments, OTP, storage (Postgres/S3), OCR (fake/Gemini), calls (LiveKit)                                                                                      |
| `workers/`                        | `scheduler.py` (minute-aligned asyncio clock, Postgres advisory lock per job) and `jobs.py`                                                                                                  |

## Schema (Postgres)

```
users ─┬─< consents                     append-only consent history (chat_storage, document_processing, …)
       ├─< refresh_tokens
       ├── wallets                       projection of the ledger (available / held / bonus, all ≥ 0)
       ├─< bonus_grants                  expiring bonus credit
       ├─< payment_orders                provider order id UNIQUE
       ├─< ledger_accounts (owner)       UNIQUE NULLS NOT DISTINCT (kind, owner_user_id)
       ├─< match_requests ──> advocate_profiles (chosen)
       ├─< documents ─┬── document_blobs     (STORAGE_PROVIDER=postgres; cascades)
       │              └── document_summaries (CHECK cardinality(bullets) = 3)
       ├─< sessions ─┬─< messages        UNIQUE (session_id, seq), UNIQUE (session_id, client_msg_id), delete_after
       │             └── session_ratings
       └── advocate_profiles ─┬─< advocate_courts >── courts
                              ├── advocate_embeddings        vector(768), HNSW cosine index
                              ├─< case_outcomes              fixture rows now; gated real adapters later
                              ├─< praman_scores              append-only; view praman_latest
                              └─< payouts                    (not built yet)

sessions: rates frozen at booking (adv / plat / gst paise), held_paise + held_bonus_paise, billed_minutes,
          used_seconds + refunded_paise (prorated settlement), presence (user/advocate conns + last_seen),
          last_seq (message counter), consents (keep_transcript, share_summary)
          partial UNIQUE (user_id) WHERE state IN ('RESERVED','LIVE','ENDING')  → one open session per user

ledger_txns ─< ledger_entries ──> ledger_accounts
  idempotency_key UNIQUE      signed amount ≠ 0;  DEFERRED trigger: SUM = 0 per txn;  UPDATE/DELETE rejected
```

## Money flow

Integer paise everywhere. Entries are signed (positive = debit) and each transaction sums to zero. User accounts
are platform liabilities: their balance is `−SUM(amount)`.

```
top-up       DR gateway_clearing                     CR user_available        key topup:{provider}:{order}
reserve      DR user_bonus, user_available           CR user_held             key sess:{id}:reserve   (bonus first)
hold extend  (same legs as reserve)                                           key sess:{id}:hold:{held_before}
minute       DR user_held                            CR advocate_payable      100 % of the advocate's rate
                                                     CR platform_revenue      platform fee
                                                     CR gst_payable           18 % of the fee        key sess:{id}:min:{n}
refund       DR advocate_payable, platform_revenue,  CR user_held             unused seconds of     key sess:{id}:refund
                gst_payable                                                   prepaid minutes (A60)
release      DR user_held                            CR user_bonus, user_available                    key sess:{id}:release
bonus grant  DR bonus_expense                        CR user_bonus
bonus expiry DR user_bonus                           CR bonus_expense
```

## Samvaad: a consultation end to end

```
reserve ──► RESERVED ── client presses Start + both sockets connected ──► LIVE ── any ending ──► ENDING ──► SETTLED
   │  hold = bonus first, then available                 │ minute 1 (and anything due before the next wake-up)
   │  (≥ 5 minutes, up to RESERVE_CAP)                   │ is debited at that moment
   └─ not started within 10 min ──► CANCELLED (hold released)
```

**Billing (A59, A63).** The engine wakes every `BILLING_POLL_SECONDS` (60). It reads open sessions from Postgres;
if there are none it stops there (no Redis request). For each LIVE session whose next minute starts before the next
wake-up + 15 s, it makes **one** Lua call that debits those minutes in Redis (the `minute_idx` guard makes repeats
no-ops), then posts them to the ledger with idempotency keys. When the hold runs low the hold is first extended from
the wallet (bonus first); one low-balance warning per episode. If the hold can't cover the next minute, the meter
turns EXHAUSTED and an in-process timer ends the session at exactly the paid-through second (a top-up before then
re-opens it). Several API instances: a Postgres advisory lock lets exactly one bill each wake-up.

**Ending (A60).** User, advocate, wallet-empty and heartbeat-timeout endings all call the same `finalize()`, under
`SELECT … FOR UPDATE`: freeze the meter → post any minute Redis billed that Postgres hasn't → prorate to the second
→ refund the unused part → release the hold (bonus part back to bonus) → SETTLED → set message retention → drop the
meter → tell both sockets (`session.terminated`, close 4402 wallet-empty / 4410 otherwise).

**Realtime (A65).** `POST …/ws-ticket` → one-time 30 s ticket → `/ws/samvaad/{id}?ticket=`. Messages are persisted
(idempotent per `client_msg_id`, `seq` from `UPDATE sessions … RETURNING`) before the `msg.ack`. Presence is kept in
Postgres. The advocate uses the same room URL; the web app flips parties so one store serves both views.

## Redis request budget (Upstash free tier: 10,000 requests/day)

| Activity                                   | Requests                                                           |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Idle system (no open consultation)         | **0** (engine and worker are Postgres-gated; no job-queue polling) |
| Live consultation, per minute              | **1** (one EVALSHA; measured 1.00 over 500 sessions × 10 min)      |
| Go-live / settlement                       | 1 / 2                                                              |
| WebSocket connection (ticket set + GETDEL) | 2                                                                  |
| OTP request + verify                       | ~6 (rate limits + code)                                            |
| Parakh search                              | 2 (rate limits)                                                    |
| Top-up order, document upload              | 1 each (rate limit)                                                |
| News feed                                  | 1 per cache miss (5 min TTL)                                       |

Roughly: a 10-minute consultation with sign-in costs ~25 requests, so the free tier carries a few hundred
consultations a day. Beyond that, a fixed-price Redis plan is cheaper than per-request pricing. `TODO(human)`.

## Runbooks

### Ledger drift detected

Signals: the nightly `verify_ledger` job logs `ledger.drift_detected`; `GET /v1/admin/ledger/health` returns
`ok: false`; `pnpm ledger:check` prints a non-zero imbalance.

1. Freeze payouts (none are automated yet) and stop the billing engine if the drift is growing
   (`BILLING_RUNNER=worker` on an instance that doesn't run the worker stops billing; open sessions settle from
   Postgres when it restarts).
2. `GET /v1/admin/ledger/health` lists unbalanced transactions and per-wallet drift (projection vs entries).
3. Unbalanced transaction → a bug that bypassed `post()` (the deferred trigger should make it impossible): inspect
   by `idempotency_key`. Wallet drift only → recompute the projection from entries inside a transaction; never edit
   entries (they are append-only; corrections are new, balanced transactions with an `adjust:` key).
4. Write up the cause and the correcting transactions in the audit log before unfreezing.

### Redis lost (flush, failover, eviction)

No money is lost: holds and the ledger are in Postgres. The next wake-up rebuilds each live meter from Postgres and
billing continues from the last posted minute (test (d)). A minute Redis had billed but Postgres had not yet posted
is simply not charged. WebSocket tickets in flight fail and clients reconnect with a new ticket.

### API restarted mid-consultation

Clients reconnect with backoff and `resume`; the engine's next wake-up bills from Postgres. A party who doesn't come
back within `HEARTBEAT_TIMEOUT_SECONDS` ends the session, billed only up to their last sign of life + timeout.
Documents left half-processed are picked up by the 5-minute recovery job.

## Web app

- Every data source is an interface (`apps/web/lib/api/clients.ts`) with an HTTP implementation (`lib/api/http/`,
  typed from the generated OpenAPI schema) and an offline one (`lib/api/mock/`), selected by
  `NEXT_PUBLIC_USE_MOCKS`. `lib/api/http/contract.ts` makes `tsc` fail if API and UI types drift apart. The schema
  export leaves out internal (Praman) endpoints, and `check-design` fails the build if Praman reaches the frontend.
- Access token in memory only; one silent refresh on 401 through the httpOnly cookie.
- Realtime (`lib/ws/`) and room state (`lib/samvaad/`) are transport-agnostic; `lib/ws/perspective.ts` gives the
  advocate the same room from the other chair. `/advocate` is the advocate's desk.
- Workspaces (A74 to A78): the Samvaad room and `/saransh` run in the night theme (`data-theme="night"` re-points the
  colour tokens). `lib/legal/citations.ts` finds section mentions in the chat and `components/workspace/CitationPanel`
  renders them beside it; `components/analysis/` is the document viewer and analysis. All Framer Motion goes through
  `components/motion`. News artwork is generated from the headline (`lib/news/mesh.ts`), never fetched.
- Security headers and CSP in `next.config.ts` (A70). Route-level `loading.tsx` files never call next-intl (A29).
- Platform layer (A79 to A86): `lib/navigation/view-transition.tsx` wraps client navigations in view transitions;
  `components/command/` is the Ctrl+K palette (mounted once in `AppProviders`); `components/ui/Tooltip.tsx` is the
  Popover-API tooltip; `components/home/HeroBackdrop.tsx` lazy-loads the WebGL hero after idle. Colour tokens are
  OKLCH; `pnpm tokens:export` writes them to `design/tokens.json`.

## Delivery

- **CI** (`.github/workflows/ci.yml`): secret scan; web format, lint, design guard, tsc, unit and Playwright on the
  offline build; API ruff, mypy and pytest against pgvector and Redis service containers. No provider keys needed.
- **Images:** `services/api/Dockerfile` (one image for the API, the worker and migrations) and `apps/web/Dockerfile`
  (Next.js standalone, from the repo root). `infra/docker-compose.yml --profile app` runs them against the local
  stand-ins. Configuration is environment-only in both.
- **Secrets:** `.env` is git-ignored and refused by `pnpm secrets:check`, which also scans everything git would
  commit for key-shaped strings and credential URLs.
- **Saransh clauses** (A88): `app/modules/saransh/clauses.py` runs inside the existing pipeline while the text is in
  memory and stores structure only in `document_summaries.extracted.clauses`; the endpoint is hidden while
  `SARANSH_CLAUSES_ENABLED=false`.
