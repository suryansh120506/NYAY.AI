"""Explicit write transactions on request-scoped sessions.

SQLAlchemy autobegins a transaction on the first read (e.g. the auth dependency loading the user), and
`session.begin()` refuses to start inside it. `transaction()` closes that implicit read-only transaction first, so
every write runs in one explicit, atomic transaction. Row locks (FOR UPDATE) are always taken inside it.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession


@asynccontextmanager
async def transaction(db: AsyncSession) -> AsyncIterator[AsyncSession]:
    if db.in_transaction():
        await db.commit()
    async with db.begin():
        yield db
