# Nyay.ai API image (FastAPI + the billing engine). Build context: services/api.
#   docker build -t nyay-api services/api
#   docker run --env-file .env -p 8100:8100 nyay-api
# Configuration comes only from environment variables (the same names as .env.example); no .env is baked in.
# The same image runs the background worker:  docker run --env-file .env nyay-api python -m app.workers.scheduler
# and migrations:                            docker run --env-file .env nyay-api alembic upgrade head

FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .

FROM python:3.12-slim
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --home /app nyay
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --from=build --chown=nyay /app /app
USER nyay
EXPOSE 8100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=2)" || exit 1
# One process: chat is delivered in-process (WS_FANOUT=local). Scale out only with WS_FANOUT=redis.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--proxy-headers", "--forwarded-allow-ips", "*"]
