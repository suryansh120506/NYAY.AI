from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import Role, UserStatus
from app.db.models.tables import User

from .errors import AppError
from .providers import Providers
from .security import decode_access_token, new_visitor_cookie, read_visitor_cookie

VISITOR_COOKIE = "nyay_vid"
_bearer = HTTPBearer(auto_error=False)


def get_providers(request: Request) -> Providers:
    providers: Providers = request.app.state.providers
    return providers


ProvidersDep = Annotated[Providers, Depends(get_providers)]


async def get_db(providers: ProvidersDep) -> AsyncIterator[AsyncSession]:
    async with providers.sessions() as session:
        yield session


DbDep = Annotated[AsyncSession, Depends(get_db)]


async def optional_user(
    providers: ProvidersDep,
    db: DbDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    if credentials is None:
        return None
    claims = decode_access_token(providers.settings, credentials.credentials)
    if claims is None:
        raise AppError("unauthorized", 401, "Your session has expired. Please sign in again.")
    user = await db.scalar(select(User).where(User.id == claims.user_id))
    # End the implicit read transaction so handlers start clean (objects stay loaded: expire_on_commit=False).
    await db.commit()
    if user is None or user.status == UserStatus.SUSPENDED:
        raise AppError("unauthorized", 401)
    return user


async def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise AppError("unauthorized", 401, "Please sign in.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
OptionalUser = Annotated[User | None, Depends(optional_user)]


def require_role(*roles: Role) -> Callable[[User], Awaitable[User]]:
    async def check(user: CurrentUser) -> User:
        if user.role not in roles:
            raise AppError("forbidden", 403)
        return user

    return check


@dataclass(frozen=True, slots=True)
class Actor:
    """Who is asking: a signed-in user, or an anonymous visitor (allowed only on POST /v1/parakh/match)."""

    user: User | None
    visitor_id: str | None

    @property
    def key(self) -> str:
        return f"u:{self.user.id}" if self.user else f"v:{self.visitor_id}"

    @property
    def user_id(self) -> uuid.UUID | None:
        return self.user.id if self.user else None


async def actor(request: Request, response: Response, providers: ProvidersDep, user: OptionalUser) -> Actor:
    if user is not None:
        return Actor(user=user, visitor_id=None)
    settings = providers.settings
    visitor_id = read_visitor_cookie(settings, request.cookies.get(VISITOR_COOKIE))
    if visitor_id is None:
        visitor_id, cookie = new_visitor_cookie(settings)
        response.set_cookie(
            VISITOR_COOKIE,
            cookie,
            max_age=365 * 86_400,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            domain=settings.cookie_domain or None,
            path="/v1/parakh",
        )
    return Actor(user=None, visitor_id=visitor_id)


ActorDep = Annotated[Actor, Depends(actor)]


def client_ip(request: Request) -> str:
    # Behind a proxy, configure it to set X-Forwarded-For and run uvicorn with --proxy-headers.
    return request.client.host if request.client else "unknown"
