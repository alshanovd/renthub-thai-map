import { describe, expect, it } from "vitest";

import {
  compactNumber,
  formatPinLabel,
  formatPrice,
  formatPriceFull,
  relativeTime,
} from "./format";
import type { PriceRange } from "./types";

const amount = (min: number | null, max: number | null): PriceRange => ({
  type: "AMOUNT",
  min,
  max,
});
const call: PriceRange = { type: "CALL", min: null, max: null };
const noDaily: PriceRange = { type: "NO_DAILY_RENTAL", min: null, max: null };
const noMonthly: PriceRange = { type: "NO_MONTHLY_RENTAL", min: null, max: null };

describe("compactNumber", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [1000, "1k"],
    [7500, "7.5k"],
    [12_345, "12.3k"],
    [15_000, "15k"],
    [60_000, "60k"],
    [1_250_000, "1.3M"],
  ])("%d → %s", (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});

describe("formatPrice", () => {
  it("formats a single day price", () => {
    expect(formatPrice(amount(500, 500), "day")).toBe("฿500");
    expect(formatPrice(amount(500, null), "day")).toBe("฿500");
    expect(formatPrice(amount(1200, 1200), "day")).toBe("฿1,200");
  });

  it("formats a day range with an en dash", () => {
    expect(formatPrice(amount(500, 700), "day")).toBe("฿500–700");
  });

  it("uses the compact form for months", () => {
    expect(formatPrice(amount(7500, null), "month")).toBe("฿7.5k");
    expect(formatPrice(amount(7500, 9000), "month")).toBe("฿7.5k–9k");
    expect(formatPrice(amount(900, 900), "month")).toBe("฿900");
  });

  it("ignores a max below the min", () => {
    expect(formatPrice(amount(700, 500), "day")).toBe("฿700");
  });

  it("falls back to max when min is missing", () => {
    expect(formatPrice(amount(null, 650), "day")).toBe("฿650");
  });

  it("returns Call or a dash for non-amounts", () => {
    expect(formatPrice(call, "day")).toBe("Call");
    expect(formatPrice(call, "month")).toBe("Call");
    expect(formatPrice(noDaily, "day")).toBe("—");
    expect(formatPrice(noMonthly, "month")).toBe("—");
    expect(formatPrice(amount(null, null), "day")).toBe("—");
    expect(formatPrice({ type: "SOMETHING_NEW", min: 5, max: 5 }, "day")).toBe("—");
  });
});

describe("formatPinLabel", () => {
  it("shows only the minimum", () => {
    expect(formatPinLabel(amount(500, 700), "day")).toBe("฿500");
    expect(formatPinLabel(amount(7500, 12_000), "month")).toBe("฿7.5k");
    expect(formatPinLabel(call, "day")).toBe("Call");
    expect(formatPinLabel(noDaily, "day")).toBe("—");
  });
});

describe("formatPriceFull", () => {
  it("formats amounts with separators and a unit", () => {
    expect(formatPriceFull(amount(7500, 7500), "month")).toBe("฿7,500 / mo");
    expect(formatPriceFull(amount(7500, 9000), "month")).toBe("฿7,500–9,000 / mo");
    expect(formatPriceFull(amount(500, null), "day")).toBe("฿500 / day");
    expect(formatPriceFull(amount(500, 700), "day")).toBe("฿500–700 / day");
  });

  it("explains non-amounts", () => {
    expect(formatPriceFull(call, "day")).toBe("Call for price");
    expect(formatPriceFull(noDaily, "day")).toBe("No daily rental");
    expect(formatPriceFull(noMonthly, "month")).toBe("No monthly rental");
    expect(formatPriceFull(amount(null, null), "month")).toBe("—");
    expect(formatPriceFull({ type: "UNKNOWN", min: null, max: null }, "day")).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it.each([
    [10, "just now"],
    [50, "1 minute ago"],
    [5 * 60, "5 minutes ago"],
    [3 * 3600, "3 hours ago"],
    [26 * 3600, "yesterday"],
    [3 * 86_400, "3 days ago"],
    [8 * 86_400, "last week"],
    [40 * 86_400, "last month"],
    [400 * 86_400, "last year"],
  ])("%ds ago → %s", (seconds, expected) => {
    expect(relativeTime(ago(seconds), now)).toBe(expected);
  });

  it("handles the future, null and garbage", () => {
    expect(relativeTime(ago(-2 * 3600), now)).toBe("in 2 hours");
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("not a date", now)).toBe("—");
  });
});
