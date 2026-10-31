from __future__ import annotations

import httpx
import pytest
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.enums import NewsCategory
from app.db.session import _connect_args
from app.modules.news.ingest import Source, ingest_source, load_sources
from app.modules.news.service import canonical_url, truncate_excerpt, url_hash


async def test_feed_paginates_with_a_cursor(api: httpx.AsyncClient) -> None:
    first = (await api.get("/v1/news", params={"limit": 7})).json()
    assert len(first["items"]) == 7 and first["next_cursor"]
    second = (await api.get("/v1/news", params={"limit": 7, "cursor": first["next_cursor"]})).json()
    assert not {i["id"] for i in first["items"]} & {i["id"] for i in second["items"]}
    stamps = [i["published_at"] for i in first["items"] + second["items"]]
    assert stamps == sorted(stamps, reverse=True)


async def test_feed_filters_by_category_and_never_returns_long_excerpts(api: httpx.AsyncClient) -> None:
    body = (await api.get("/v1/news", params={"category": "delhi_hc", "limit": 50})).json()
    assert body["items"] and all(i["category"] == "delhi_hc" for i in body["items"])
    assert all(len(i["excerpt"]) <= 200 for i in body["items"])


def test_url_canonicalisation_and_excerpts() -> None:
    a = "https://Example.com/story?id=1&utm_source=x#top"
    assert canonical_url(a) == "https://example.com/story?id=1"
    assert url_hash(a) == url_hash("https://example.com/story?id=1")
    assert len(truncate_excerpt("word " * 100)) == 200


def test_shipped_sources_are_all_disabled_until_a_human_fills_them_in() -> None:
    sources = load_sources()
    assert sources and not any(s.enabled for s in sources)


FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Demo item one</title><link>https://example.org/a?utm_medium=rss</link>
<description>&lt;p&gt;Short excerpt&lt;/p&gt;</description><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""


async def test_ingest_respects_robots_etag_and_dedupes(db: AsyncSession) -> None:
    from .api_harness import flushable_redis as get_redis

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /")
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=FEED, headers={"etag": '"v1"'})

    redis: Redis = get_redis()
    source = Source(
        name="Demo feed",
        url="https://example.org/feed.xml",
        category=NewsCategory.LEGISLATION,
        enabled=True,
        min_interval_minutes=1,
    )
    async for key in redis.scan_iter(match="news:src:*"):
        await redis.delete(key)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        first = await ingest_source(source, http=http, redis=redis, db=db, agent="test")
        assert first in (0, 1)  # 0 if a previous run already stored this URL
        async for key in redis.scan_iter(match="news:src:*:lock"):
            await redis.delete(key)
        again = await ingest_source(source, http=http, redis=redis, db=db, agent="test")
    assert again == 0  # conditional GET → 304
    assert calls.count("/robots.txt") == 2


async def test_robots_disallow_blocks_fetching(db: AsyncSession) -> None:
    from .api_harness import flushable_redis as get_redis

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /")
        raise AssertionError("feed must not be fetched")

    redis = get_redis()
    source = Source(
        name="Blocked",
        url="https://blocked.example.org/feed.xml",
        category=NewsCategory.LEGISLATION,
        enabled=True,
        min_interval_minutes=1,
    )
    async for key in redis.scan_iter(match="news:src:*"):
        await redis.delete(key)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        assert await ingest_source(source, http=http, redis=redis, db=db, agent="test") == 0


# --------------------------------------------------------------------------------------------- portability
def test_plain_postgres_urls_are_accepted() -> None:
    s = Settings(_env_file=None, database_url="postgres://u:p@db.example.supabase.co:5432/postgres")  # type: ignore[call-arg]
    assert s.database_url.startswith("postgresql+asyncpg://")


@pytest.mark.parametrize(
    ("url", "pooled"),
    [
        ("postgresql+asyncpg://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", True),
        ("postgresql+asyncpg://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres", True),
        ("postgresql+asyncpg://u:p@localhost:55432/nyay", False),
    ],
)
def test_supabase_pooler_disables_prepared_statements(url: str, pooled: bool) -> None:
    assert ("statement_cache_size" in _connect_args(url)) is pooled


def test_missing_configuration_is_reported_by_name() -> None:
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    missing = s.missing_required()
    for name in ("DATABASE_URL", "REDIS_URL", "JWT_SECRET", "VISITOR_COOKIE_SECRET"):
        assert name in missing
    s = Settings(_env_file=None, llm_provider="gemini")  # type: ignore[call-arg]
    assert "GEMINI_API_KEY" in s.missing_required()
