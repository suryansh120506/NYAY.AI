import { describe, expect, it } from "vitest";
import {
  formatPaise,
  gstOnFee,
  minutesCovered,
  parseRupeesInput,
  perMinuteCost,
  rupees,
} from "@/lib/money";

describe("formatPaise", () => {
  it.each([
    [0, "₹0.00"],
    [5, "₹0.05"],
    [100, "₹1.00"],
    [123_450, "₹1,234.50"],
    [99_999, "₹999.99"],
    [12_345_650, "₹1,23,456.50"],
    [1_000_000_000, "₹1,00,00,000.00"],
  ])("formats %i paise as %s (Indian grouping)", (paise, expected) => {
    expect(formatPaise(paise)).toBe(expected);
  });

  it("uses a true minus sign for negatives and + only when asked", () => {
    expect(formatPaise(-21_540)).toBe("−₹215.40");
    expect(formatPaise(20_000, { signed: true })).toBe("+₹200.00");
    expect(formatPaise(0, { signed: true })).toBe("₹0.00");
  });

  it("trims .00 for whole rupees only", () => {
    expect(formatPaise(14_800, { trimZeroPaise: true })).toBe("₹148");
    expect(formatPaise(14_850, { trimZeroPaise: true })).toBe("₹148.50");
  });

  it("accepts bigint beyond the safe-integer range", () => {
    expect(formatPaise(123_456_789_012_345_678n)).toBe("₹1,23,45,67,89,01,23,456.78");
  });

  it("refuses non-integer money (rule 4: never floats)", () => {
    expect(() => formatPaise(10.5)).toThrow(TypeError);
    expect(() => formatPaise(Number.NaN)).toThrow(TypeError);
  });
});

describe("parseRupeesInput", () => {
  it.each([
    ["150", 15_000],
    ["150.5", 15_050],
    ["150.05", 15_005],
    ["1,500", 150_000],
    ["₹ 200", 20_000],
  ])("parses %s", (input, expected) => {
    expect(parseRupeesInput(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "-5", "12345678"])("rejects %s", (input) => {
    expect(parseRupeesInput(input)).toBeNull();
  });
});

describe("pricing helpers", () => {
  it("computes GST on the platform fee half-up to the paisa", () => {
    expect(gstOnFee(500, 1_800)).toBe(90);
    expect(gstOnFee(333, 1_800)).toBe(60); // 59.94 → 60
    expect(gstOnFee(1, 1_800)).toBe(0); // 0.18 → 0
    expect(gstOnFee(25, 1_800)).toBe(5); // 4.5 → 5
  });

  it("sums the three disclosed lines into the per-minute cost", () => {
    expect(perMinuteCost({ adv_rate_paise: 3_000, plat_rate_paise: 500, gst_rate_paise: 90 })).toBe(
      3_590,
    );
  });

  it("counts whole minutes a balance covers", () => {
    expect(minutesCovered(25_000, 3_590)).toBe(6);
    expect(minutesCovered(3_589, 3_590)).toBe(0);
    expect(minutesCovered(100, 0)).toBe(0);
  });

  it("converts whole rupees", () => {
    expect(rupees(100)).toBe(10_000);
    expect(() => rupees(1.5)).toThrow(TypeError);
  });
});
