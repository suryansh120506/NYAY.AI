# Nyay.ai web image (Next.js standalone server). Build context: the REPOSITORY ROOT (pnpm workspace).
#   docker build -f apps/web/Dockerfile -t nyay-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.in --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.in \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://example.in .
#   docker run -p 3000:3000 nyay-web
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build arguments, not runtime env.
# NEXT_PUBLIC_USE_MOCKS=true builds the fully offline demo (no API needed).

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @nyay/web...

FROM base AS build
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WS_URL=""
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID=""
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_USE_MOCKS="false"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=$NEXT_PUBLIC_RAZORPAY_KEY_ID \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_USE_MOCKS=$NEXT_PUBLIC_USE_MOCKS \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @nyay/web build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S nyay && adduser -S -G nyay -u 10001 nyay
COPY --from=build --chown=nyay:nyay /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nyay:nyay /repo/apps/web/.next/static ./apps/web/.next/static
USER nyay
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
