/**
 * Money helper (brief rule 4). All money is integer paise: never floats for amounts we store or compute with.
 * `formatPaise(123450)` → "₹1,234.50" using Indian digit grouping (₹1,23,456.50).
 */

export type Paise = number;

export function isPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money must be an integer number of paise, got ${value}`);
  }
  return BigInt(value);
}

/** "1234567" → "12,34,567" */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
}

export interface FormatPaiseOptions {
  /** Drop ".00" for whole-rupee amounts: ₹148 instead of ₹148.00. */
  trimZeroPaise?: boolean;
  /** Prefix positive amounts with "+". Negative amounts always get a true minus sign. */
  signed?: boolean;
}

export function formatPaise(paise: number | bigint, options: FormatPaiseOptions = {}): string {
  const value = toBigInt(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = groupIndian((abs / 100n).toString());
  const rest = abs % 100n;
  const fraction =
    options.trimZeroPaise && rest === 0n ? "" : `.${rest.toString().padStart(2, "0")}`;
  const sign = negative ? "−" : options.signed && value > 0n ? "+" : "";
  return `${sign}₹${rupees}${fraction}`;
}

/** Parse what a person types in a rupee field ("150", "150.5", "1,500") into paise. Returns null if invalid. */
export function parseRupeesInput(input: string): Paise | null {
  const cleaned = input.replace(/[,\s₹]/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number(whole) * 100 + Number(fraction);
}

export function rupees(whole: number): Paise {
  if (!Number.isSafeInteger(whole)) throw new TypeError("rupees() takes whole rupees");
  return whole * 100;
}

/** GST on the platform fee, half-up to the paisa (docs/ASSUMPTIONS.md A21: TODO(human) confirm rounding). */
export function gstOnFee(feePaise: Paise, rateBps: number): Paise {
  return Math.floor((feePaise * rateBps + 5_000) / 10_000);
}

export interface PerMinuteRates {
  adv_rate_paise: Paise;
  plat_rate_paise: Paise;
  gst_rate_paise: Paise;
}

export function perMinuteCost(rates: PerMinuteRates): Paise {
  return rates.adv_rate_paise + rates.plat_rate_paise + rates.gst_rate_paise;
}

/** Whole minutes a balance covers at a per-minute cost. */
export function minutesCovered(balance: Paise, costPerMinute: Paise): number {
  if (costPerMinute <= 0) return 0;
  return Math.max(0, Math.floor(balance / costPerMinute));
}
