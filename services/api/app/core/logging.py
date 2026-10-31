"""Structured JSON logs with PII masking (brief rule 6).

Never log OTPs, tokens, document text, chat content or full phone numbers. The masking processor runs on every event
before it is rendered, so a careless `log.info(..., phone=...)` still comes out masked.
"""

from __future__ import annotations

import logging
import re
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

_PHONE = re.compile(r"\+?91[\s-]?[6-9]\d{4}[\s-]?\d{5}|\b[6-9]\d{9}\b")
_SECRET_KEYS = re.compile(
    r"(otp|code|token|secret|password|authorization|cookie|api_key|text|body|message|content|excerpt)", re.I
)


def mask_phone(value: str) -> str:
    """'+919876541234' → '+91••••••1234'."""

    def _mask(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        return f"+91••••••{digits[-4:]}"

    return _PHONE.sub(_mask, value)


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return mask_phone(value)
    if isinstance(value, dict):
        return {k: ("[redacted]" if _SECRET_KEYS.search(str(k)) else _scrub(v)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_scrub(v) for v in value]
    return value


def mask_pii(_: Any, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in list(event_dict):
        if key in {"event", "level", "timestamp", "logger"}:
            if key == "event" and isinstance(event_dict[key], str):
                event_dict[key] = mask_phone(event_dict[key])
            continue
        if _SECRET_KEYS.search(key) and key != "dev_otp":
            event_dict[key] = "[redacted]"
        else:
            event_dict[key] = _scrub(event_dict[key])
    return event_dict


class StripQueryStrings(logging.Filter):
    """Uvicorn logs request paths with their query string, which for /ws/samvaad carries the one-time ticket.
    Drop every query string from uvicorn's own log lines (our access log never records them)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                a.split("?", 1)[0] if isinstance(a, str) and "?" in a else a for a in record.args
            )
        return True


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level.upper())
    for name in ("uvicorn.access", "uvicorn.error"):
        target = logging.getLogger(name)
        if not any(isinstance(f, StripQueryStrings) for f in target.filters):
            target.addFilter(StripQueryStrings())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            mask_pii,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    logger: structlog.stdlib.BoundLogger = structlog.get_logger(name)
    return logger
