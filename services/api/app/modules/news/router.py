from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import DbDep, ProvidersDep

from .service import CategoryLit, NewsPage, list_news

router = APIRouter(prefix="/v1/news", tags=["news"])


@router.get("", response_model=NewsPage)
async def news(
    providers: ProvidersDep,
    db: DbDep,
    category: CategoryLit | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 7,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> NewsPage:
    return await list_news(
        db,
        providers.redis,
        category=category,
        limit=limit,
        cursor=cursor,
        ttl=providers.settings.news_cache_ttl_seconds,
    )
