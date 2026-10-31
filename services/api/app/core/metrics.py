"""Prometheus metrics (brief §4 step 3.9). Exposed on GET /metrics when METRICS_ENABLED=true.

Labels are low-cardinality on purpose: never a user, session or phone number.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

BILLING_TICK_SECONDS = Histogram(
    "billing_tick_latency_seconds",
    "Duration of one billing wake-up (all live sessions)",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
BILLING_INSUFFICIENT = Counter(
    "billing_insufficient_total", "Sessions whose hold could not cover the next minute"
)
BILLING_REDIS_CALLS = Counter(
    "billing_redis_calls_total", "Redis requests made by the billing engine", ["op"]
)
WS_CONNECTIONS = Gauge("ws_connections", "Open Samvaad WebSocket connections on this instance")
LEDGER_TXNS = Counter("ledger_txn_total", "Ledger transactions written", ["kind"])
PARAKH_DEGRADED = Counter("parakh_degraded_total", "Matches served without the vector rank")
SARANSH_DOCUMENTS = Counter("saransh_documents_total", "Documents processed", ["status"])
