import { createParser, createSerializer, parseAsInteger, parseAsStringLiteral } from "nuqs";
import { create } from "zustand";

import { DEFAULT_SEARCH, type Search, type SortOrder } from "@/lib/listings/filter";
import type { PriceMode } from "@/lib/listings/types";

/** Slider range per mode. Values at `max` mean "no upper limit" (`Infinity`). */
export const PRICE_RANGE: Record<
  PriceMode,
  { min: number; max: number; step: number; default: number }
> = {
  day: { min: 100, max: 3000, step: 50, default: 800 },
  month: { min: 2000, max: 60_000, step: 500, default: 15_000 },
};

export const SORT_ORDERS = ["price-asc", "price-desc", "updated"] as const satisfies SortOrder[];
const MODES = ["day", "month"] as const satisfies PriceMode[];

/** `call=1` / `call=0` (also accepts `true` / `false`). */
const parseAsFlag = createParser<boolean>({
  parse: (value) => {
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return null;
  },
  serialize: (value) => (value ? "1" : "0"),
});

/**
 * `nuqs` parsers for the applied search. They have no defaults on purpose: `max`'s default
 * depends on `mode`, so defaults and clamping are applied by `searchFromUrl` / `searchToUrl`.
 */
export const searchParsers = {
  mode: parseAsStringLiteral(MODES),
  max: parseAsInteger,
  call: parseAsFlag,
  sort: parseAsStringLiteral(SORT_ORDERS),
};

/** Client-only URL updates: no history entries, no server round trip. */
export const searchUrlOptions = { history: "replace", shallow: true } as const;

/** The search as read from / written to the URL; `null` means "absent" (the default). */
export type UrlSearch = {
  mode: PriceMode | null;
  max: number | null;
  call: boolean | null;
  sort: SortOrder | null;
};

/** Clamps `max` to the mode's range; the top of the range (or above) means no limit. */
export function clampMax(max: number, mode: PriceMode): number {
  const range = PRICE_RANGE[mode];
  if (Number.isNaN(max)) return range.default;
  if (max >= range.max) return Number.POSITIVE_INFINITY;
  return Math.max(range.min, Math.round(max));
}

/** Fills in defaults (mode-dependent `max`) and clamps `max`. */
export function searchFromUrl(url: UrlSearch): Search {
  const mode = url.mode ?? DEFAULT_SEARCH.mode;
  return {
    mode,
    max: url.max === null ? PRICE_RANGE[mode].default : clampMax(url.max, mode),
    call: url.call ?? DEFAULT_SEARCH.call,
    sort: url.sort ?? DEFAULT_SEARCH.sort,
  };
}

/**
 * Leaves defaults out of the URL. "No limit" (`Infinity`) is written as the top of the range
 * (`max=3000` / `max=60000`), because an absent `max` already means the mode's default.
 */
export function searchToUrl(search: Search): UrlSearch {
  const { mode } = search;
  const max = clampMax(search.max, mode);
  return {
    mode: mode === DEFAULT_SEARCH.mode ? null : mode,
    max:
      max === PRICE_RANGE[mode].default
        ? null
        : max === Number.POSITIVE_INFINITY
          ? PRICE_RANGE[mode].max
          : max,
    call: search.call === DEFAULT_SEARCH.call ? null : search.call,
    sort: search.sort === DEFAULT_SEARCH.sort ? null : search.sort,
  };
}

/** Query string for a search, e.g. `?mode=month&max=60000&call=1` (`""` for the defaults). */
export const serializeSearch = createSerializer(searchParsers);

/** Normalizes a search (clamped `max`), so equal searches compare equal. */
export function normalizeSearch(search: Search): Search {
  return { ...search, max: clampMax(search.max, search.mode) };
}

/** True when two searches select and order the same listings (`Infinity === Infinity` holds). */
export function sameSearch(a: Search, b: Search): boolean {
  return (
    a.mode === b.mode &&
    a.call === b.call &&
    a.sort === b.sort &&
    clampMax(a.max, a.mode) === clampMax(b.max, b.mode)
  );
}

export function isDefaultSearch(search: Search): boolean {
  return sameSearch(search, DEFAULT_SEARCH);
}

type AppliedSearchStore = { search: Search; setSearch: (search: Search) => void };

/**
 * Mirror of the URL's applied search, kept in sync by `SearchUrlSync` (nuqs, under
 * `<Suspense>`). Reading it from a store instead of calling `useQueryStates` everywhere keeps
 * the app shell outside the Suspense boundary, so `/` stays prerendered.
 */
const useAppliedSearchStore = create<AppliedSearchStore>()((set, get) => ({
  search: DEFAULT_SEARCH,
  setSearch: (next) => {
    const search = normalizeSearch(next);
    if (!sameSearch(search, get().search)) set({ search });
  },
}));

/** The applied search and its setter (the URL follows via `SearchUrlSync`). */
export function useAppliedSearch(): [Search, (search: Search) => void] {
  const search = useAppliedSearchStore((s) => s.search);
  const setSearch = useAppliedSearchStore((s) => s.setSearch);
  return [search, setSearch];
}

/** Non-reactive access for sync code. */
export const appliedSearchStore = useAppliedSearchStore;
