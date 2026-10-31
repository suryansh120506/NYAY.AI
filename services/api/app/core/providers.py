"""Builds every external integration from settings (brief rule 5: interface + fake + real, chosen by env)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.integrations.embeddings.base import Embedder
from app.integrations.embeddings.fake import HashEmbedder
from app.integrations.embeddings.gemini import GeminiEmbedder
from app.integrations.llm.base import LlmProvider
from app.integrations.llm.chain import LlmChain
from app.integrations.llm.fake import FakeLlm
from app.integrations.llm.gemini import GeminiLlm
from app.integrations.llm.groq import GroqLlm
from app.integrations.ocr.providers import FakeOcr, GeminiOcr, OcrProvider
from app.integrations.otp.providers import FakeOtpProvider, OtpProvider
from app.integrations.payments.base import PaymentProvider
from app.integrations.payments.fake import FakePaymentProvider
from app.integrations.payments.razorpay import RazorpayProvider
from app.integrations.storage.providers import PostgresBlobStorage, S3Storage, StorageProvider
from app.integrations.vectorstore.base import VectorStore
from app.integrations.vectorstore.memory import MemoryVectorStore
from app.integrations.vectorstore.pgvector import PgVectorStore
from app.modules.samvaad.hub import SessionHub
from app.modules.samvaad.meter import now_ms

from .config import Settings

if TYPE_CHECKING:
    from app.modules.samvaad.service import SamvaadService


@dataclass
class Providers:
    settings: Settings
    http: httpx.AsyncClient
    redis: Redis
    sessions: async_sessionmaker[AsyncSession]
    llm: LlmChain
    embedder: Embedder
    vectors: VectorStore
    payments: PaymentProvider
    otp: OtpProvider
    storage: StorageProvider
    ocr: OcrProvider
    hub: SessionHub
    clock: Callable[[], int] = now_ms  # epoch ms; tests swap in a fake clock
    _samvaad: SamvaadService | None = field(default=None, repr=False)

    @property
    def samvaad(self) -> SamvaadService:
        if self._samvaad is None:
            from app.modules.samvaad.service import SamvaadService

            self._samvaad = SamvaadService(self)
        return self._samvaad

    async def aclose(self) -> None:
        if self._samvaad is not None:
            await self._samvaad.aclose()
        await self.hub.aclose()
        await self.http.aclose()


def _llm(name: str, settings: Settings, http: httpx.AsyncClient) -> LlmProvider:
    if name == "gemini":
        return GeminiLlm(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            base_url=settings.gemini_base_url,
            client=http,
        )
    if name == "groq":
        return GroqLlm(
            api_key=settings.groq_api_key.get_secret_value(),
            model=settings.groq_model,
            base_url=settings.groq_base_url,
            client=http,
        )
    return FakeLlm()


def build_providers(
    settings: Settings, *, redis: Redis, sessions: async_sessionmaker[AsyncSession]
) -> Providers:
    http = httpx.AsyncClient(headers={"User-Agent": "nyay-api"}, follow_redirects=False)
    chain: list[LlmProvider] = [_llm(settings.llm_provider, settings, http)]
    if settings.llm_fallback_provider not in ("none", settings.llm_provider):
        chain.append(_llm(settings.llm_fallback_provider, settings, http))

    embedder: Embedder
    if settings.embeddings_provider == "gemini":
        embedder = GeminiEmbedder(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_embedding_model,
            dim=settings.embedding_dim,
            base_url=settings.gemini_base_url,
            client=http,
        )
    else:
        embedder = HashEmbedder(settings.embedding_dim)

    vectors: VectorStore = (
        PgVectorStore(sessions) if settings.vector_store == "pgvector" else MemoryVectorStore()
    )

    payments: PaymentProvider
    if settings.payment_provider == "razorpay":
        payments = RazorpayProvider(
            key_id=settings.razorpay_key_id,
            key_secret=settings.razorpay_key_secret.get_secret_value(),
            webhook_secret=settings.razorpay_webhook_secret.get_secret_value(),
            base_url=settings.razorpay_base_url,
            client=http,
        )
    else:
        # The fake signs its simulated webhooks with a secret derived from JWT_SECRET; never used in prod.
        payments = FakePaymentProvider(webhook_secret="fake-" + settings.jwt_secret.get_secret_value()[:16])

    storage: StorageProvider
    if settings.storage_provider == "s3":
        storage = S3Storage(
            endpoint=settings.s3_endpoint,
            region=settings.s3_region,
            bucket=settings.s3_bucket,
            access_key=settings.s3_access_key.get_secret_value(),
            secret_key=settings.s3_secret_key.get_secret_value(),
            client=http,
        )
    else:
        storage = PostgresBlobStorage(sessions)
    ocr: OcrProvider = (
        GeminiOcr(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            base_url=settings.gemini_base_url,
            client=http,
        )
        if settings.ocr_provider == "gemini"
        else FakeOcr()
    )

    return Providers(
        settings=settings,
        http=http,
        redis=redis,
        sessions=sessions,
        llm=LlmChain(chain),
        embedder=embedder,
        vectors=vectors,
        payments=payments,
        otp=FakeOtpProvider(dev=settings.is_dev),
        storage=storage,
        ocr=ocr,
        hub=SessionHub(redis=redis, mode=settings.ws_fanout),
    )
