import type { Bounds } from "@/lib/store";

import type { ListingSummary, PriceMode, PriceRange } from "./types";

export type SortOrder = "price-asc" | "price-desc" | "updated";

/** The applied search (lives in the URL from plan 09). */
export type Search = {
  mode: PriceMode;
  /** Upper bound for the active mode's minimum price, in THB. */
  max: number;
  /** Also include call-for-price listings of the active mode. */
  call: boolean;
  sort: SortOrder;
};

export const DEFAULT_SEARCH: Search = { mode: "day", max: 800, call: false, sort: "price-asc" };

/** The active mode's price range of a listing. */
export function modePrice(listing: ListingSummary, mode: PriceMode): PriceRange {
  return mode === "month" ? listing.monthly : listing.daily;
}

/** Minimum price of an `AMOUNT` range (falls back to max), otherwise null. */
function minAmount(range: PriceRange): number | null {
  if (range.type !== "AMOUNT") return null;
  return range.min ?? range.max ?? null;
}

function matches(listing: ListingSummary, search: Search): boolean {
  const range = modePrice(listing, search.mode);
  if (range.type === "CALL") return search.call;
  const min = minAmount(range);
  return min !== null && min <= search.max;
}

/** `refreshedAt` as epoch ms; missing dates sort as oldest. */
function refreshedTime(listing: ListingSummary): number {
  return listing.refreshedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(listing.refreshedAt);
}

function byId(a: ListingSummary, b: ListingSummary): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Filters by the active mode's price and sorts.
 * Price sorts put call-for-price listings last (in both directions); ties break by id.
 * `updated` sorts by `refreshedAt`, newest first, nulls last.
 */
export function applySearch(listings: readonly ListingSummary[], search: Search): ListingSummary[] {
  const result = listings.filter((listing) => matches(listing, search));
  const price = (listing: ListingSummary) => minAmount(modePrice(listing, search.mode));

  if (search.sort === "updated") {
    return result.toSorted((a, b) => refreshedTime(b) - refreshedTime(a) || byId(a, b));
  }

  const direction = search.sort === "price-desc" ? -1 : 1;
  return result.toSorted((a, b) => {
    const pa = price(a);
    const pb = price(b);
    if (pa === null || pb === null) {
      if (pa === pb) return byId(a, b);
      return pa === null ? 1 : -1;
    }
    return (pa - pb) * direction || byId(a, b);
  });
}

/** True when the listing has coordinates inside `bounds` (handles antimeridian-crossing bounds). */
export function inBounds(listing: Pick<ListingSummary, "lat" | "lng">, bounds: Bounds): boolean {
  const { lat, lng } = listing;
  if (lat === null || lng === null) return false;
  if (lat < bounds.south || lat > bounds.north) return false;
  if (bounds.west <= bounds.east) return lng >= bounds.west && lng <= bounds.east;
  return lng >= bounds.west || lng <= bounds.east;
}

/** Listings that can be drawn on the map. */
export function hasLocation(
  listing: ListingSummary,
): listing is ListingSummary & { lat: number; lng: number } {
  return listing.lat !== null && listing.lng !== null;
}
