"""Write the web app's OpenAPI schema without starting a server (no database or Redis needed).

uv run python -m scripts.export_openapi > ../../apps/web/lib/api/generated/openapi.json

Internal-only endpoints (Praman, brief §1.2: the TrustScore never reaches the frontend) are left out, along with
any schema only they use; the full schema is still served at /docs in dev.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

from app.main import create_app

INTERNAL_PATHS = ("/v1/admin/praman",)


def _refs(node: Any) -> set[str]:
    text = json.dumps(node)
    return set(re.findall(r'"#/components/schemas/([^"]+)"', text))


def web_schema() -> dict[str, Any]:
    spec = create_app().openapi()
    spec["paths"] = {p: ops for p, ops in spec["paths"].items() if not p.startswith(INTERNAL_PATHS)}
    schemas: dict[str, Any] = spec.get("components", {}).get("schemas", {})
    keep: set[str] = set()
    frontier = _refs(spec["paths"])
    while frontier:
        name = frontier.pop()
        if name in keep or name not in schemas:
            continue
        keep.add(name)
        frontier |= _refs(schemas[name])
    spec["components"]["schemas"] = {k: v for k, v in schemas.items() if k in keep}
    return spec


if __name__ == "__main__":
    json.dump(web_schema(), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
