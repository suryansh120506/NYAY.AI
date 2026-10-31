# Nyay.ai developer entry points. Every target mirrors a root `pnpm` script (Windows has no make: use `pnpm <name>`).
# All configuration comes from the repo-root .env (copy .env.example). Nothing here hard-codes a host or path.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-web dev-api worker infra-up infra-down migrate seed reset-db build build-mock \
        test test-web test-api e2e e2e-api lint typecheck ledger-check load-billing gen-api bundle format

help: ## List targets
	@grep -E '^[a-z][a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Install JS + Python dependencies and the Playwright browser
	pnpm install
	uv sync --directory services/api
	pnpm --filter @nyay/web exec playwright install chromium

dev: ## API + worker + web together (needs .env with DATABASE_URL and REDIS_URL)
	pnpm dev

dev-web: ## Web app only
	pnpm dev:web

dev-api: ## API only (auto-reload)
	pnpm dev:api

worker: ## Background jobs (news ingestion, re-indexing, bonus expiry, nightly ledger check)
	pnpm worker

infra-up: ## OPTIONAL local stand-ins for Supabase/Upstash (Postgres+pgvector :55432, Redis :56379)
	pnpm infra:up

infra-down: ## Stop the local stand-ins
	pnpm infra:down

migrate: ## Apply database migrations (uses DATABASE_DIRECT_URL, else DATABASE_URL)
	pnpm migrate

seed: ## Demo data: courts, 40 "Demo" advocates, demo users, news (ENV=dev only)
	pnpm seed

reset-db: ## Drop and rebuild the DEV schema (refuses non-local hosts)
	pnpm db:reset

build: ## Production build of the web app (mode from NEXT_PUBLIC_USE_MOCKS)
	pnpm build

build-mock: ## Web build that runs fully offline on in-browser mocks
	pnpm build:mock

test: ## Unit tests: web (Vitest) + API (pytest: ledger property tests, auth, Parakh, payments, news)
	pnpm test

test-web: ## Web unit tests
	pnpm test:web

test-api: ## API tests (needs TEST_DATABASE_URL + REDIS_URL)
	pnpm test:api

e2e: ## Playwright suite on the offline build
	pnpm e2e

e2e-api: ## Playwright @api test against a real-API build (API running, DB seeded)
	pnpm e2e:api

lint: ## ESLint + design guardrails + tsc + ruff + mypy
	pnpm lint

typecheck: ## TypeScript only
	pnpm typecheck

ledger-check: ## Gate 2: end-to-end top-up through the running API, prints `ledger imbalance: 0`
	pnpm ledger:check

load-billing: ## 500 live sessions x 10 simulated minutes on the TEST database and local test Redis
	pnpm load:billing

gen-api: ## Regenerate the frontend's API types from the FastAPI OpenAPI schema
	pnpm gen:api

bundle: ## Zip the repo for another machine (never includes .env, deps or build output)
	pnpm bundle

format: ## Prettier write
	pnpm format
