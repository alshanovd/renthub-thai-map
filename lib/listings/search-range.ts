/**
 * Price ranges, sort orders and `max` clamping of the search. Server-safe (no nuqs/zustand):
 * shared by the page URL (`@/lib/search-params`) and the data API (`./api-params`).
 */
import type { SortOrder } from "./filter";
import type { PriceMode } from "./types";

/** Slider range per mode. Values at `max` mean "no upper limit" (`Infinity`). */
export const PRICE_RANGE: Record<
  PriceMode,
  { min: number; max: number; step: number; default: number }
> = {
  day: { min: 100, max: 3000, step: 50, default: 800 },
  month: { min: 2000, max: 60_000, step: 500, default: 15_000 },
};

export const SORT_ORDERS = ["price-asc", "price-desc", "updated"] as const satisfies SortOrder[];

/** Clamps `max` to the mode's range; the top of the range (or above) means no limit. */
export function clampMax(max: number, mode: PriceMode): number {
  const range = PRICE_RANGE[mode];
  if (Number.isNaN(max)) return range.default;
  if (max >= range.max) return Number.POSITIVE_INFINITY;
  return Math.max(range.min, Math.round(max));
}
