import type { Bounds, ListTab } from "@/lib/store";

import { hasLocation, inBounds } from "./filter";
import type { ListingSummary } from "./types";

/** One card in the list. `outsideView`: the selected listing, kept although it's off-screen. */
export type VisibleItem = { listing: ListingSummary; outsideView: boolean };

export type VisibleInput = {
  tab: ListTab;
  /** Every listing in the payload (unfiltered). */
  listings: readonly ListingSummary[];
  /** The payload after the applied search (filtered and sorted). */
  filtered: readonly ListingSummary[];
  /** Visible map area; null until the map reports it. */
  bounds: Bounds | null;
  selectedId: string | null;
  /** Favorite ids, in display order. */
  favoriteIds: readonly string[];
  /** Favorites missing from the payload (soft-deleted), fetched from `/api/listings/by-ids`. */
  extraListings?: readonly ListingSummary[];
};

const item = (listing: ListingSummary, outsideView = false): VisibleItem => ({
  listing,
  outsideView,
});

/**
 * The cards of the active tab.
 * - `map`: filtered listings with coordinates inside `bounds`. The selected listing (if it has
 *   coordinates) is prepended, marked `outsideView`, when it isn't among them.
 * - `favorites`: every favorite resolved against the payload, then `extraListings`; ignores the
 *   search and bounds, includes listings without coordinates. Unresolved ids are skipped.
 * - `nolocation`: filtered listings without coordinates.
 */
export function computeVisibleItems(input: VisibleInput): VisibleItem[] {
  const { tab, listings, filtered, bounds, selectedId } = input;

  if (tab === "nolocation") return filtered.filter((l) => !hasLocation(l)).map((l) => item(l));

  if (tab === "favorites") {
    const byId = new Map<string, ListingSummary>();
    for (const listing of input.extraListings ?? []) byId.set(listing.id, listing);
    for (const listing of listings) byId.set(listing.id, listing);
    const seen = new Set<string>();
    const result: VisibleItem[] = [];
    for (const id of input.favoriteIds) {
      const listing = byId.get(id);
      if (!listing || seen.has(id)) continue;
      seen.add(id);
      result.push(item(listing));
    }
    return result;
  }

  const inView = bounds ? filtered.filter((l) => inBounds(l, bounds)).map((l) => item(l)) : [];
  if (selectedId === null || inView.some((v) => v.listing.id === selectedId)) return inView;
  const selected = listings.find((l) => l.id === selectedId);
  if (!selected || !hasLocation(selected)) return inView;
  return [item(selected, true), ...inView];
}

/** Tab badge counts: listings in view (without the kept selection), favorites, no-location. */
export function computeTabCounts(
  input: Omit<VisibleInput, "tab" | "selectedId">,
): Record<ListTab, number> {
  const { filtered, bounds } = input;
  return {
    map: bounds ? filtered.filter((l) => inBounds(l, bounds)).length : 0,
    favorites: computeVisibleItems({ ...input, tab: "favorites", selectedId: null }).length,
    nolocation: filtered.filter((l) => !hasLocation(l)).length,
  };
}
