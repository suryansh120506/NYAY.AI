#!/usr/bin/env python3
"""Fail if anything that would be committed looks like a credential (stdlib only: `python scripts/check_secrets.py`).

Runs in CI and before every push. With git available it scans exactly the files git would track (tracked plus
untracked-but-not-ignored), so .gitignore is respected; otherwise it walks the tree with the same exclusions as
scripts/bundle.py. It also refuses any real `.env` file that is about to be committed.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from bundle import ENV_FILE, included  # noqa: E402

PATTERNS = {
    "OpenAI-style key": r"sk-[A-Za-z0-9_\-]{20,}",
    "Google API key": r"AIza[0-9A-Za-z_\-]{30,}",
    "Groq key": r"gsk_[A-Za-z0-9]{20,}",
    "Razorpay key": r"rzp_(?:live|test)_[A-Za-z0-9]{8,}",
    "GitHub token": r"gh[pousr]_[A-Za-z0-9]{30,}",
    "AWS access key": r"AKIA[0-9A-Z]{16}",
    "Private key": r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----",
    "Slack token": r"xox[abpr]-[A-Za-z0-9-]{10,}",
    # A database or Redis URL with a real password; `<placeholder>` templates and localhost stand-ins don't match.
    "Credential URL": r"(?:postgres(?:ql)?|rediss?)://[^:\s<>/]+:[^@\s<>]{6,}@(?!localhost|127\.0\.0\.1|postgres:|redis:)"
    r"[^\s'\"<>]+",
}
SECRET = re.compile("|".join(f"(?P<g{i}>{rx})" for i, rx in enumerate(PATTERNS.values())))
NAMES = list(PATTERNS)
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".zip", ".webp"}
# Lines that deliberately show a pattern (this file's own docs, test fixtures) opt out explicitly.
ALLOW = "secrets-check-ignore"


def candidate_files() -> list[Path]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],  # noqa: S607
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout
        return [ROOT / p for p in out.decode("utf-8").split("\0") if p and (ROOT / p).is_file()]
    except (OSError, subprocess.CalledProcessError):
        return [p for p in ROOT.rglob("*") if p.is_file() and included(p)]


def main() -> int:
    problems: list[str] = []
    files = candidate_files()
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        if ENV_FILE.match(path.name) and path.name != ".env.example":
            problems.append(f"{rel}: real environment file; it must never be committed")
            continue
        if path.suffix.lower() in BINARY or path.stat().st_size > 2_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if ALLOW in line:
                continue
            match = SECRET.search(line)
            if match:
                kind = NAMES[int(next(k for k, v in match.groupdict().items() if v)[1:])]
                problems.append(f"{rel}:{number}: looks like a {kind}")
    if problems:
        print("secrets:check FAILED. Move these values into .env (never committed):", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"secrets:check ok ({len(files)} files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
