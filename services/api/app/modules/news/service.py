"""Legal updates feed: keyset pagination, Redis cache (TTL NEWS_CACHE_TTL_SECONDS), link-out only."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.schemas import ApiModel
from app.db.models.enums import NewsCategory
from app.db.models.tables import NewsItem

log = get_logger("news")

CategoryLit = Literal["supreme_court", "allahabad_hc", "delhi_hc", "legislation"]
MAX_LIMIT = 50
EXCERPT_MAX = 200


class NewsItemOut(ApiModel):
    id: uuid.UUID
    source: str
    title: str
    excerpt: str
    canonical_url: str
    category: CategoryLit
    published_at: datetime
    image_url: str | None = None


class NewsPage(ApiModel):
    items: list[NewsItemOut]
    next_cursor: str | None


def canonical_url(url: str) -> str:
    """Drop fragments and tracking parameters so the same story dedupes to one row."""
    parts = urlsplit(url.strip())
    query = [
        (k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith(("utm_", "fbclid", "gclid"))
    ]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, urlencode(query), ""))


def url_hash(url: str) -> str:
    return hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()


def truncate_excerpt(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= EXCERPT_MAX else text[: EXCERPT_MAX - 1].rstrip() + "…"


def _encode_cursor(item: NewsItem) -> str:
    raw = f"{item.published_at.isoformat()}|{item.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        stamp, ident = raw.split("|", 1)
        return datetime.fromisoformat(stamp), uuid.UUID(ident)
    except (ValueError, UnicodeDecodeError) as exc:
        raise AppError("invalid_request", 400, "Invalid cursor.") from exc


def cache_key(category: str | None, limit: int, cursor: str | None) -> str:
    return f"news:feed:{category or 'all'}:{limit}:{cursor or '-'}"


async def list_news(
    db: AsyncSession, redis: Redis, *, category: CategoryLit | None, limit: int, cursor: str | None, ttl: int
) -> NewsPage:
    limit = max(1, min(limit, MAX_LIMIT))
    key = cache_key(category, limit, cursor)
    try:
        cached = await redis.get(key)
        if cached:
            return NewsPage.model_validate_json(cached)
    except RedisError:
        log.warning("news.cache_unavailable")

    stmt = select(NewsItem).order_by(NewsItem.published_at.desc(), NewsItem.id.desc()).limit(limit + 1)
    if category:
        stmt = stmt.where(NewsItem.category == NewsCategory(category))
    if cursor:
        published, ident = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                NewsItem.published_at < published,
                and_(NewsItem.published_at == published, NewsItem.id < ident),
            )
        )
    rows = list((await db.scalars(stmt)).all())
    page = NewsPage(
        items=[
            NewsItemOut(
                id=row.id,
                source=row.source,
                title=row.title,
                excerpt=row.excerpt,
                canonical_url=row.canonical_url,
                category=row.category.value,
                published_at=row.published_at,
            )
            for row in rows[:limit]
        ],
        next_cursor=_encode_cursor(rows[limit - 1]) if len(rows) > limit else None,
    )
    with contextlib.suppress(RedisError):
        await redis.set(key, page.model_dump_json(), ex=ttl)
    return page


async def invalidate_cache(redis: Redis) -> None:
    async for key in redis.scan_iter(match="news:feed:*", count=200):
        await redis.delete(key)


def dumps_page(page: NewsPage) -> str:
    return json.dumps(page.model_dump(mode="json"))
