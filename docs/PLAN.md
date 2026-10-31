# Nyay.ai — Build Plan

Source of truth: `NYAY_AI_MASTER_BUILD_PROMPT.md` (the brief). Decisions the brief does not make are in
[`ASSUMPTIONS.md`](./ASSUMPTIONS.md). Each phase ends at a **GATE**: run the verification commands, report,
and stop until the owner says "continue".

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `(mock)` = runs on a fake/fixture in that phase.

---

## Phase 1 — UI / layout on fixtures (no backend) `[x] complete (GATE 1 passed)`

Goal: the whole product is clickable offline. Every data source is a TypeScript interface with a fixture/mock
implementation (`NewsClient`, `ParakhClient`, `AuthClient`, `WalletClient`, `SaranshClient`, `SamvaadSocket`), so
Phase 2/3 swap implementations without touching components.

| #       | Step              | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [x] 1.1 | Bootstrap         | pnpm workspace; `apps/web` (Next.js 15 App Router, React 19, TS strict); Tailwind v4 `@theme` tokens (default palette cleared, so only tokens exist); `next-intl` en/hi with `[locale]` routing + middleware; Inter + Noto Sans Devanagari via `next/font/local` (offline-safe); ESLint (flat, `no-explicit-any`), Prettier; Vitest + Testing Library; Playwright; `scripts/check-design.mjs` (no hex/rgb colours in components, no spinners, no banned promotional copy); `Makefile` + mirrored root `pnpm` scripts (Windows has no `make`); `.env.example`; `docs/PLAN.md`, `docs/ASSUMPTIONS.md`, `docs/ARCHITECTURE.md` stub.                                                                                                                                                                                        |
| [x] 1.2 | Design primitives | `Button` (primary/secondary/text, ≥44 px), `Chip`, `Sheet` (bottom sheet, focus-trapped, Esc, scrim), `Skeleton` (flat tint, slow opacity pulse, static under reduced motion), `Toast`, `Avatar` (initials), `lib/money.ts` (`formatPaise`, integer-only, Indian grouping) + unit tests; `/[locale]/dev/styleguide` (404 in production).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [x] 1.3 | Home page         | Sticky solid `Nav` (wordmark, `LanguageToggle`, text "Sign in"); `HeroSearch` (8 px input, auto-grow ≤4 lines, static example placeholder, auto `lang`, attach button, submit arrow, Enter submits); `TrustRow`; `Footer` with disclaimer + Terms/Privacy/Grievance links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [x] 1.4 | NewsFeed          | `NewsClient` interface + `FixtureNewsClient` reading `fixtures/news.json` (30 clearly fictional items); Server Component + `Suspense` + `NewsFeedSkeleton`; client-side category pills; lead story + 3-col grid (1 col mobile), max 7 items; external links with attribution; `/updates` paginated list; hydration-safe relative time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [x] 1.5 | Parakh flow UI    | `/[locale]/parakh?q=` conversational view: query echo → skeleton while `match()` runs → one follow-up as chips (city) → up to 3 `AdvocateCard`s (factual fields only, price line, one "Connect"); `FixtureParakhClient` (keyword intent, demo advocates); premium "why" line behind entitlement flag; `OtpSheet` (fake, `000000`) on Connect/Attach only; reserve → navigate to Samvaad.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [x] 1.6 | Samvaad room UI   | `lib/ws/types.ts` (envelope per brief §3.3); Zustand store with state machine `preflight → connecting → live → low_balance → ending → summary`; `useSamvaadSocket` (ticket → connect → resume, 20 s ping, backoff 0.5→8 s with jitter, outbox resend, tick is the only balance source); `MockSamvaadSocket` (advocate joins, replies, per-minute ticks, warning, `wallet_empty`, disconnect + ack-drop simulation); `SamvaadRoom`, `PreflightCard`, `RoomHeader` (+`SessionClock`, `WalletChip`), `MessageList` (virtuoso, stick-to-bottom, "New messages" pill, date separators, system lines), `MessageBubble` (sending/sent/failed + retry), `Composer`, `ConnectionBanner`, `LowBalanceSheet` (top-up without leaving the room), `TerminatedSheet`/`SessionSummary` (itemised total, refund of unused hold, rating). |
| [x] 1.7 | Saransh UI        | `SaranshUploader` (drag-drop, file picker, camera capture on mobile, required consent checkbox, type/size validation, skeleton, error + low-confidence states); `SaranshCard` (exactly 3 bullets + "AI summary — please verify with your advocate"); `MockSaranshClient` (202 → processing → ready). Wired into hero attach and `PreflightCard`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [x] 1.8 | Polish            | Complete `hi.json`; `prefers-reduced-motion` audit; keyboard + screen-reader pass (`role="log"`, focus rings, 44 px targets); responsive at 375 / 768 / 1280; `WalletPage` (balance, top-up amounts, itemised history on mock); `loading.tsx` + `error.tsx` on every route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Verify:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; Playwright happy path on mocks (hero search →
follow-up → match → OTP → pre-flight with Saransh → live chat → low-balance top-up → termination → summary);
design guard script; Lighthouse mobile run.
**GATE 1:** screenshots (home, results, chat, low-balance), deviations from tokens, what is mocked.

---

## Phase 2 — Database, ledger and core APIs `[x] complete, awaiting GATE 2`

Owner constraint added before this phase: stateless and portable (one `.env`, Supabase / Upstash / Gemini / Groq,
pgvector instead of a Chroma server). See ASSUMPTIONS A46-A58.

| #       | Step              | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x] 2.1 | Infra             | `infra/docker-compose.yml` (optional stand-ins: Postgres 16 + pgvector, Redis 7 AOF `everysec`; hosted Supabase/Upstash via `.env`); `services/api` (uv, Python 3.12, FastAPI); config (pydantic-settings), structlog JSON + PII masking, request-ID middleware, security headers, CORS, `/healthz`, `/readyz`.                                                                                                                                    |
| [x] 2.2 | Schema            | SQLAlchemy 2.0 async models + Alembic migrations for every table in brief §2.2; `pgcrypto`, `pg_trgm`; CHECK constraints on paise; FK indexes; deferred zero-sum constraint trigger on `ledger_entries`; append-only grants for the app role; partial unique index (one non-terminal session per user); `praman_latest` view. `make migrate`, `make seed` (courts, 40 "Demo" advocates, 5 demo users, 30 news fixtures, `FixtureSource` outcomes). |
| [x] 2.3 | Ledger            | `app/ledger/{money,accounts,posting,verify}.py`; `post(txn)` writes balanced entries + `wallets` projection in one transaction; idempotency-key no-ops; Hypothesis property tests (no negative balance, always balanced, money conserved, duplicate keys are no-ops).                                                                                                                                                                              |
| [x] 2.4 | Auth              | OTP request/verify (`OtpProvider` + fake), 15-min access JWT, rotating refresh token (httpOnly, SameSite=Lax, Secure cookie, hashed at rest), signed visitor cookie (match-only), roles, consents, Redis sliding-window rate limits. Tests.                                                                                                                                                                                                        |
| [x] 2.5 | Wallet & payments | `PaymentProvider` (Razorpay + fake): create order → signature-verified webhook → idempotent top-up (DR `gateway_clearing`, CR `user_available`); min ₹100; bonus balance (spent first, expiring, non-refundable); wallet + history endpoints.                                                                                                                                                                                                      |
| [x] 2.6 | Parakh            | `Embedder` (Gemini + deterministic hash fake), `VectorStore` (pgvector + in-memory fake), arq re-index job, full pipeline (normalise → LLM intent w/ 3 s timeout + keyword fallback → Postgres geo-fence → Chroma rank within candidates → weighted rerank → standard/premium), degraded mode. Tests: out-of-jurisdiction never returned; Chroma down → `degraded: true`; standard vs premium shape.                                               |
| [x] 2.7 | News              | `news_items`, arq ingestion (`config/news_sources.yaml`, all disabled, `TODO(human)` URLs), robots/ETag/rate-limit, URL-hash dedupe, Redis cache, `GET /v1/news`.                                                                                                                                                                                                                                                                                  |
| [x] 2.8 | Wire frontend     | `openapi-typescript` client generated from FastAPI schema; real clients for auth, wallet, Parakh, news; fixtures remain behind `NEXT_PUBLIC_USE_MOCKS=true`.                                                                                                                                                                                                                                                                                       |

**Verify:** `make test`, `make lint` (ruff, mypy, eslint, tsc), end-to-end top-up script printing `ledger imbalance: 0`.
**GATE 2:** text schema diagram, test summary, what is mocked.

---

## Phase 3 — WebSockets, billing and AI integration `[x] complete (awaiting Gate 3)`

Owner decisions before Phase 3 (A59–A60): bill on a 60-second cadence (Upstash free tier), prorate early endings to
the second, Gemini `gemini-1.5-flash` / `text-embedding-004`, Groq `llama-3.1-8b-instant`, OTP stays mocked.

| #       | Step              | Delivered                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x] 3.1 | Session APIs      | reserve (wallet `FOR UPDATE`, ≥ 5× per-minute cost, hold bonus-first up to the cap), start (consents; LIVE when both parties are connected), end (the prorated final trigger), get, ws-ticket, document, rating, call-token; advocate desk APIs (availability, rate, sessions, earnings); one open session per user (partial unique index + Redis lock). |
| [x] 3.2 | Billing engine    | Redis meter, one Lua call per session-minute via `EVALSHA` (start / bill / freeze / cleanup), 60 s Postgres-gated engine with a bill-ahead window, advisory-lock leader, exact-time wallet-empty ending, mid-call top-up re-opens the meter, prorated refund + release at the end, meter rebuilt from Postgres if Redis loses it (A59, A60, A63).        |
| [x] 3.3 | Billing tests     | (a)–(e) plus proration, bonus-first, 60 s cadence keeps minutes prepaid, wallet-empty at the paid-through moment, top-up re-opening, heartbeat timeout, reservation expiry, Redis budget (0 idle, ≤ 1 per session-minute).                                                                                                                               |
| [x] 3.4 | WS gateway        | `/ws/samvaad/{id}`: one-time ticket (GETDEL), Origin check, pydantic envelope, idempotent persistence with per-session `seq`, `resume` replay, presence + typing, ticks/warnings/termination, close codes 4401/4402/4410; fan-out in-process or Redis Pub/Sub.                                                                                           |
| [x] 3.5 | Real socket in UI | HTTP Samvaad/Saransh/advocate clients, real WebSocket transport, advocate room (party-flipped view) and desk, prorated summary, disabled Audio button; contract checks; Playwright `@api` with two browser contexts (client + advocate).                                                                                                                 |
| [x] 3.6 | Saransh pipeline  | Storage interface (Postgres blobs / S3 SigV4 with SSE), pypdf text → Gemini vision OCR (fake offline), injection-safe prompt + schema validation, extractive fallback, in-process job + recovery, daily cap, consent, delete, retention purge (A61, A68). Tesseract dropped: Gemini vision replaces it.                                                  |
| [x] 3.7 | Praman            | Sources (fixture + gated eCourts/IndianKanoon stubs), shrinkage scoring, weekly job, append-only scores, audited admin read, web schema export drops it (A64).                                                                                                                                                                                           |
| [x] 3.8 | Calls (flagged)   | `CallProvider` + LiveKit token endpoint behind `ENABLE_CALLS=false`; disabled Audio button (A69).                                                                                                                                                                                                                                                        |
| [x] 3.9 | Hardening         | In-memory default rate limit on every route + Redis limits on abuse-sensitive ones, CSP/security headers, PII-masked logs, DPDP export with consultations/messages/documents, Prometheus `/metrics`, arq replaced by a zero-idle-cost scheduler (A62), runbook + Redis budget in ARCHITECTURE.md.                                                        |

**Verify:** `pnpm lint`, `pnpm test`, `pnpm e2e`, `pnpm e2e:api`, `pnpm load:billing` (500 sessions × 10 minutes:
p95 wake-up 6.6 s against a 60 s budget, drift 0, ledger imbalance 0, 1.00 Redis request per session-minute).

**Authenticity sweep (after Phase 3):** flat palette, 8 px controls, still pages, no framer-motion, no emoji or em
dashes, no invented social proof, `/terms` and `/privacy`, favicon and custom-domain head tags; enforced by
`check-design` and `tests/e2e/authenticity.spec.ts` (A71 to A73).

**Workspace redesign (after the sweep):** bento news grid with pictures and badges, split-screen Samvaad workspace
with a live citation panel (night theme), and `/saransh` document analysis with a mock PDF viewer and risk analysis;
tests in `tests/unit/workspace.test.ts` and `tests/e2e/workspace.spec.ts` (A74 to A78).

**Platform interactions (after the redesign):** OKLCH tokens with P3 accents, balanced headings, spring motion, view
transitions with a shared avatar, a Ctrl+K command palette, Popover tooltips with anchor positioning, a scroll-driven
reading bar, an idle-loaded WebGL hero, container queries, an optimistic desk toggle, React Compiler, design-token
export and opt-in visual regression; tests in `tests/e2e/interactions.spec.ts` (A79 to A86).

**Skeleton for phase 2 (handoff):** CI, Dependabot, Dockerfiles and a compose `app` profile, `pnpm secrets:check`,
version pins, and the Saransh clause-analysis contract behind `SARANSH_CLAUSES_ENABLED` (A87, A88). Where to pick up:
[`HANDOFF.md`](HANDOFF.md).

---

## Next (phase 2 on the new machine)

| #   | Step                   | Notes                                                                                                |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| [ ] | Gate 2 and 3 sign-off  | Screenshots in `docs/screenshots/`, `pnpm ledger:check`, `pnpm load:billing`.                        |
| [ ] | Real document analyser | Upload → `GET /v1/saransh/documents/{id}/clauses`; render the person's PDF and highlight by offsets. |
| [ ] | Clause rules review    | An advocate reviews `clauses.py`, then `SARANSH_CLAUSES_ENABLED=true`.                               |
| [ ] | SMS OTP provider       | Replace the fake behind `OTP_PROVIDER`.                                                              |
| [ ] | Live payments          | Razorpay keys and webhook; same ledger path as the fake.                                             |
| [ ] | Deploy                 | API image (one instance, `WS_FANOUT=local`), web image or Vercel, Supabase, Upstash.                 |
| [ ] | Legal review           | Terms, privacy, policy versions, Bare Act texts, retention (see the list in `HANDOFF.md`).           |

---

## Definition of done (from brief §5)

All verification passes; `make dev` boots offline on fakes; full Playwright happy path; ledger drift 0 in every
test; no Praman in user-facing responses; no spinner anywhere (grep); every UI colour comes from the tokens.
