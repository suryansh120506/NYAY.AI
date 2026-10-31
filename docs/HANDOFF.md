# Handoff: picking Nyay.ai up on another machine

Read this first when resuming work. It records where the project stands, how to get it running from a fresh clone,
the decisions that are already made, and what is left for a human to decide.

## Where things stand (2026-10-30)

| Area                          | State                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: UI on fixtures       | Done (Gate 1 passed).                                                                                                                                                                             |
| Phase 2: DB, ledger, core API | Done, awaiting Gate 2 sign-off.                                                                                                                                                                   |
| Phase 3: realtime, billing    | Done, awaiting Gate 3 sign-off. Samvaad over WebSockets, 60 s billing engine prorated to the second, Saransh summaries, Praman (internal only).                                                   |
| UI passes after Phase 3       | Authenticity sweep (A71 to A73), workspace redesign (A74 to A78), platform interactions (A79 to A86): OKLCH tokens, command palette, view transitions, tooltips, WebGL hero, React Compiler.      |
| Skeleton                      | CI (`.github/workflows/ci.yml`), Dependabot, Dockerfiles for the API and web, compose `app` profile, secret scan, `.nvmrc` and `.python-version`, Saransh clause-analysis contract behind a flag. |

Last verified on this machine: `pnpm lint` (ESLint, design guard, tsc, ruff, mypy), `pnpm test` (120 web unit + 81
API tests), `pnpm e2e` (74 Playwright tests on the offline build, 4 skipped by design), both Docker images build and
answer their health checks, `pnpm secrets:check` clean.

## Resume on a new machine

Prerequisites: Git, Node 22.12+ (`.nvmrc`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10`),
[uv](https://docs.astral.sh/uv/) (installs Python 3.12 from `.python-version`), Docker (only for the local Postgres
and Redis stand-ins or the images).

```sh
git clone <your repo URL> nyay.ai && cd nyay.ai
cp .env.example .env                 # fill JWT_SECRET and VISITOR_COOKIE_SECRET; the rest has working defaults
pnpm install
uv sync --directory services/api
pnpm --filter @nyay/web exec playwright install chromium

# Offline demo, no database needed:
pnpm build:mock && pnpm start        # http://localhost:3000, OTP 000000

# Full stack with local stand-ins (Postgres :55432, Redis :56379):
pnpm infra:up
pnpm migrate && pnpm seed
pnpm dev                             # API :8100 + worker + web :3000
```

Then confirm everything is green before changing anything: `pnpm lint && pnpm test && pnpm e2e`.

`.env` is never committed. Bring keys across by hand (password manager), or regenerate the two secrets with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`. With no provider keys set, OTP, payments, LLM,
embeddings and OCR all run on offline fakes.

Visual regression baselines are per operating system and are not committed: run `pnpm test:visual:update` once on the
new machine, then `pnpm test:visual` after UI changes.

## Decisions already made (do not re-open without the owner)

- **Hosting budget:** Upstash Redis free tier (10,000 requests a day). Billing wakes every 60 s and costs one Redis
  request per live session-minute; an idle system makes none (A59, A60, A62).
- **Billing:** prepaid per minute, minutes billed ahead, early endings prorated to the second.
- **Models:** Gemini `gemini-1.5-flash` and `text-embedding-004` (768 dims), Groq `llama-3.1-8b-instant` as fallback.
  Google retires model names; `.env.example` says what to switch to.
- **OTP:** mocked (`000000`) until an SMS provider is chosen.
- **Names:** Parakh (matching), Samvaad (consultation room), Saransh (document summaries and the analyser at
  `/saransh`), Praman (advocate TrustScore, internal only: never in any user-facing response or screen, enforced by
  `tests/test_public_schema.py` and `check-design`).
- **Design rules:** flat colour from tokens, 8 px controls, no pills, no emoji or em dashes, no hype or invented
  proof, still pages with motion only where it explains something; enforced by `apps/web/scripts/check-design.mjs`.
  The deliberate exceptions are listed in A76 to A86.
- **Portability:** stateless code; all configuration in the one repo-root `.env`.

## Waiting on a human (`TODO(human)` in the code)

Legal and compliance:

- Terms and privacy text need counsel review, the operating entity, and the Grievance Officer details
  (`apps/web/lib/legal/terms.ts`, `privacy.ts`, `app/[locale]/legal/[doc]/page.tsx`).
- Policy version strings for chat storage, document processing and privacy consents.
- Retention of financial records versus DPDP erasure (`services/api/app/modules/users/router.py`).
- Every Bare Act excerpt in `apps/web/lib/legal/bare-acts.ts` must be checked word for word against India Code.
- Allahabad High Court principal seat versus Lucknow Bench territorial split (`lib/api/mock/fixtures.ts`).
- Saransh clause rules (`services/api/app/modules/saransh/clauses.py`) need an advocate's review before
  `SARANSH_CLAUSES_ENABLED=true`.

Money:

- Platform fee, GST treatment and rounding, reserve cap, advocate rate range (A20, A21).
- Advocate payouts (schedule, TDS, bank details) are not built.

Providers and data:

- SMS OTP provider; audio calls provider (LiveKit is wired behind `ENABLE_CALLS=false`).
- Real news feed URLs in `services/api/config/news_sources.yaml`, and an image licence before showing publisher art.
- Praman live sources need a licensed, ToS-compliant agreement (`PRAMAN_LIVE_SOURCES=false` until then).
- Praman weights, k values and half-life are placeholders (A64).
- Verify the current Gemini and Groq model names.

## Suggested next steps

1. Sign off Gates 2 and 3 (screenshots in `docs/screenshots/`; `pnpm ledger:check`, `pnpm load:billing`).
2. Wire the document analyser at `/saransh` to the real upload and to
   `GET /v1/saransh/documents/{id}/clauses` (the contract and tests exist; the UI still uses `lib/saransh/sample.ts`).
   Render the person's own PDF (pdf.js) and highlight clauses by the returned offsets.
3. Choose and integrate an SMS OTP provider; switch `OTP_PROVIDER`.
4. Razorpay live keys and webhook (`PAYMENT_PROVIDER=razorpay`); the fake already exercises the same ledger path.
5. Deploy: the API image to any container host with `WS_FANOUT=local` (one instance), the web image or Vercel for
   `apps/web`, Supabase Postgres and Upstash Redis. Run `alembic upgrade head` with the same image before each release.
6. Turn on the Dependabot pull requests and keep CI green.
7. Real news pictures (optional, after real feeds are enabled and their terms are read): add `image_url` and `image_credit`
   columns to `news_items`; in `ingest.py::_entries` read the feed's own `media:content`, `media:thumbnail` or image
   `enclosure` (never scrape pages); opt in per source with `images: true` in `news_sources.yaml`; show the picture
   with the publisher name as credit, hotlinked and not copied; allow only those publishers' image hosts in the
   `img-src` CSP in `next.config.ts`; keep `MeshArt` as the fallback for every story without a picture. Not before the
   publisher's terms allow it.

## Where to look

To learn how the system works (ledger, billing, matching, realtime, frontend, with worked numbers and exercises),
read [`STUDY_GUIDE.md`](STUDY_GUIDE.md).

| Need                           | File                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Why something is the way it is | `docs/ASSUMPTIONS.md` (A1 onwards, newest at the bottom)                        |
| How the system fits together   | `docs/ARCHITECTURE.md` (money flow, Samvaad end to end, Redis budget, runbooks) |
| What was built, phase by phase | `docs/PLAN.md`                                                                  |
| Every setting                  | `.env.example`                                                                  |
| Every command                  | root `package.json` scripts (or `make help`)                                    |
