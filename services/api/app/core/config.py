"""Runtime configuration. Every value comes from the environment (or a `.env` file); nothing is hard-coded.

Lookup order (later wins): repo-root `.env`, `services/api/.env`, real environment variables. Both paths are derived
from this file's location, so the code works wherever the repository is unpacked.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_SERVICE_DIR = Path(__file__).resolve().parents[2]
# Inside the Docker image the service sits at /app with no repository around it; env vars are the only source there.
_REPO_DIR = _SERVICE_DIR.parents[1] if len(_SERVICE_DIR.parents) > 1 else _SERVICE_DIR

Env = Literal["dev", "test", "staging", "prod"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_DIR / ".env", _SERVICE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------------------------------ runtime
    env: Env = "dev"
    log_level: str = "INFO"
    web_origin: str = "http://localhost:3000"
    api_public_url: str = "http://localhost:8100"

    # ------------------------------------------------------------------------------------------ data
    # Postgres (Supabase in production). Use the pooled URL here; asyncpg statement caching is disabled
    # automatically for Supabase's transaction pooler.
    database_url: str = Field(default="", description="postgresql+asyncpg://… (pooled)")
    # Direct (session-mode) connection for Alembic migrations. Defaults to DATABASE_URL.
    database_direct_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    # Redis (Upstash in production: rediss://default:<token>@<host>:6379).
    redis_url: str = ""
    # Only for the test suite; must point at a database whose name contains "test".
    test_database_url: str = ""
    # Only for the test suite: a Redis the tests may flush (never your Upstash instance).
    test_redis_url: str = ""

    # ------------------------------------------------------------------------------------------ auth
    jwt_secret: SecretStr = SecretStr("")
    visitor_cookie_secret: SecretStr = SecretStr("")
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_days: int = 30
    cookie_secure: bool = True
    cookie_domain: str | None = None
    otp_provider: Literal["fake"] = "fake"
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5

    # ------------------------------------------------------------------------------------------ payments
    payment_provider: Literal["fake", "razorpay"] = "fake"
    razorpay_key_id: str = ""
    razorpay_key_secret: SecretStr = SecretStr("")
    razorpay_webhook_secret: SecretStr = SecretStr("")
    razorpay_base_url: str = "https://api.razorpay.com"

    # ------------------------------------------------------------------------------------------ AI
    llm_provider: Literal["fake", "gemini", "groq"] = "fake"
    llm_fallback_provider: Literal["none", "fake", "gemini", "groq"] = "none"
    llm_timeout_seconds: float = 3.0
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-1.5-flash"
    gemini_embedding_model: str = "text-embedding-004"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    groq_api_key: SecretStr = SecretStr("")
    groq_model: str = "llama-3.1-8b-instant"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    embeddings_provider: Literal["fake", "gemini"] = "fake"
    # Fixed per vector table; changing it needs a new table + re-index (brief §2.4).
    embedding_dim: int = 768
    vector_store: Literal["memory", "pgvector"] = "pgvector"

    # ------------------------------------------------------------------------------------------ money (paise)
    # TODO(human): confirm fee, GST treatment and reserve cap (docs/ASSUMPTIONS.md A20, A21).
    platform_fee_paise_per_min: int = 500
    gst_rate_bps: int = 1800
    reserve_cap_paise: int = 200_000
    min_topup_paise: int = 10_000
    reserve_minutes: int = 5
    # Bounds an advocate may set for their own per-minute rate. TODO(human): confirm the allowed range.
    advocate_min_rate_paise: int = 500
    advocate_max_rate_paise: int = 100_000

    # ------------------------------------------------------------------------------------------ billing (Upstash-frugal)
    # The billing and settlement workers wake once per BILLING_POLL_SECONDS (owner: Upstash free tier, 10k req/day).
    # Each wake-up bills every minute that starts before the next wake-up (+ lead), so minutes stay prepaid.
    billing_poll_seconds: int = 60
    billing_lead_seconds: int = 15
    heartbeat_timeout_seconds: int = 30
    reservation_ttl_minutes: int = 10
    # "local": chat fan-out in-process (one API instance, fewest Redis requests); "redis": Pub/Sub across instances.
    # Worker → gateway events (ticks, warnings, termination) always use Pub/Sub.
    ws_fanout: Literal["local", "redis"] = "local"
    # Where the billing engine runs: inside the API (default, single instance) or in `pnpm worker`
    # (then WS_FANOUT must be "redis" so ticks reach the sockets).
    billing_runner: Literal["api", "worker"] = "api"

    # ------------------------------------------------------------------------------------------ product
    retention_days: int = 30
    news_cache_ttl_seconds: int = 300
    news_refresh_minutes: int = 15
    news_user_agent: str = "NyayBot/0.1 (+https://nyay.ai/bot)"
    parakh_weight_semantic: float = 0.60
    parakh_weight_trust: float = 0.25
    parakh_weight_availability: float = 0.10
    parakh_weight_price: float = 0.05

    # Rate limits: "<count>/<seconds>"
    rate_limit_otp: str = "5/600"
    rate_limit_match: str = "30/60"
    rate_limit_topup: str = "10/60"
    rate_limit_upload: str = "10/3600"
    rate_limit_ws: str = "30/60"
    # Every other public route: per-instance memory limiter (no Redis requests).
    rate_limit_default: str = "120/60"

    # ------------------------------------------------------------------------------------------ saransh
    storage_provider: Literal["postgres", "s3"] = "postgres"
    s3_endpoint: str = ""
    s3_region: str = "ap-south-1"
    s3_bucket: str = ""
    s3_access_key: SecretStr = SecretStr("")
    s3_secret_key: SecretStr = SecretStr("")
    ocr_provider: Literal["fake", "gemini"] = "fake"
    saransh_daily_cap: int = 5
    saransh_max_bytes: int = 10 * 1024 * 1024
    saransh_max_pages: int = 8
    ocr_min_confidence: int = 60
    # Phase 2: clause-level risk analysis (app/modules/saransh/clauses.py). Off until an advocate reviews the rules.
    saransh_clauses_enabled: bool = False

    # ------------------------------------------------------------------------------------------ calls
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: SecretStr = SecretStr("")

    # ------------------------------------------------------------------------------------------ observability
    metrics_enabled: bool = True
    # Optional bearer token for GET /metrics (set it whenever the API is reachable from the internet).
    metrics_token: SecretStr = SecretStr("")

    enable_calls: bool = False
    praman_live_sources: bool = False

    # ------------------------------------------------------------------------------------------ derived
    @field_validator("database_url", "database_direct_url", "test_database_url")
    @classmethod
    def _async_driver(cls, value: str) -> str:
        """Accept plain postgres:// URLs (as Supabase shows them) and use the asyncpg driver."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    @computed_field  # type: ignore[prop-decorator]
    @property
    def migrations_url(self) -> str:
        return self.database_direct_url or self.database_url

    @property
    def is_dev(self) -> bool:
        return self.env in ("dev", "test")

    def missing_required(self) -> list[str]:
        """Names of required settings that are empty; the app refuses to start without them."""
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if not self.redis_url:
            missing.append("REDIS_URL")
        if not self.jwt_secret.get_secret_value():
            missing.append("JWT_SECRET")
        if not self.visitor_cookie_secret.get_secret_value():
            missing.append("VISITOR_COOKIE_SECRET")
        if self.payment_provider == "razorpay" and not self.razorpay_webhook_secret.get_secret_value():
            missing.append("RAZORPAY_WEBHOOK_SECRET")
        if "gemini" in (self.llm_provider, self.llm_fallback_provider, self.embeddings_provider) and not (
            self.gemini_api_key.get_secret_value()
        ):
            missing.append("GEMINI_API_KEY")
        if self.storage_provider == "s3" and not (self.s3_bucket and self.s3_access_key.get_secret_value()):
            missing.append("S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY")
        if self.ocr_provider == "gemini" and not self.gemini_api_key.get_secret_value():
            missing.append("GEMINI_API_KEY (OCR_PROVIDER=gemini)")
        if self.billing_runner == "worker" and self.ws_fanout != "redis":
            missing.append("WS_FANOUT=redis (required when BILLING_RUNNER=worker)")
        if self.enable_calls and not (self.livekit_url and self.livekit_api_key):
            missing.append("LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET")
        if (
            "groq" in (self.llm_provider, self.llm_fallback_provider)
            and not self.groq_api_key.get_secret_value()
        ):
            missing.append("GROQ_API_KEY")
        if not self.is_dev and self.otp_provider == "fake":
            missing.append("a real OTP_PROVIDER (the fake is dev-only)")
        if not self.is_dev and self.payment_provider == "fake":
            missing.append("PAYMENT_PROVIDER=razorpay (the fake is dev-only)")
        return missing


@lru_cache
def get_settings() -> Settings:
    return Settings()
