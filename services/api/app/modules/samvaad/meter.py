"""Redis side of Samvaad billing (brief §1.3 steps 2-6), sized for the Upstash free tier (owner decision, A59).

Every operation is ONE atomic Lua call (EVALSHA), so a live consultation costs about one Redis request per minute:

  start    take the one-live-session lock, initialise every meter field, and debit minute 1 (prepaid).
  bill     debit every minute that starts before the billing engine's next wake-up. Also syncs the hold from
           Postgres (absolute value, so a lost update can't drift) and re-opens an EXHAUSTED meter after a top-up.
  freeze   stop billing (state ENDING) and return the snapshot for the final, prorated settlement.
  cleanup  drop the meter and the lock once Postgres has settled the session.

Money semantics are the brief's: integer paise, minute n is debited before minute n is served, the minute index is
computed on the server from `started_at_ms`, missed minutes are billed in order, and the `minute_idx` guard makes a
repeated call a no-op, so concurrent or retried calls can never charge a minute twice. Redis can be lost without
losing or creating money: Postgres holds the hold and the ledger; the meter only decides when a minute is charged.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import cast

from redis.asyncio import Redis
from redis.exceptions import NoScriptError

MINUTE_MS = 60_000


def meter_key(user_id: str) -> str:
    # `{u:<uid>}` hash tag keeps a user's keys in one slot for a future Redis Cluster (brief §1.3).
    return f"{{u:{user_id}}}:meter"


def active_key(user_id: str) -> str:
    return f"{{u:{user_id}}}:active"


# Shared billing body. Expects: KEYS[1] meter; locals now, horizon, held (synced), consumed, adv, plat, gst, idx,
# started, warned, state. Debits whole minutes while affordable, then reports.
_BILL_BODY = r"""
local cost = adv + plat + gst
if state == 'EXHAUSTED' and held - consumed >= cost then
  state = 'LIVE'
end
local status = 'OK'
if state == 'LIVE' then
  local target = math.floor((now + horizon - started) / 60000) + 1
  while idx < target do
    if held - consumed < cost then
      status = 'INSUFFICIENT'
      break
    end
    idx = idx + 1
    consumed = consumed + cost
  end
  if status == 'INSUFFICIENT' then
    state = 'EXHAUSTED'
  end
elseif state == 'EXHAUSTED' then
  status = 'INSUFFICIENT'
end
local remaining = held - consumed
local warn_now = 0
if remaining <= 2 * cost then
  if warned == 0 then
    warn_now = 1
    warned = 1
  end
else
  warned = 0
end
redis.call('HSET', KEYS[1], 'state', state, 'held', held, 'consumed', consumed, 'minute_idx', idx, 'warned', warned)
return {status, tostring(idx), tostring(remaining), tostring(cost), tostring(warn_now),
        tostring(started + idx * 60000), state}
"""

_START = (
    r"""
-- KEYS[1] meter  KEYS[2] active lock
-- ARGV: session id, held, adv, plat, gst, started_ms, now_ms, horizon_ms, lock_ttl_ms, minutes already billed
-- (non-zero only when rebuilding a meter Redis lost: the meter resumes exactly where Postgres is)
local holder = redis.call('GET', KEYS[2])
if holder and holder ~= ARGV[1] then
  return {'LOCKED', holder}
end
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[9])
local existing = redis.call('HGET', KEYS[1], 'session_id')
local now, horizon = tonumber(ARGV[7]), tonumber(ARGV[8])
local held, consumed, idx, warned, state, started
local adv, plat, gst
if existing == ARGV[1] then
  -- Retried start: keep the meter as it is.
  local m = redis.call('HMGET', KEYS[1], 'state','held','consumed','adv_rate','plat_rate','gst_rate','minute_idx',
                       'started_at_ms','warned')
  state, held, consumed = m[1], math.max(tonumber(m[2]), tonumber(ARGV[2])), tonumber(m[3])
  adv, plat, gst = tonumber(m[4]), tonumber(m[5]), tonumber(m[6])
  idx, started, warned = tonumber(m[7]), tonumber(m[8]), tonumber(m[9])
else
  adv, plat, gst = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
  idx, started, warned = tonumber(ARGV[10]), tonumber(ARGV[6]), 0
  state, held, consumed = 'LIVE', tonumber(ARGV[2]), idx * (adv + plat + gst)
  redis.call('DEL', KEYS[1])
  redis.call('HSET', KEYS[1], 'session_id', ARGV[1], 'adv_rate', adv, 'plat_rate', plat, 'gst_rate', gst,
             'started_at_ms', started)
end
"""
    + _BILL_BODY
)

_BILL = (
    r"""
-- KEYS[1] meter   ARGV: session id, now_ms, horizon_ms, held (absolute, from Postgres)
local m = redis.call('HMGET', KEYS[1], 'session_id','state','held','consumed','adv_rate','plat_rate','gst_rate',
                     'minute_idx','started_at_ms','warned')
if not m[1] then return {'NO_METER'} end
if m[1] ~= ARGV[1] then return {'OTHER_SESSION'} end
local state = m[2]
if state ~= 'LIVE' and state ~= 'EXHAUSTED' then return {'NOT_LIVE', m[8], state} end
local now, horizon = tonumber(ARGV[2]), tonumber(ARGV[3])
local held, consumed = math.max(tonumber(m[3]), tonumber(ARGV[4])), tonumber(m[4])
local adv, plat, gst = tonumber(m[5]), tonumber(m[6]), tonumber(m[7])
local idx, started, warned = tonumber(m[8]), tonumber(m[9]), tonumber(m[10])
"""
    + _BILL_BODY
)

_FREEZE = r"""
-- KEYS[1] meter   ARGV[1] session id
local m = redis.call('HMGET', KEYS[1], 'session_id','minute_idx','consumed')
if not m[1] or m[1] ~= ARGV[1] then return {'NO_METER'} end
redis.call('HSET', KEYS[1], 'state', 'ENDING')
return {'OK', m[2], m[3]}
"""

_CLEANUP = r"""
-- KEYS[1] meter  KEYS[2] active lock   ARGV[1] session id. Only removes keys that belong to this session.
if redis.call('HGET', KEYS[1], 'session_id') == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
"""


class Script:
    """EVALSHA with a one-time SCRIPT LOAD, re-loaded only after NOSCRIPT (e.g. a Redis restart or flush)."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.sha: str | None = None

    async def __call__(self, redis: Redis, keys: list[str], args: list[str | int]) -> list[str]:
        argv = [str(a) for a in args]
        if self.sha is None:
            self.sha = cast(str, await redis.script_load(self.source))
        try:
            result = await redis.evalsha(self.sha, len(keys), *keys, *argv)  # type: ignore[misc]
        except NoScriptError:
            self.sha = cast(str, await redis.script_load(self.source))
            result = await redis.evalsha(self.sha, len(keys), *keys, *argv)  # type: ignore[misc]
        if not isinstance(result, list):  # scripts that return a single value
            return [str(result)]
        return [str(v) for v in result]


START = Script(_START)
BILL = Script(_BILL)
FREEZE = Script(_FREEZE)
CLEANUP = Script(_CLEANUP)


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True, slots=True)
class BillResult:
    """status: OK | INSUFFICIENT (meter EXHAUSTED: the hold can't cover the next minute) | LOCKED | NO_METER |
    OTHER_SESSION | NOT_LIVE."""

    status: str
    minute_idx: int = 0
    remaining: int = 0
    cost: int = 0
    warn_now: bool = False
    paid_until_ms: int = 0
    state: str = ""
    holder: str = ""

    @property
    def billed(self) -> bool:
        return self.status in ("OK", "INSUFFICIENT")


def _parse(raw: list[str]) -> BillResult:
    if raw[0] in ("OK", "INSUFFICIENT"):
        return BillResult(
            status=raw[0],
            minute_idx=int(raw[1]),
            remaining=int(raw[2]),
            cost=int(raw[3]),
            warn_now=raw[4] == "1",
            paid_until_ms=int(raw[5]),
            state=raw[6],
        )
    if raw[0] == "LOCKED":
        return BillResult(status="LOCKED", holder=raw[1])
    if raw[0] == "NOT_LIVE":
        return BillResult(status="NOT_LIVE", minute_idx=int(raw[1]), state=raw[2])
    return BillResult(status=raw[0])


async def start(
    redis: Redis,
    *,
    session_id: str,
    user_id: str,
    held: int,
    adv: int,
    plat: int,
    gst: int,
    started_ms: int,
    now: int,
    horizon_ms: int,
    lock_ttl_ms: int,
    minute_idx: int = 0,
) -> BillResult:
    raw = await START(
        redis,
        [meter_key(user_id), active_key(user_id)],
        [session_id, held, adv, plat, gst, started_ms, now, horizon_ms, lock_ttl_ms, minute_idx],
    )
    return _parse(raw)


async def bill(
    redis: Redis, *, session_id: str, user_id: str, now: int, horizon_ms: int, held: int
) -> BillResult:
    raw = await BILL(redis, [meter_key(user_id)], [session_id, now, horizon_ms, held])
    return _parse(raw)


@dataclass(frozen=True, slots=True)
class Snapshot:
    found: bool
    minute_idx: int = 0
    consumed: int = 0


async def freeze(redis: Redis, *, session_id: str, user_id: str) -> Snapshot:
    raw = await FREEZE(redis, [meter_key(user_id)], [session_id])
    if raw[0] != "OK":
        return Snapshot(found=False)
    return Snapshot(found=True, minute_idx=int(raw[1]), consumed=int(raw[2]))


async def cleanup(redis: Redis, *, session_id: str, user_id: str) -> None:
    await CLEANUP(redis, [meter_key(user_id), active_key(user_id)], [session_id])
