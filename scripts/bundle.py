#!/usr/bin/env python3
"""Zip the repository for moving to another machine (stdlib only: `python scripts/bundle.py`).

Leaves out everything machine-specific or regenerable (dependencies, virtualenvs, build output, caches, test
artefacts) and NEVER includes `.env` files: only `.env.example` travels. On the new machine:
    unzip → copy .env.example to .env → fill in keys → follow README "Run it".
"""

from __future__ import annotations

import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git", "node_modules", ".venv", ".next", "dist", "out", "test-results", "playwright-report", "blob-report",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".hypothesis", ".turbo", "coverage", ".pnpm-store",
}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = {".pyc", ".tsbuildinfo", ".log"}
# Never ship real environment files; only the template.
ENV_FILE = re.compile(r"^\.env(\..+)?$")
SECRET_HINT = re.compile(
    r"(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{30,}|gsk_[A-Za-z0-9]{20,}|rzp_(?:live|test)_[A-Za-z0-9]{8,}"
    # A database URL with a real password; `<placeholder>` templates (as in .env.example) don't match.
    r"|postgres(?:ql)?://[^:\s<>]+:[^@\s<>]{6,}@(?!localhost)[^\s'\"<>]+)"
)


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in SKIP_DIRS for part in rel.parts):
        return False
    if path.name in SKIP_FILES or path.suffix in SKIP_SUFFIXES:
        return False
    return not (ENV_FILE.match(path.name) and path.name != ".env.example")


def main() -> int:
    files = sorted(p for p in ROOT.rglob("*") if p.is_file() and included(p))
    suspicious = []
    for path in files:
        if path.suffix in {".png", ".woff2", ".jpg", ".ico"} or path.stat().st_size > 2_000_000:
            continue
        try:
            if SECRET_HINT.search(path.read_text(encoding="utf-8", errors="ignore")):
                suspicious.append(path.relative_to(ROOT))
        except OSError:
            continue
    if suspicious and "--force" not in sys.argv:
        print("Refusing to bundle: these files look like they contain credentials:", file=sys.stderr)
        for path in suspicious:
            print(f"  {path}", file=sys.stderr)
        print("Move secrets into .env (never bundled) or pass --force if they are false positives.", file=sys.stderr)
        return 1

    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    target = out_dir / f"nyay-{datetime.now():%Y%m%d-%H%M}.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, Path("nyay") / path.relative_to(ROOT))
    size = target.stat().st_size / 1_048_576
    print(f"Wrote {target.relative_to(ROOT)} ({len(files)} files, {size:.1f} MB). .env was NOT included.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
