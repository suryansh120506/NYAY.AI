"""Money helper (brief rule 4). Amounts are integer paise, never floats or Decimal."""

from __future__ import annotations

Paise = int


def require_paise(value: object, *, name: str = "amount") -> Paise:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer number of paise, got {type(value).__name__}")
    return value


def format_paise(paise: Paise, *, trim_zero: bool = False) -> str:
    """123450 → '₹1,234.50' with Indian digit grouping (₹1,23,456.50)."""
    require_paise(paise)
    sign = "−" if paise < 0 else ""
    rupees, rest = divmod(abs(paise), 100)
    digits = str(rupees)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    fraction = "" if trim_zero and rest == 0 else f".{rest:02d}"
    return f"{sign}₹{digits}{fraction}"


def gst_on_fee(fee_paise: Paise, rate_bps: int) -> Paise:
    """GST on the platform fee, half-up to the paisa. TODO(human): confirm GST rounding (ASSUMPTIONS A21)."""
    require_paise(fee_paise)
    return (fee_paise * rate_bps + 5_000) // 10_000
