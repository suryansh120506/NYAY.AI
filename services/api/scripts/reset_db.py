"""Drop and rebuild the DEV database schema from migrations (the ledger is append-only, so this is the only way to
start over). Refuses unless ENV=dev, and refuses hosted databases unless --yes-i-am-sure is given.

    uv run python -m scripts.reset_db && uv run python -m scripts.seed
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import make_engine


async def _drop(url: str) -> None:
    engine = make_engine(url, pool_size=1, max_overflow=0)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


def main() -> int:
    settings = get_settings()
    url = settings.migrations_url
    host = urlparse(url.replace("+asyncpg", "")).hostname or ""
    if settings.env != "dev":
        print("Refusing: ENV must be dev.", file=sys.stderr)
        return 2
    if host not in ("localhost", "127.0.0.1", "::1") and "--yes-i-am-sure" not in sys.argv:
        print(
            f"Refusing to wipe a non-local database ({host}). Pass --yes-i-am-sure if you really mean it.",
            file=sys.stderr,
        )
        return 2
    asyncio.run(_drop(url))
    service_dir = Path(__file__).resolve().parents[1]
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=service_dir, check=False
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
