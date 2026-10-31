"""RSS/Atom ingestion (arq job every NEWS_REFRESH_MINUTES). Polite by construction: robots.txt, conditional GETs,
a per-source minimum interval, and only title + short publisher excerpt + link are stored (never full text)."""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import feedparser
import httpx
import yaml
from redis.asyncio import Redis
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.enums import NewsCategory
from app.db.models.tables import NewsItem
from app.db.tx import transaction

from .service import canonical_url, invalidate_cache, truncate_excerpt, url_hash

log = get_logger("news.ingest")

SOURCES_FILE = Path(__file__).resolve().parents[3] / "config" / "news_sources.yaml"
_TAGS = re.compile(r"<[^>]+>")


@dataclass(frozen=True, slots=True)
class Source:
    name: str
    url: str
    category: NewsCategory
    enabled: bool
    min_interval_minutes: int


def load_sources(path: Path = SOURCES_FILE) -> list[Source]:
    data: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    sources = []
    for raw in data.get("sources", []):
        url = str(raw.get("url", ""))
        enabled = bool(raw.get("enabled")) and url.startswith(("http://", "https://"))
        sources.append(
            Source(
                name=str(raw["name"]),
                url=url,
                category=NewsCategory(raw["category"]),
                enabled=enabled,
                min_interval_minutes=int(raw.get("min_interval_minutes", 60)),
            )
        )
    return sources


async def _robots_allows(http: httpx.AsyncClient, url: str, agent: str) -> bool:
    parts = urlsplit(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        response = await http.get(robots_url, timeout=10, headers={"User-Agent": agent})
    except httpx.HTTPError:
        return False
    if response.status_code >= 500:
        return False
    parser = RobotFileParser()
    parser.parse(response.text.splitlines() if response.status_code == 200 else [])
    return parser.can_fetch(agent, url)


def _entries(body: bytes, source: Source) -> list[dict[str, Any]]:
    parsed = feedparser.parse(body)
    rows = []
    for entry in parsed.entries:
        link = entry.get("link")
        title = " ".join(str(entry.get("title", "")).split())
        if not link or not title:
            continue
        stamp = entry.get("published_parsed") or entry.get("updated_parsed")
        published = datetime.fromtimestamp(calendar.timegm(stamp), UTC) if stamp else datetime.now(UTC)
        summary = _TAGS.sub(" ", str(entry.get("summary", "")))
        rows.append(
            {
                "source": source.name[:96],
                "title": title[:400],
                "excerpt": truncate_excerpt(summary),
                "canonical_url": canonical_url(str(link))[:1024],
                "url_hash": url_hash(str(link)),
                "category": source.category,
                "published_at": published,
            }
        )
    return rows


async def ingest_source(
    source: Source, *, http: httpx.AsyncClient, redis: Redis, db: AsyncSession, agent: str
) -> int:
    state = f"news:src:{url_hash(source.url)[:16]}"
    if not await redis.set(f"{state}:lock", "1", ex=source.min_interval_minutes * 60, nx=True):
        return 0  # fetched recently: respect the per-source interval
    if not await _robots_allows(http, source.url, agent):
        log.info("news.robots_disallow", source=source.name)
        return 0
    headers = {"User-Agent": agent}
    if etag := await redis.get(f"{state}:etag"):
        headers["If-None-Match"] = etag
    if modified := await redis.get(f"{state}:modified"):
        headers["If-Modified-Since"] = modified
    try:
        response = await http.get(source.url, headers=headers, timeout=15)
    except httpx.HTTPError as exc:
        log.warning("news.fetch_failed", source=source.name, error=type(exc).__name__)
        return 0
    if response.status_code == 304 or response.status_code != 200:
        return 0
    if response.headers.get("etag"):
        await redis.set(f"{state}:etag", response.headers["etag"], ex=7 * 86_400)
    if response.headers.get("last-modified"):
        await redis.set(f"{state}:modified", response.headers["last-modified"], ex=7 * 86_400)
    rows = _entries(response.content, source)
    if not rows:
        return 0
    async with transaction(db):
        result = await db.execute(
            insert(NewsItem)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["url_hash"])
            .returning(NewsItem.id)
        )
        inserted = len(result.all())
    return inserted


async def ingest_all(*, http: httpx.AsyncClient, redis: Redis, db: AsyncSession, agent: str) -> int:
    total = 0
    for source in load_sources():
        if source.enabled:
            total += await ingest_source(source, http=http, redis=redis, db=db, agent=agent)
    if total:
        await invalidate_cache(redis)
    log.info("news.ingested", inserted=total)
    return total
