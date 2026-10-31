"""Brief §1.3 Praman / §4 step 3.7: no user-facing response may carry a trust or ranking signal.

Walks every non-admin response schema in the OpenAPI document and fails on any field whose name suggests one.
"""

from __future__ import annotations

import re
from typing import Any

from app.main import create_app

FORBIDDEN = re.compile(r"praman|trust|score|rank|percentile|win_rate|rating_avg", re.I)


def _fields(schema: dict[str, Any], components: dict[str, Any], seen: set[str]) -> set[str]:
    names: set[str] = set()
    if "$ref" in schema:
        ref = schema["$ref"].rsplit("/", 1)[-1]
        if ref in seen:
            return names
        seen.add(ref)
        return _fields(components[ref], components, seen)
    for key in ("properties",):
        for name, sub in schema.get(key, {}).items():
            names.add(name)
            names |= _fields(sub, components, seen)
    for key in ("items", "additionalProperties"):
        if isinstance(schema.get(key), dict):
            names |= _fields(schema[key], components, seen)
    for key in ("anyOf", "allOf", "oneOf"):
        for sub in schema.get(key, []):
            names |= _fields(sub, components, seen)
    return names


def test_no_trust_or_ranking_fields_in_user_facing_responses() -> None:
    spec = create_app().openapi()
    components = spec.get("components", {}).get("schemas", {})
    offenders: dict[str, set[str]] = {}
    for path, operations in spec["paths"].items():
        if path.startswith("/v1/admin"):
            continue
        for method, op in operations.items():
            for response in op.get("responses", {}).values():
                for content in response.get("content", {}).values():
                    bad = {
                        f
                        for f in _fields(content.get("schema", {}), components, set())
                        if FORBIDDEN.search(f)
                    }
                    if bad:
                        offenders[f"{method.upper()} {path}"] = bad
    assert offenders == {}, offenders
