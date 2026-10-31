# Nyay.ai study guide: architecture and logic

A guide for learning the system later, on your own. It explains what was built, how the pieces fit, and why each
rule exists, with the file to open for each idea. Every claim here was checked against the code at the time of
writing (2026-10-31). When code and guide disagree, trust the code and fix the guide.

Read order if you have one evening: sections 1, 2, 3, 6 (the ledger), 7 (Samvaad), 12 (worked example). Everything
else is reference.

---

## 1. The product in one page

Nyay.ai is a pay-per-minute legal consultation marketplace for Uttar Pradesh and Delhi.

1. A person describes a legal problem in Hindi, English or Hinglish.
2. **Parakh** finds the best three verified advocates for that problem, in that city, in that language.
3. The person tops up a wallet, reserves a consultation, and chats with the advocate in **Samvaad**. The wallet is
   debited one minute at a time. Ending early refunds the unused seconds.
4. **Saransh** summarises a document the person uploads (and, in phase 2, flags risky clauses).
5. **Praman** is a hidden trust score for advocates. It only influences ranking. It never appears in any response
   or screen.

The hard problems, in order of how much code they take:

| Problem                                                     | Where it is solved                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| Never lose, create or double-charge a paisa                 | Double-entry ledger + idempotency keys (section 6)           |
| Bill per minute on a free Redis plan (10,000 requests/day)  | Redis meter + 60 s engine + bill-ahead window (section 7)    |
| Several things end a call at once (user, advocate, balance) | One row lock + one idempotent settlement (section 7)         |
| Matching that never goes down because an AI is down         | Fallback chain + degraded mode (section 8)                   |
| Keeping private documents and chats private                 | Store structure not text, mask logs, delete on request (9)   |
| A UI that feels premium without gimmicks                    | Tokens, a design guard script, motion only where it explains |

## 2. Repository map

```
apps/web/                 Next.js 15 app (App Router, React 19, Tailwind v4, next-intl en/hi)
  app/[locale]/           Pages. (marketing)=home, (app)=signed-in screens, updates, saransh, terms, privacy
  components/             ui/ (design system), home/, parakh/, samvaad/, workspace/, analysis/, news/, command/ ...
  lib/api/                Data access: interfaces, HTTP implementation, in-browser mock implementation
  lib/ws/                 WebSocket transport, protocol types, the useSamvaadSocket hook
  lib/samvaad/            Room state: pure reducer + Zustand store
  lib/legal/              Terms, privacy, Bare Act excerpts, citation finder
  lib/news/               Mesh-art generator and bento layout
  messages/               en.json and hi.json (typed, every string)
  scripts/check-design.mjs  The design guard (runs in lint)
  tests/                  unit/ (Vitest), e2e/ (Playwright), visual/ (opt-in)
services/api/             FastAPI modular monolith
  app/core/               config, DI container, middleware, errors, rate limit, security, logging, metrics
  app/db/                 SQLAlchemy models, Alembic migrations (3), transaction helper
  app/ledger/             accounts, posting, operations, verify, money
  app/modules/            auth, users, wallet, payments, parakh, samvaad, saransh, praman, news, health, admin
  app/integrations/       llm, embeddings, vectorstore, ocr, otp, payments, storage, calls (interface+fake+real)
  app/workers/            scheduler (asyncio clock) and jobs
  tests/                  pytest (ledger properties, billing, WS, Parakh, payments, schema guard)
infra/                    docker-compose (Postgres+pgvector, Redis, optional app profile)
scripts/                  dev runner, env helper, bundle, check_secrets
docs/                     HANDOFF, PLAN, ASSUMPTIONS (A1..A88), ARCHITECTURE, this guide, screenshots
design/tokens.json        Generated design tokens
.github/                  CI workflow, Dependabot
```

Where to look first when you want to understand X:

| X                           | Open                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| How money moves             | `services/api/app/ledger/operations.py`, then `posting.py`        |
| How a minute is billed      | `modules/samvaad/meter.py` (Lua), `engine.py`, `service.py::bill` |
| How a call ends             | `modules/samvaad/service.py::finalize`, `billing.py::prorate`     |
| How matching ranks          | `modules/parakh/service.py::match`                                |
| How the UI talks to the API | `apps/web/lib/api/clients.ts` and `select.ts`                     |
| How the chat room behaves   | `lib/ws/useSamvaadSocket.ts`, `lib/samvaad/reducer.ts`            |
| Why a decision was made     | `docs/ASSUMPTIONS.md` (search the A-number)                       |

## 3. System architecture

```
 Browser (Next.js app, en/hi)
   |  HTTPS JSON (access token in memory, refresh token in httpOnly cookie)
   |  WebSocket /ws/samvaad/{id}?ticket=...   (one-time ticket)
   v
 FastAPI (one process, "modular monolith")
   |-- routers: auth, users, wallet, payments, parakh, samvaad, saransh, news, admin, health
   |-- SamvaadService  ---- BillingEngine (asyncio task, wakes every 60 s)
   |-- SessionHub (in-process WebSocket registry; optional Redis Pub/Sub fan-out)
   |-- Providers (DI container): llm, embedder, vectors, payments, otp, storage, ocr, redis, db sessions
   v                                           v
 Postgres (+pgvector, pg_trgm, pgcrypto)      Redis
   system of record: users, ledger,           meter + one-live-session lock, OTP hashes,
   wallets, sessions, messages, documents,    WS tickets, rate limits.  Losing it loses no money.
   embeddings, news, audit

 Worker (python -m app.workers.scheduler): news ingest, bonus expiry, retention purge, nightly ledger check,
 document recovery, weekly Praman. Idle = zero Redis requests.
```

Key properties:

- **Postgres is the source of truth.** Redis only decides _when_ a minute is charged. If Redis is flushed, the
  meter is rebuilt from Postgres and nothing is lost or invented (`service.py::bill`, status `NO_METER`).
- **Stateless processes.** No file or state lives on the machine. All config comes from one root `.env`
  (`app/core/config.py` reads it; Next reads it in `next.config.ts`; Docker images read plain environment variables).
- **Everything external is an interface with a fake.** `app/core/providers.py` builds each integration from
  settings. With no keys set, OTP, payments, LLM, embeddings, OCR and storage all run on offline fakes, which is
  why CI and a fresh clone work with no accounts.
- **Two runtime modes for the web app.** `NEXT_PUBLIC_USE_MOCKS=true` runs the whole UI on in-browser mocks (no
  backend). `false` talks to the API. Same components, different data layer (section 11).

## 4. Rules that shape every file

These came from the original brief and the owner's decisions. When in doubt, they win.

1. **Money is integer paise.** Never floats, never Decimal (`ledger/money.py::require_paise` raises on anything else).
2. **Every money movement is one balanced posting** that sums to zero, with an idempotency key.
3. **Idempotency everywhere money or state changes**: webhooks, minute debits, refunds, releases, messages.
4. **Postgres first.** Every state change happens under a row lock in a transaction; Redis is a cache and a meter.
5. **Interface + fake + real** for every provider, chosen by env.
6. **Free-tier budget.** Upstash allows 10,000 Redis requests a day, so billing is one request per live minute and
   an idle system makes none (section 7.4).
7. **Praman never reaches a user.** Enforced by `tests/test_public_schema.py` (no field named like a score or rank
   in any non-admin response) and by `check-design` on the frontend.
8. **No private text at rest beyond need.** Extracted document text and clause text are never stored.
9. **Honest UI.** No invented reviews, metrics or logos; no stock photos; flat colour; 8 px controls; no emoji or
   em dashes. A script enforces it (section 14).

## 5. Backend foundations

### 5.1 Configuration and DI

- `app/core/config.py`: one `Settings` class (pydantic-settings). Order: repo-root `.env`, `services/api/.env`,
  then real environment variables. `missing_required()` lists what the app refuses to start without (database,
  Redis, the two secrets, and provider keys only if that provider is selected).
- `app/core/providers.py`: a dataclass `Providers` holds settings, an HTTP client, Redis, the session factory and
  every integration. It also carries `clock`, an injectable epoch-ms function, so tests can move time without sleeping.
- `app/core/deps.py`: FastAPI dependencies (`DbDep`, `ProvidersDep`, `CurrentUser`, the visitor `Actor`).

### 5.2 Request lifecycle

`app/core/middleware.py` wraps every request: request id (`X-Request-ID` in and out), security headers, and a
default per-IP rate limit held in memory (so ordinary traffic costs no Redis requests). Abuse-sensitive routes
(OTP, matching, top-up) add Redis limits via `app/core/ratelimit.py`: a sliding window kept as a sorted set, trimmed,
counted and appended in one Lua call. Errors are raised as `AppError(code, status, message, **details)` and turned
into one JSON shape (`core/errors.py`). Logs are structured (`structlog`) and a processor masks phone numbers to
`+91••••••1234` (`core/logging.py::mask_pii`). OTPs, tokens, chat and document text are never logged.

### 5.3 Authentication

Mocked OTP today (`OTP_PROVIDER=fake`, code `000000`, only when `ENV` is dev or test). The flow is real though:

1. `POST /v1/auth/otp/request`: two rate limits (per IP, per phone hash), a resend cooldown set with `SET NX`,
   a random code, stored as an HMAC (`hash_otp`) with a TTL, then handed to the provider.
2. `POST /v1/auth/otp/verify`: increments an attempts counter, compares HMACs, deletes the code on success or after
   too many attempts, upserts the user (`ON CONFLICT DO NOTHING`), issues tokens.
3. **Access token**: a short JWT (15 minutes) the browser keeps in memory only. **Refresh token**: random string,
   stored hashed in `refresh_tokens`, sent as an httpOnly cookie, rotated on use.
4. **Visitor cookie**: signed id for anonymous people, so a match search can be recorded before sign-in.

### 5.4 Database and integrity

Migrations: `0001_initial_schema`, `0002_samvaad_billing_and_saransh_fields`, `0003_session_presence`. Main tables
(`app/db/models/tables.py`): users, consents, refresh_tokens, courts, advocate_profiles, advocate_courts,
advocate_embeddings, ledger_accounts, ledger_txns, ledger_entries, wallets, bonus_grants, payment_orders, payouts,
sessions, messages, session_ratings, match_requests, documents, document_blobs, document_summaries, case_outcomes,
praman_scores, news_items, audit_log.

Integrity is enforced by the database itself, not just the code, so a bug cannot corrupt money:

| Guarantee                             | Mechanism                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Every ledger transaction sums to zero | Deferred constraint trigger `ledger_entries_balanced` checks at commit (min 2 legs, sum 0) |
| Ledger is append-only                 | `BEFORE UPDATE OR DELETE OR TRUNCATE` triggers on `ledger_entries` and `ledger_txns` raise |
| A posting happens at most once        | `UNIQUE (idempotency_key)` on `ledger_txns`                                                |
| One open consultation per user        | Partial unique index `uq_sessions_one_open_per_user` on open states                        |
| A webhook captures an order once      | `UNIQUE (provider_order_id)` plus `SELECT ... FOR UPDATE` on the order                     |
| Account rows are unique               | `UNIQUE NULLS NOT DISTINCT (kind, owner_user_id)`, created with `ON CONFLICT DO NOTHING`   |
| `updated_at` is honest                | `set_updated_at` trigger                                                                   |

`app/db/tx.py::transaction()` closes SQLAlchemy's implicit read transaction first so the write transaction starts
clean (A55).

## 6. The ledger (the heart of the system)

### 6.1 Idea

Double-entry bookkeeping: every movement is a set of **legs**, positive = debit, negative = credit, and the legs of a
transaction add up to exactly zero. Money is never created or destroyed, only moved between accounts.

Accounts (`ledger/accounts.py`):

| Account            | Meaning                                                | Owner    |
| ------------------ | ------------------------------------------------------ | -------- |
| `user_available`   | Spendable wallet balance (a liability of the platform) | user     |
| `user_held`        | Money held for an open consultation                    | user     |
| `user_bonus`       | Promotional credit, spent first                        | user     |
| `advocate_payable` | What the platform owes an advocate                     | advocate |
| `platform_revenue` | The platform's fee                                     | none     |
| `gst_payable`      | GST collected on the fee                               | none     |
| `gateway_clearing` | The payment gateway's side of top-ups                  | none     |
| `bonus_expense`    | Cost of granted bonus credit                           | none     |

User accounts are liabilities, so a user's balance is **minus** the sum of their entries (a credit increases it).
The `wallets` table is a projection of those three accounts, updated in the same transaction as the entries.

### 6.2 The posting algorithm (`ledger/posting.py::post`)

1. Must run inside a DB transaction. Validate: key 1 to 160 chars, at least 2 legs, integer non-zero amounts, sum 0.
2. **Idempotency**: if the key already exists, return the original transaction (`created=False`). A retry is a no-op.
3. Compute each user's wallet deltas. Lock the wallets **in id order** (`FOR UPDATE`), so two concurrent postings
   cannot deadlock. Refuse (`InsufficientFunds`) anything that would take a column below zero, before writing a row.
4. Insert the txn with `ON CONFLICT DO NOTHING` (a race on the key loses cleanly), insert the entries, apply the deltas.
5. At commit the database trigger re-checks the sum is zero.

### 6.3 The operations (`ledger/operations.py`)

| Operation    | Debit (+)                                | Credit (-)                                      | Key                              |
| ------------ | ---------------------------------------- | ----------------------------------------------- | -------------------------------- |
| top-up       | gateway_clearing                         | user_available                                  | per payment order                |
| reserve      | user_bonus, user_available (bonus first) | user_held                                       | `sess:{id}:reserve`, `:hold:{n}` |
| minute debit | user_held                                | advocate_payable, platform_revenue, gst_payable | `sess:{id}:min:{n}`              |
| refund       | advocate_payable, platform_revenue, gst  | user_held                                       | `sess:{id}:refund`               |
| release      | user_held                                | user_available, user_bonus                      | `sess:{id}:release`              |
| bonus grant  | bonus_expense                            | user_bonus                                      | per grant                        |
| bonus expiry | user_bonus                               | bonus_expense                                   | per grant                        |

Because the minute key contains the minute number, retrying "bill minute 7" cannot charge it twice.

### 6.4 Pricing and GST

Per minute the user pays `adv + plat + gst` where `adv` is the advocate's own rate, `plat` the platform fee
(`PLATFORM_FEE_PAISE_PER_MIN`, default 500) and `gst = (plat * GST_RATE_BPS + 5000) // 10000` (half-up on the fee
only, default 18 percent, so 90 paise). The advocate's share is exactly their rate: no fee is ever taken out of it.
`billing.py::rates_for` builds this. TODO(human): finance and legal must confirm the fee, GST treatment and rounding.

### 6.5 Verification (`ledger/verify.py`)

Recomputes every wallet from the ledger with one SQL statement and compares to the projection. Any difference, any
unbalanced transaction, or a non-zero system total is an incident. It runs nightly in the worker, on demand at
`GET /v1/admin/ledger/health`, and as `pnpm ledger:check` (prints `ledger imbalance: 0`). The property test in
`tests/test_ledger.py` (`@given(sequence=OPS)`) uses Hypothesis to throw random sequences of operations at it.

## 7. Samvaad: consultations and per-minute billing

### 7.1 State machine

```
RESERVED --(user starts, both online)--> LIVE --(any end trigger)--> ENDING --> SETTLED
    |                                                                    ^
    +--(timeout or cancel)--> CANCELLED                                  |
                                          crash during settlement: engine re-runs finalize
```

Open states are RESERVED, LIVE, ENDING. Terminal states are SETTLED and CANCELLED.

### 7.2 Reserve (`SamvaadService.reserve`)

In one transaction: lock the wallet, check the user has no open session, check spendable balance covers
`cost * RESERVE_MINUTES` (default 5), else `402 insufficient_funds`. The hold is `min(spendable, max(RESERVE_CAP,
required))`, taken bonus first, posted as `reserve`. The session row copies the rates at that moment, so later rate
changes never affect a running call. A race on "one open session per user" is caught by the partial unique index.

### 7.3 Going live (`maybe_go_live`)

LIVE begins when the user has pressed start **and** both parties have a socket. At that moment `meter.START` runs
once: takes the one-live-session lock, initialises the meter and debits **minute 1** (prepaid). The service then
posts minute 1 to the ledger and publishes `session.started` and a `session.tick` to each side.

### 7.4 The Redis meter and why billing is shaped this way

Constraint: Upstash free tier allows 10,000 requests per day. Billing every second would blow it. So:

- The **engine wakes every 60 s** (`BILLING_POLL_SECONDS`), not per session.
- It **bills ahead**: every minute that _starts before the next wake-up plus a lead_ (`horizon = poll + lead =
75 s`) is debited now. Minutes therefore stay prepaid even though checks are 60 s apart.
- Each live session costs **one Lua call per wake-up** (`EVALSHA`), so about one request per live minute.
- **Idle costs zero**: the engine reads open sessions from Postgres first; no sessions means no Redis call.
- A **Postgres advisory lock** (`pg_try_advisory_xact_lock`) lets several API instances run the engine but only one
  bills each wake-up, with no Redis cost.

`modules/samvaad/meter.py` holds four atomic Lua scripts:

| Script  | Does                                                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| start   | Take the lock, init the meter (or keep it on retry), debit minute 1                                                                                                                    |
| bill    | Debit every minute due before `now + horizon` while affordable; sync the hold from Postgres (absolute value, so a lost update cannot drift); re-open an exhausted meter after a top-up |
| freeze  | Set state ENDING, return the snapshot for final settlement                                                                                                                             |
| cleanup | Delete the meter and lock, but only if they belong to this session                                                                                                                     |

The core loop (`_BILL_BODY`): `target = floor((now + horizon - started) / 60000) + 1`; while `idx < target`, if
`held - consumed < cost` mark `INSUFFICIENT`, else `idx += 1; consumed += cost`. The `minute_idx` guard makes a
repeated or concurrent call a no-op. It also raises a one-time low-balance warning when two minutes or less remain.

Keys use a hash tag, `{u:<uid>}:meter`, so a user's keys share a slot if you ever move to Redis Cluster.

### 7.5 One billing step (`SamvaadService.bill`)

Under the session row lock: compute the target minute; if the hold is running low, **extend it** from the wallet
(`_extend_hold`, same path a mid-call top-up uses); call the meter; if Redis lost the meter, **rebuild it from
Postgres** and carry on; post the new minutes to the ledger (`_post_minutes`, each with its own idempotency key);
publish `session.tick` (to the user with balance and seconds left, to the advocate without the balance), and a
`session.warning` if low. If the meter says INSUFFICIENT, schedule an exact-time end.

### 7.6 Ending: one settlement for every trigger (`finalize`)

Ending triggers: user ends, advocate ends, wallet empty (an exact timer at the paid-through moment, not waiting for
a wake-up), heartbeat timeout (billed only up to last-seen plus the timeout), reservation expiry. They can race. The
rule: **all of them call `finalize`, which locks the row and is idempotent.** Whoever gets the lock settles; the rest
see a terminal state and return.

Settlement in one DB transaction:

1. Freeze the meter (if Redis is down, minutes it billed that Postgres never saw are simply not charged).
2. Post any metered minutes Postgres hasn't recorded.
3. `used = (end - started)` in seconds, capped at the prepaid minutes.
4. **Prorate** (`billing.py::prorate`): each component is `rate * used // 60`, rounded **down** (in the user's
   favour); refund = charged minus due, per component. Post the refund.
5. Release the rest of the hold: `release_split` returns unspent bonus to bonus and the rest to available.
6. Mark SETTLED with `used_seconds`, `refunded_paise`, end reason; set message `delete_after` (retention).
7. After commit: clean up Redis, publish `session.terminated` and close sockets with 4402 (wallet empty) or 4410.

### 7.7 Realtime protocol

Defined once in `apps/web/lib/ws/types.ts` and mirrored by pydantic models.

Server to client: `session.started`, `msg.new`, `msg.ack`, `presence`, `typing`, `session.tick`, `session.warning`,
`session.terminated`, `pong`, `error`. Client to server: `msg.send {client_msg_id, text}`, `typing`, `resume
{last_seq}`, `ping`.

Gateway (`modules/samvaad/gateway.py`):

1. Origin check, then accept. The browser first gets a **one-time ticket** over HTTPS; the socket consumes it with
   `GETDEL`, so a ticket cannot be replayed, and the ticket names session, user and party.
2. On connect: send a snapshot, tell the other party they are online, try to go live.
3. Loop with a receive timeout; validate every frame with pydantic; a per-connection in-memory rate limit protects
   against floods.
4. `msg.send` is stored **idempotently** by `(session, client_msg_id)` with a per-session `seq`; the sender gets
   `msg.ack`, the other side `msg.new`. `resume {last_seq}` replays what a reconnecting client missed.
5. On disconnect: update presence; if both are gone too long, the engine ends the session.

`SessionHub` (`hub.py`) is the connection registry. Mode `local` delivers in-process (zero Redis cost, one API
instance). Mode `redis` also publishes to Pub/Sub so several instances reach each other's sockets
(`WS_FANOUT=redis`, required if `BILLING_RUNNER=worker`).

### 7.8 What can go wrong and how it is handled

| Failure                           | Result                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Redis flushed or evicted mid-call | `NO_METER` -> meter rebuilt from Postgres, resumes at the same minute                 |
| Redis down at the end             | Unseen minutes not charged; settlement still completes from Postgres                  |
| API restarts mid-call             | Sessions in ENDING are re-finalized by the engine; LIVE ones continue billing         |
| Two end triggers at once          | Row lock + idempotent `finalize`; second returns unchanged                            |
| Same minute billed twice          | `minute_idx` guard plus unique ledger key `sess:{id}:min:{n}`                         |
| Browser drops and reconnects      | Exponential backoff with jitter, `resume {last_seq}`, outbox resends unacked messages |
| Wallet runs out                   | Exact timer at the paid-through moment; a top-up in time re-opens the meter           |

## 8. Parakh: matching

Pipeline (`modules/parakh/service.py::match`):

1. **Intent** (`intent.py`): ask the LLM for strict JSON (practice area, forum, urgency, statutes, language) with
   temperature 0 and a 3 s budget. The user's text is passed as quoted data, never instructions, and the reply is
   validated. Any failure falls back to a keyword classifier. Matching never blocks on a model.
2. **Location**: from the request, else return a follow-up question (primary and more cities). No guess.
3. **Candidates** (`eligible_candidates`): verified advocates in that state/district who speak the languages.
4. **Semantic search**: embed the query (768 dims) and query pgvector restricted to the candidate ids.
5. **Score** each candidate:

   `0.60 * semantic + 0.25 * trust_percentile/100 + 0.10 * availability + 0.05 * price_fit`

   (weights in settings). `price_fit` is 1 for the cheapest in the pool, 0 for the dearest. New advocates sit at the
   cohort median (50th percentile) so they are neither buried nor boosted. Ties break by id for determinism.

6. Return the **top 3**. Premium users also get a short "why this advocate" sentence (LLM, with a template fallback).
7. **Degraded mode**: if embeddings or the vector store fail, rank by trust + availability and set `degraded=true`.
   Search never returns a 500 because AI is down.
8. Record the request and scores in `match_requests` for later analysis.

Indexing (`indexing.py`) builds each advocate's profile text and embedding; `pnpm seed` and the worker re-index.

## 9. Saransh: documents

Upload (`POST /v1/saransh/documents`) requires explicit consent, validates type by sniffing magic bytes (PDF, JPEG,
PNG), size (10 MB) and pages (8), and enforces a daily cap. The job (`service.py::process`) runs in-process and is
re-run by a worker job if a restart interrupts it:

1. Fetch bytes from storage (`postgres` blobs, or any S3-compatible bucket with SSE).
2. PDF with a text layer: use it. Otherwise OCR (Gemini vision; fake offline). Too little text: fail as unreadable.
3. Summarise (`summarize.py`): untrusted text is fenced inside the prompt, the reply is schema-validated, bullets are
   capped in length, and if the LLM is unavailable an extractive fallback picks sentences from the document itself,
   flagged low-confidence. It also extracts parties, dates and amounts (in paise).
4. Store the summary and structured fields. **The extracted text is deleted from memory and never stored.**
5. The person can delete the document (bytes and summary go together). Retention purge removes old ones.

**Phase 2 clause analysis** (`modules/saransh/clauses.py`, behind `SARANSH_CLAUSES_ENABLED`, off): splits the text
into numbered clauses, assigns each a level (`high`, `review`, `standard`) by keyword rules, and stores only
`{number, page, start, end, level, rule}`. `GET /v1/saransh/documents/{id}/clauses` returns them with `risk_points`
(22 per high clause, 7 per review clause, capped at 100) and `risk_tier` (60 or more high, 30 or more moderate). The
fields are not named `score` because the public-schema test bans ranking-like names. The rules are engineer-written
heuristics: an advocate must review them first.

## 10. Praman, news and the worker

**Praman** (`modules/praman/`): internal advocate TrustScore, `100 * (0.5 outcomes + 0.3 ratings + 0.2 reliability)`.
Each component is shrunk toward the cohort mean (empirical Bayes: `(n*value + k*prior) / (n + k)`), so a few cases
cannot make or break someone. Outcomes are recency-weighted with a 2-year half-life, only labels with confidence 0.7
or more count, and fewer than 10 resolved cases means the cohort mean. Scores are appended (never updated) to
`praman_scores`; a view takes the latest; Parakh uses percentile ranks. Live data sources (eCourts, IndianKanoon) are
stubs behind `PRAMAN_LIVE_SOURCES=false` until there is a lawful, licensed data basis. Admin reads are audited.

**News** (`modules/news/`): feeds listed in `config/news_sources.yaml`, ingested by the worker, deduplicated by URL
hash. The offline build uses demo headlines. Real feed URLs and image licences are TODO(human).

**Scheduler** (`workers/scheduler.py`): a plain asyncio clock that wakes at each minute boundary and runs jobs whose
schedule matches, with a Postgres advisory lock per job so two workers never run the same one. It replaced a
Redis-polled job queue because that would burn the Redis budget while idle. Jobs (`jobs.py`): news ingest, document
recovery (every 5 min), bonus expiry, ledger verify (nightly), retention purge (nightly), Praman (weekly).

## 11. Frontend architecture

### 11.1 Routing and i18n

Next.js App Router under `app/[locale]/`, locales `en` and `hi` (`lib/i18n/routing.ts`, middleware by next-intl).
Every user-visible string lives in `messages/en.json` and `hi.json`, typed so a missing key fails `tsc`. Route
groups: `(marketing)` is the home page; `(app)` holds signed-in screens and mounts the TanStack Query provider.
Legal pages render from typed documents in `lib/legal/`. Route-level `loading.tsx` files never call next-intl (A29).

### 11.2 The data layer (the most important frontend idea)

Each domain (auth, parakh, samvaad, wallet, saransh, news, advocate) is an **interface** in `lib/api/clients.ts` with
two implementations: `lib/api/http/` (typed from the generated OpenAPI schema) and `lib/api/mock/` (an in-browser
fake backend with a seeded database). `lib/api/select.ts` picks by `NEXT_PUBLIC_USE_MOCKS`. UI code never knows which.
`lib/api/http/contract.ts` makes `tsc` fail if a generated API type drifts from the UI's domain type. This is why the
whole product runs and is tested with no backend, and why switching to the real API is one env var.

### 11.3 Realtime on the client

- `lib/ws/types.ts`: the protocol. `lib/ws/transport.ts`: a tiny interface (`send`, `close`).
  `websocket-transport.ts` is the real socket; `mock-socket.ts` plus `lib/api/mock/samvaad-server.ts` simulate a
  server (including billing ticks and the advocate's replies) for offline mode.
- `lib/ws/useSamvaadSocket.ts`: gets a one-time ticket, connects, sends `resume`, pings every 20 s, reconnects with
  exponential backoff plus jitter (0.5 s to 8 s), keeps an **outbox** of unacknowledged messages and resends after a
  reconnect, marks messages failed after 8 s without an ack. It runs **no billing timer**: balance and minutes come
  only from the server's `session.tick`.
- `lib/samvaad/reducer.ts`: a pure reducer for room state (`preflight, connecting, live, low_balance, ending,
summary`), free of React so it is easy to test. `store.ts` wraps it in Zustand. `lib/ws/perspective.ts` flips the
  same room for the advocate's view.

### 11.4 Workspaces

- **Samvaad room** (`components/samvaad/`, `workspace/`): a split screen. Chat on the left; on the right a Citation
  Panel. `lib/legal/citations.ts` scans each message for mentions such as "Section 420", "u/s 406 IPC", "धारा 420",
  resolves them against `lib/legal/bare-acts.ts` and shows glass cards with the Act text. The Bare Act text was
  entered from memory and must be verified word for word (TODO(human)).
- **Saransh analyser** (`app/[locale]/saransh`, `components/analysis/`): dropzone, a mock PDF viewer with highlighted
  clauses, and a terminal-style risk dial. It runs on `lib/saransh/sample.ts` until phase 2 wires the real upload and
  the clauses endpoint. Score logic is in `lib/saransh/analysis.ts` (the same arithmetic as the backend).
- **News** (`components/news/`, `lib/news/`): a bento grid. Art is generated, never fetched: `mesh.ts` hashes the
  headline into a seed and draws blobs of navy, slate and crimson, so a story always gets the same picture.

### 11.5 Design system and rules

Tokens live in `app/globals.css` (`@theme`): colours in OKLCH, type scale with tracking, radii, shadows, spacing,
easing. A night theme re-points the same tokens for the Samvaad room and analyser (`data-theme="night"`). The font is
**Inter** (`lib/fonts.ts`, `display: swap`), with Noto Sans Devanagari loaded only where Devanagari is real content.
`pnpm tokens:export` writes `design/tokens.json` (W3C format). Components in `components/ui/` are small and flat.

Platform features (A79 to A86): view transitions with a shared avatar (`lib/navigation/view-transition.tsx`), a
Ctrl+K command palette (`components/command/`), Popover tooltips with CSS anchor positioning
(`components/ui/Tooltip.tsx`), a scroll-driven reading bar, an idle-loaded WebGL hero (`components/home/HeroShader.tsx`),
container queries, an optimistic availability toggle, and the React Compiler.

Motion rule: Framer Motion may only be imported inside `components/motion`, which exposes two spring presets.
Everything respects `prefers-reduced-motion`.

## 12. Worked example: one consultation, with numbers

Setup: advocate rate 2,000 paise/min (Rs 20). Fee 500. GST on fee 90. So `cost = 2000 + 500 + 90 = 2,590` paise/min.
The user tops up Rs 500 = 50,000 paise.

1. **Top-up**: legs `+50000 gateway_clearing`, `-50000 user_available`. Wallet available = 50,000.
2. **Reserve**: needs `2590 * 5 = 12,950`. Spendable 50,000, so the hold is `min(50000, max(200000, 12950)) = 50,000`
   (the cap is larger). Legs: `+50000 user_available`, `-50000 user_held`. Available 0, held 50,000.
3. **Go live** at t = 0: minute 1 debited. Legs: `+2590 user_held`, `-2000 advocate_payable`, `-500 platform_revenue`,
   `-90 gst_payable`. Key `sess:S:min:1`.
4. Engine wakes at about t = 60 s. Horizon 75 s: minutes starting before 135 s are due, so minutes 2 and 3 (start at
   60 s and 120 s) are debited now in **one** Redis call, then posted as `...:min:2` and `...:min:3`.
5. The user ends at t = 150 s. `finalize`: billed minutes = 3 (7,770 paise charged: adv 6,000, plat 1,500, gst 270).
   Used = 150 s. Due per component, rounded down: adv `2000*150//60 = 5000`, plat `500*150//60 = 1250`, gst
   `90*150//60 = 225`. Due total 6,475 (exactly 2.5 minutes of cost). Refund = adv 1,000 + plat 250 + gst 45 = 1,295.
6. Release: hold 50,000, net spent 6,475, so 43,525 returns to `user_available`.
7. Final wallet: `50,000 - 6,475 = 43,525` available, 0 held. Advocate payable 5,000, revenue 1,250, GST 225.
   Sum of all balances is still 50,000: nothing was created or lost.

## 13. Testing strategy

| Layer                    | Tool                | What it proves                                                                                                                                                                                               |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API unit and integration | pytest              | Ledger invariants (Hypothesis), billing cadence and proration, WebSocket flows, Parakh, payments, auth, Saransh, news, the public-schema guard. Real Postgres (pgvector) and Redis, migrated fresh each run. |
| Billing load             | `pnpm load:billing` | 500 sessions x 10 minutes: p95 wake-up, drift 0, ledger imbalance 0, 1.00 Redis request per session-minute.                                                                                                  |
| Web unit                 | Vitest              | Reducer, money formatting, citation finder, perspective flip, mock server, socket hook, messages                                                                                                             |
| End to end               | Playwright + axe    | Full journeys on the offline build, accessibility, no horizontal scroll, keyboard, Hindi, motion rules, the command palette, view transitions                                                                |
| Real stack               | Playwright `@api`   | Two browser contexts (client and advocate) over a real WebSocket against a running API                                                                                                                       |
| Visual                   | Playwright (opt-in) | Pixel baselines per OS: `pnpm test:visual:update` once per machine                                                                                                                                           |

Gate scripts: `pnpm ledger:check`, `pnpm load:billing`, `pnpm e2e:api`. Test files mirror the module they cover.

## 14. Guardrails you will meet

- `apps/web/scripts/check-design.mjs` (part of `pnpm lint`): fails the build on colour literals outside the token file,
  gradients outside four allowed files, pill shapes, emoji, em dashes, hype words, invented social proof, Framer
  Motion outside `components/motion`, IntersectionObserver without an explicit allow comment, and the word Praman in
  frontend code.
- `tests/test_public_schema.py`: no non-admin response field may match `praman|trust|score|rank|percentile|...`.
- `scripts/check_secrets.py` (`pnpm secrets:check`): scans exactly what git would commit for key-shaped strings and
  credential URLs; refuses any real `.env`.
- `ruff`, `mypy --strict`, `eslint --max-warnings 0`, `tsc --noEmit`, `prettier --check`.

## 15. Delivery

- **CI** (`.github/workflows/ci.yml`): secret scan; web format, lint, unit, e2e; API ruff, mypy, pytest with Postgres
  (pgvector) and Redis service containers. No provider keys needed.
- **Docker**: `services/api/Dockerfile` (uv, non-root, `/healthz` check; one image for API, worker and migrations) and
  `apps/web/Dockerfile` (standalone server; `NEXT_PUBLIC_*` are build arguments). `docker compose -f
infra/docker-compose.yml --profile app up --build` runs the whole stack on the local stand-ins.
- **Environment**: `.env.example` documents every variable. Hosted targets: Supabase (Postgres, enable `vector`) and
  Upstash (Redis, use the `rediss://` URL). Run `alembic upgrade head` before each release.
- **Operations**: `/healthz`, `/readyz` (Postgres, Redis, vector store), `/metrics` (Prometheus, optional bearer
  token), structured logs. Runbooks for ledger drift, Redis loss and API restart are in `docs/ARCHITECTURE.md`.

## 16. Known limits and honest trade-offs

- Bills at 60 s granularity with bill-ahead, so a user is briefly prepaid for up to about a minute they may not use;
  proration refunds it to the second. The cost of finer granularity is Redis requests.
- One API instance is the default (`WS_FANOUT=local`). More than one needs Redis Pub/Sub, which costs requests.
- The chat is stored (with a retention window) so a dropped connection can resume. Transcripts are deleted after the
  retention period unless the user keeps them.
- Clause analysis is keyword heuristics, not legal analysis. It counts flagged clauses; it does not predict outcomes.
- Bare Act excerpts, terms, privacy text, fee and GST treatment, policy versions, payout rules: all need human
  review (`TODO(human)` markers, listed in `docs/HANDOFF.md`).
- Advocate payouts (schedule, TDS, bank details) are not built; `advocate_payable` is what the platform owes.
- OTP is mocked and calls are behind a flag with no provider chosen.

## 17. Study path and exercises

Work through these in order. Each one forces you to read the right code.

1. **Ledger by hand.** Post a top-up, a reserve and two minute debits on paper using section 6.3. Check each
   transaction sums to zero and compute the wallet from the entries. Then open `tests/test_ledger.py` and find the
   property that says the same thing.
2. **Break idempotency on purpose.** In a scratch copy, remove the `ON CONFLICT` in `post()` and run the ledger
   tests. Which test fails first, and why?
3. **Trace a retry.** Call `bill()` twice with the same `now`. Follow `meter.BILL` and `_post_minutes` and explain why
   the second call changes nothing (two separate guards).
4. **Race the endings.** Read `finalize` and explain what happens if the user ends the call at the same instant the
   wallet-empty timer fires. Which lock decides?
5. **Redis loss.** Read `test_d_redis_wiped_mid_session` in `tests/test_samvaad_billing.py` and explain how the
   meter returns at the right minute. Then read `test_a_thousand_concurrent_debits_for_the_same_minute_charge_once`.
6. **Proration edge.** Compute the refund for a 1-second call and a call that lasts exactly one minute. Why does
   rounding down never favour the platform?
7. **Rank three advocates.** With semantic 0.8, 0.6, 0.9, trust percentiles 40, 90, 50, availability 1, 1, 0 and
   prices 1000, 2000, 1500 paise, compute the Parakh scores and the order (section 8).
8. **Add a clause rule.** In `clauses.py` add a rule, write the failing test first in `tests/test_saransh_clauses.py`,
   then make it pass.
9. **Add a mock-only feature.** Add a field to a client interface, implement it in `lib/api/mock/` first, and render it,
   then do the HTTP side. Note how `contract.ts` guides you.
10. **Follow one pixel of the design rules.** Add a hex colour to a component and run `pnpm lint`. Read the message,
    then fix it by adding a token.

## 18. Glossary

| Term                                | Meaning                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Paise                               | 1/100 rupee. All money is an integer number of paise                                  |
| Leg                                 | One signed line of a ledger transaction; legs sum to zero                             |
| Hold                                | Wallet money moved to `user_held` while a consultation is open                        |
| Prepaid minute                      | A minute debited before it is served                                                  |
| Horizon                             | `poll + lead` seconds: how far ahead the engine bills                                 |
| Proration                           | Charging only for seconds used, refunding the rest of the last prepaid minutes        |
| Meter                               | The Redis hash that tracks minute index, consumed amount and state for a live session |
| Settlement                          | The one transaction that finalises a session (`finalize`)                             |
| Parakh / Samvaad / Saransh / Praman | Matching / consultation room / document tools / hidden advocate trust score           |
| Mock mode                           | `NEXT_PUBLIC_USE_MOCKS=true`: the web app runs on an in-browser fake backend          |
| Bento                               | The asymmetrical news grid                                                            |
| DTCG                                | W3C Design Tokens format used by `design/tokens.json`                                 |
