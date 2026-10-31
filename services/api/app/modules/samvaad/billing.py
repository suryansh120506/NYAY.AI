"""Pure money arithmetic for a consultation: no I/O, so every rule here is unit-testable.

Prorated settlement (owner decision, A60): minutes are prepaid one at a time, but when a call ends the user pays
only for the seconds actually used. Each component (advocate rate, platform fee, GST on the fee) is prorated on its
own, rounded DOWN to the paisa (in the user's favour), and the rest of what was charged is refunded. The advocate's
share stays exactly the advocate's per-minute rate × used time: no fee is ever taken out of it (brief §0).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.ledger.money import gst_on_fee, require_paise


@dataclass(frozen=True, slots=True)
class Rates:
    adv: int
    plat: int
    gst: int

    @property
    def cost(self) -> int:
        return self.adv + self.plat + self.gst


def rates_for(adv_rate_paise: int, platform_fee_paise: int, gst_rate_bps: int) -> Rates:
    require_paise(adv_rate_paise, name="advocate rate")
    return Rates(adv_rate_paise, platform_fee_paise, gst_on_fee(platform_fee_paise, gst_rate_bps))


@dataclass(frozen=True, slots=True)
class Proration:
    used_seconds: int
    charged: Rates  # what the minute debits took, per component
    due: Rates  # what the used seconds cost, per component
    refund: Rates  # charged − due, per component (never negative)

    @property
    def refund_total(self) -> int:
        return self.refund.cost


def prorate(rates: Rates, *, billed_minutes: int, used_seconds: int) -> Proration:
    """Never charges for more than was prepaid, never refunds more than was charged."""
    if billed_minutes < 0 or used_seconds < 0:
        raise ValueError("billed_minutes and used_seconds must be non-negative")
    used = min(used_seconds, billed_minutes * 60)

    def due_of(rate: int) -> int:
        return rate * used // 60

    charged = Rates(rates.adv * billed_minutes, rates.plat * billed_minutes, rates.gst * billed_minutes)
    due = Rates(due_of(rates.adv), due_of(rates.plat), due_of(rates.gst))
    refund = Rates(charged.adv - due.adv, charged.plat - due.plat, charged.gst - due.gst)
    return Proration(used_seconds=used, charged=charged, due=due, refund=refund)


@dataclass(frozen=True, slots=True)
class ReleaseSplit:
    to_bonus: int
    to_available: int

    @property
    def total(self) -> int:
        return self.to_bonus + self.to_available


def release_split(*, held: int, held_bonus: int, net_spent: int) -> ReleaseSplit:
    """What goes back when the hold is released. Bonus credit was spent first, so what remains of it is
    `held_bonus − net_spent` (if positive), and it returns to the bonus balance; the rest returns to available."""
    remaining = held - net_spent
    if remaining < 0:
        raise ValueError("spent more than was held")
    to_bonus = max(0, min(remaining, held_bonus - net_spent))
    return ReleaseSplit(to_bonus=to_bonus, to_available=remaining - to_bonus)


def remaining_seconds(*, started_ms: int, billed_minutes: int, spendable: int, cost: int, now_ms: int) -> int:
    """Time left: the minutes already paid for plus the minutes the spendable balance still covers."""
    affordable = spendable // cost if cost > 0 else 0
    return max(0, (started_ms + (billed_minutes + affordable) * 60_000 - now_ms) // 1000)
