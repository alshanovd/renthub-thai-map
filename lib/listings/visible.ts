import type { Bounds, ListTab } from "@/lib/store";

import { inBounds } from "./filter";
import type { Pin } from "./types";

/**
 * One card in the list, by id (the card fetches its own data). `outsideView`: the selected
 * listing, kept although it's off-screen or filtered out. `pin`: its map pin when known (the
 * skeleton shows its price).
 */
export type VisibleItem = { id: string; outsideView: boolean; pin: Pin | null };

export type VisibleInput = {
  tab: ListTab;
  /** Pins of the (expanded) loaded area, in the server's sort order. */
  pins: readonly Pin[];
  /** Visible map area; null until the map reports it. */
  bounds: Bounds | null;
  selectedId: string | null;
  /** The selection as a pin, from its card data (may be filtered out); null if unknown. */
  selectedPin: Pin | null;
  /** Favorite ids, in display order. */
  favoriteIds: readonly string[];
  /** Ids of the loaded No location pages, in sort order. */
  noLocationIds: readonly string[];
};

const item = (id: string, pin: Pin | null = null, outsideView = false): VisibleItem => ({
  id,
  outsideView,
  pin,
});

/** Pins inside the actual (unexpanded) visible bounds, keeping their order. */
export function pinsInView(pins: readonly Pin[], bounds: Bounds | null): Pin[] {
  return bounds ? pins.filter((pin) => inBounds(pin, bounds)) : [];
}

/**
 * The cards of the active tab.
 * - `map`: pins inside `bounds`, in the server's order. The selected listing (when its location
 *   is known, from the loaded pins or its card) is prepended, marked `outsideView`, when it
 *   isn't among them.
 * - `favorites`: every favorite id once, in favorite order (search and bounds ignored).
 * - `nolocation`: the loaded no-location ids.
 */
export function computeVisibleItems(input: VisibleInput): VisibleItem[] {
  const { tab, pins, bounds, selectedId } = input;

  if (tab === "nolocation") return input.noLocationIds.map((id) => item(id));

  if (tab === "favorites") return [...new Set(input.favoriteIds)].map((id) => item(id));

  const inView = pinsInView(pins, bounds).map((pin) => item(pin.id, pin));
  if (selectedId === null || inView.some((v) => v.id === selectedId)) return inView;
  const selected =
    pins.find((pin) => pin.id === selectedId) ??
    (input.selectedPin?.id === selectedId ? input.selectedPin : null);
  if (!selected) return inView;
  return [item(selected.id, selected, true), ...inView];
}

/** Tab badge counts: pins in view (without the kept selection), favorites, no-location total. */
export function computeTabCounts(input: {
  pins: readonly Pin[];
  bounds: Bounds | null;
  favoriteIds: readonly string[];
  noLocationTotal: number | null;
}): Record<ListTab, number> {
  return {
    map: pinsInView(input.pins, input.bounds).length,
    favorites: new Set(input.favoriteIds).size,
    nolocation: input.noLocationTotal ?? 0,
  };
}

/** Narrowest list (px, scroll element's client width) that still shows two cards per row. */
export const TWO_COLUMN_MIN_WIDTH = 320;

/** Cards per list row for a list `width` (0 = not measured yet: assume the usual two). */
export function listColumns(width: number): 1 | 2 {
  return width === 0 || width >= TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}

/** `items` grouped into rows of `columns` (the last row may be shorter). */
export function chunkRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Index of the row holding the item with `id`, or -1 when it isn't in the list. */
export function rowIndexOf(items: readonly VisibleItem[], id: string, columns: number): number {
  const index = items.findIndex((entry) => entry.id === id);
  return index < 0 ? -1 : Math.floor(index / Math.max(1, Math.floor(columns)));
}
