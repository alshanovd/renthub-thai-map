import type { PriceMode, PriceRange } from "./types";

const THB = "฿";
const DASH = "—";
const EN_DASH = "–";

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The price as a number pair when the range is a usable `AMOUNT`, otherwise null. */
function amount(range: PriceRange): { min: number; max: number } | null {
  if (range.type !== "AMOUNT") return null;
  const min = range.min ?? range.max;
  if (min === null || min === undefined) return null;
  const max = range.max !== null && range.max > min ? range.max : min;
  return { min, max };
}

/** `950` → `950`, `7500` → `7.5k`, `15000` → `15k`, `12345` → `12.3k`. */
export function compactNumber(value: number): string {
  if (Math.abs(value) < 1000) return intFormat.format(value);
  const thousands = Math.round(value / 100) / 10;
  if (Math.abs(thousands) < 1000) return `${String(thousands)}k`;
  return `${String(Math.round(value / 100_000) / 10)}M`;
}

function number(value: number, mode: PriceMode): string {
  return mode === "month" ? compactNumber(value) : intFormat.format(value);
}

/**
 * Short price for pins and tight spots.
 * Day: `฿500`, `฿500–700`. Month (compact): `฿7.5k`, `฿7.5k–9k`. `Call` for call-for-price,
 * `—` for anything else (no rental of that kind, unknown type, missing amount).
 */
export function formatPrice(range: PriceRange, mode: PriceMode): string {
  if (range.type === "CALL") return "Call";
  const value = amount(range);
  if (!value) return DASH;
  if (value.min === value.max) return `${THB}${number(value.min, mode)}`;
  return `${THB}${number(value.min, mode)}${EN_DASH}${number(value.max, mode)}`;
}

/** Pin label: only the minimum price (`฿500`, `฿7.5k`), `Call` or `—`. */
export function formatPinLabel(range: PriceRange, mode: PriceMode): string {
  return formatPrice({ ...range, max: null }, mode);
}

/**
 * Full price for cards: `฿500 / day`, `฿500–700 / day`, `฿7,500 / mo`,
 * `Call for price`, `No daily rental` / `No monthly rental`, or `—`.
 */
export function formatPriceFull(range: PriceRange, mode: PriceMode): string {
  const unit = mode === "month" ? "mo" : "day";
  if (range.type === "CALL") return "Call for price";
  if (range.type === "NO_DAILY_RENTAL") return "No daily rental";
  if (range.type === "NO_MONTHLY_RENTAL") return "No monthly rental";
  const value = amount(range);
  if (!value) return DASH;
  const text =
    value.min === value.max
      ? intFormat.format(value.min)
      : `${intFormat.format(value.min)}${EN_DASH}${intFormat.format(value.max)}`;
  return `${THB}${text} / ${unit}`;
}

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * `just now`, `5 minutes ago`, `yesterday`, `3 days ago`, `last month`…
 * Returns `never` for null and `—` for an unparsable string. `now` is injectable for tests.
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return "never";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return DASH;
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  for (const [unit, size] of UNITS) {
    if (abs >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return relativeFormat.format(Math.round(seconds / 60), "minute");
}
