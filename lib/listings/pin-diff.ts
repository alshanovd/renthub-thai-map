import { formatPinPrice } from "./format";
import type { Pin, PriceMode } from "./types";

/** Everything a drawn pin shows, derived from a `Pin`, the price mode and the favorites. */
export type PinView = {
  id: string;
  lat: number;
  lng: number;
  /** Price label: `฿500`, `฿7.5k`, `Call`. */
  label: string;
  /** Shows the ♥ badge. */
  favorite: boolean;
  /** A soft-deleted favorite: drawn greyed out and struck through. */
  muted: boolean;
};

export function pinView(pin: Pin, mode: PriceMode, favoriteIds: ReadonlySet<string>): PinView {
  const favorite = favoriteIds.has(pin.id);
  return {
    id: pin.id,
    lat: pin.lat,
    lng: pin.lng,
    label: formatPinPrice(pin.price, pin.kind, mode),
    favorite,
    muted: favorite && pin.deleted === true,
  };
}

export type PinDiff = {
  /** New ids, in input order. */
  add: PinView[];
  /** Ids no longer present. */
  remove: string[];
  /** Kept ids whose view changed (label, position, favorite or muted). */
  update: PinView[];
};

const sameView = (a: PinView, b: PinView) =>
  a.lat === b.lat &&
  a.lng === b.lng &&
  a.label === b.label &&
  a.favorite === b.favorite &&
  a.muted === b.muted;

/**
 * Diffs the drawn pins (`prev`, by id) against the next pin views. Duplicate ids in `next` keep
 * the first occurrence. Unchanged pins appear in no list.
 */
export function diffPins(prev: ReadonlyMap<string, PinView>, next: readonly PinView[]): PinDiff {
  const add: PinView[] = [];
  const update: PinView[] = [];
  const seen = new Set<string>();
  for (const view of next) {
    if (seen.has(view.id)) continue;
    seen.add(view.id);
    const before = prev.get(view.id);
    if (!before) add.push(view);
    else if (!sameView(before, view)) update.push(view);
  }
  const remove: string[] = [];
  for (const id of prev.keys()) if (!seen.has(id)) remove.push(id);
  return { add, remove, update };
}
