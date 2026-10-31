# Nyay.ai

Pay-per-minute legal consultation marketplace for Uttar Pradesh and Delhi. Describe a problem in Hindi, English or
Hinglish, get matched to a verified advocate, and consult over chat while a prepaid wallet is debited per minute.

**Status:** Phase 3 complete: real-time consultations over WebSockets with per-minute prepaid billing (one Redis
request per live minute, prorated to the second at the end), the advocate's desk, document summaries (Saransh) and
the internal TrustScore (Praman), plus CI, Docker images and a phase 2 handoff. **Resuming on another machine? Start
with [`docs/HANDOFF.md`](docs/HANDOFF.md); to learn how it all works, read [`docs/STUDY_GUIDE.md`](docs/STUDY_GUIDE.md).** See also [`docs/PLAN.md`](docs/PLAN.md),
[`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

The code is stateless and portable: every connection string, key and URL comes from **one `.env` file at the repo
root**. Nothing is stored on the machine itself.

## Set up on a new machine

You need Node 22.12+, pnpm 10 (`npm i -g pnpm@10`), [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for
you), and a Postgres + Redis (hosted or local, see below).

```sh
git clone <repo URL> nyay.ai && cd nyay.ai
cp .env.example .env            # then fill it in (next section)
pnpm install
uv sync --directory services/api
pnpm migrate                    # creates every table, trigger and the vector index
pnpm seed                       # demo data (ENV=dev only)
pnpm dev                        # API :8100 + background worker + web app :3000
```

Open http://localhost:3000. `make <target>` does the same on Linux/macOS (`make help` lists them).

## Configuration (`.env`)

`.env.example` explains every variable. The required ones:

| Variable                              | Where to get it                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | Supabase → Project Settings → Database → Connection string → **Transaction pooler** (port 6543) |
| `DATABASE_DIRECT_URL`                 | Same page → **Session pooler / Direct** (port 5432). Used only by migrations                    |
| `REDIS_URL`                           | Upstash → your database → Connect → the `rediss://default:…@….upstash.io:6379` URL              |
| `JWT_SECRET`, `VISITOR_COOKIE_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` (one each)                       |

Optional providers (offline fakes run when they are not set):

| Feature                                 | Variables                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| LLM intent extraction and premium "why" | `LLM_PROVIDER=gemini`, `LLM_FALLBACK_PROVIDER=groq`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`             |
| Semantic search                         | `EMBEDDINGS_PROVIDER=gemini`, `GEMINI_EMBEDDING_MODEL` (768 dimensions), then `pnpm seed` again to re-index                     |
| Payments                                | `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` |
| OCR for photos and scanned PDFs         | `OCR_PROVIDER=gemini` (uses `GEMINI_API_KEY` + `GEMINI_MODEL`)                                                                  |
| Document storage in a bucket            | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (e.g. Supabase Storage)        |
| Audio/video calls                       | `ENABLE_CALLS=true`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                                                     |

On Supabase, enable the **vector** extension once (Database → Extensions) if your project doesn't have it; the
migration then uses it. `NEXT_PUBLIC_*` values are baked into the web build, so rebuild after changing them.

**Upstash budget:** billing wakes once a minute and makes one Redis request per live consultation per minute; an
idle system makes none (details in `docs/ARCHITECTURE.md`). Run `pnpm worker` as well as the API for news,
retention clean-up, bonus expiry and the weekly TrustScore.

**No internet?** `pnpm infra:up` starts local stand-ins (Postgres with pgvector on :55432, Redis on :56379); the
default URLs in `.env.example` already point at them. The code doesn't know the difference.

**No backend at all?** Set `NEXT_PUBLIC_USE_MOCKS=true` and run `pnpm dev:web`: the web app runs entirely on
in-browser mocks.

## Commands

| Command                                         | What it does                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                      | API + worker + web together                                                                                                                        |
| `pnpm dev:web` / `pnpm dev:api` / `pnpm worker` | One process each                                                                                                                                   |
| `pnpm migrate` / `pnpm seed` / `pnpm db:reset`  | Migrations, demo data, rebuild a **local dev** schema                                                                                              |
| `pnpm lint`                                     | ESLint, design guardrails, TypeScript, ruff, mypy                                                                                                  |
| `pnpm test`                                     | Web unit tests + API tests (needs `TEST_DATABASE_URL`, a database whose name contains "test", and `TEST_REDIS_URL`, a local Redis the tests flush) |
| `pnpm e2e`                                      | Playwright on the offline build                                                                                                                    |
| `pnpm e2e:api`                                  | Playwright against the real API (API running, database seeded)                                                                                     |
| `pnpm ledger:check`                             | End-to-end top-up through the running API, then prints `ledger imbalance: 0`                                                                       |
| `pnpm load:billing`                             | 500 live sessions × 10 simulated minutes on the test DB + test Redis: latency, drift, Redis requests                                               |
| `pnpm gen:api`                                  | Regenerate the web app's API types from the FastAPI schema                                                                                         |
| `pnpm bundle`                                   | Zip the repo for another machine (never includes `.env`, dependencies or build output)                                                             |
| `pnpm secrets:check`                            | Fail if anything git would commit looks like a credential, or is a real `.env` (also runs in CI)                                                   |
| `pnpm test:visual` / `pnpm test:visual:update`  | Opt-in pixel comparisons of key screens (baselines are per OS: create them once per machine)                                                       |
| `pnpm tokens:export`                            | Write the design tokens to `design/tokens.json` (W3C DTCG format, for Figma plugins)                                                               |

## Demo accounts (after `pnpm seed`, ENV=dev)

Sign in with code **000000**. `+91 90000 00001` … `00004` are regular users with ₹250, `+91 90000 09999` is
premium (adds "Why this advocate"), `+91 90000 00000` is an admin. The demo advocates sign in as
`+91 80000 00001` … `00040` (in `app/fixtures/advocates.json` order) and see their requests at `/advocate`: open a
consultation as a user in one browser and join it as the advocate in another. All 40 advocates are fictional ("Demo …",
`DEMO/` enrolment numbers) and news comes from "Demo" publishers on `example.com`.

## Moving to another machine

Through git (preferred): push, clone on the other machine, then follow **Set up on a new machine** and
[`docs/HANDOFF.md`](docs/HANDOFF.md). Run `pnpm secrets:check` before every push; CI runs it too. Without git:

```sh
pnpm bundle          # → dist/nyay-YYYYMMDD-HHMM.zip
```

Either way your `.env` never travels: copy your keys across separately (or re-create them from `.env.example`).

## Docker

```sh
docker compose -f infra/docker-compose.yml --profile app up --build   # Postgres, Redis, migrations, API :58100, web :53000
```

Or build the images on their own: `docker build -t nyay-api services/api` and
`docker build -f apps/web/Dockerfile -t nyay-web .` (from the repo root; `NEXT_PUBLIC_*` values are build arguments).
Both images read configuration only from environment variables, the same names as `.env.example`.

## Layout

```
apps/web/          Next.js 15 app (App Router, React 19, Tailwind v4, next-intl en/hi)
services/api/      FastAPI modular monolith: app/{core,db,ledger,modules,integrations,workers}, tests/, scripts/
infra/             docker-compose: Postgres and Redis stand-ins, plus the app profile
scripts/           dev runner, cross-platform env helper, bundler, secret scan
design/            generated design tokens (pnpm tokens:export)
docs/              handoff, study guide, plan, assumptions, architecture, gate screenshots
.github/           CI workflow and Dependabot
```
