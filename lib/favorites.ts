import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { ListingSummary } from "@/lib/listings/types";

export const FAVORITES_KEY = "renthub-map:favorites:v1";

/** One favorite as persisted in localStorage. `addedAt` is epoch milliseconds. */
export type FavoriteEntry = { id: string; addedAt: number };

/** The subset of `Storage` the store needs (injectable for tests). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export type FavoritesStore = {
  subscribe: (listener: () => void) => () => void;
  /** Entries, newest first. Stable reference until the favorites change. */
  getSnapshot: () => readonly FavoriteEntry[];
  getServerSnapshot: () => readonly FavoriteEntry[];
  toggle: (id: string) => void;
  isFavorite: (id: string) => boolean;
};

const EMPTY: readonly FavoriteEntry[] = Object.freeze([]);

const isEntry = (value: unknown): value is FavoriteEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as FavoriteEntry).id === "string" &&
  (value as FavoriteEntry).id.length > 0 &&
  typeof (value as FavoriteEntry).addedAt === "number" &&
  Number.isFinite((value as FavoriteEntry).addedAt);

/** Parses the stored JSON; anything malformed recovers to an empty list. Newest first, deduped. */
export function parseFavorites(raw: string | null): FavoriteEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const entries: FavoriteEntry[] = [];
  for (const value of data) {
    if (!isEntry(value) || seen.has(value.id)) continue;
    seen.add(value.id);
    entries.push({ id: value.id, addedAt: value.addedAt });
  }
  return entries.toSorted((a, b) => b.addedAt - a.addedAt);
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A favorites store backed by `storage` (localStorage by default). Every access is wrapped in
 * try/catch; when storage is unavailable or throws, favorites live in memory for this page load.
 * Other tabs' changes arrive through the `storage` event.
 */
export function createFavoritesStore(
  getStorage: () => KeyValueStorage | null = defaultStorage,
  now: () => number = Date.now,
): FavoritesStore {
  let entries: readonly FavoriteEntry[] | null = null;
  let ids = new Set<string>();
  const listeners = new Set<() => void>();

  const set = (next: readonly FavoriteEntry[]) => {
    entries = next;
    ids = new Set(next.map((entry) => entry.id));
  };

  const read = (): readonly FavoriteEntry[] => {
    if (entries === null) {
      let raw: string | null = null;
      try {
        raw = getStorage()?.getItem(FAVORITES_KEY) ?? null;
      } catch {
        raw = null;
      }
      set(parseFavorites(raw));
    }
    return entries ?? EMPTY;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== FAVORITES_KEY) return;
    entries = null; // re-read lazily
    emit();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    getSnapshot: read,
    getServerSnapshot: () => EMPTY,
    isFavorite: (id) => {
      read();
      return ids.has(id);
    },
    toggle(id) {
      const current = read();
      const next = ids.has(id)
        ? current.filter((entry) => entry.id !== id)
        : [{ id, addedAt: Math.max(now(), (current[0]?.addedAt ?? 0) + 1) }, ...current];
      set(next);
      try {
        getStorage()?.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        // Quota exceeded or storage blocked: keep the in-memory state.
      }
      emit();
    },
  };
}

/** The app-wide favorites store (localStorage `renthub-map:favorites:v1`). */
export const favoritesStore = createFavoritesStore();

export type Favorites = {
  /** Favorite ids, newest added first. */
  ids: readonly string[];
  idSet: ReadonlySet<string>;
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => void;
};

/** Favorites hook. SSR-safe: renders with no favorites on the server and during hydration. */
export function useFavorites(store: FavoritesStore = favoritesStore): Favorites {
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const isFavorite = useCallback((id: string) => idSet.has(id), [idSet]);
  return { ids, idSet, isFavorite, toggle: store.toggle };
}

const LISTING_ID = /^[\w-]{1,64}$/;
const BY_IDS_LIMIT = 200;

/**
 * Favorites missing from the payload (soft-deleted or newer than the cache), resolved once via
 * `/api/listings/by-ids` and kept in memory for the page's lifetime. `null` = unknown id.
 */
const extrasCache = new Map<string, ListingSummary | null>();
const extrasInFlight = new Set<string>();

async function fetchExtras(ids: readonly string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += BY_IDS_LIMIT) {
    const chunk = ids.slice(start, start + BY_IDS_LIMIT);
    for (const id of chunk) extrasInFlight.add(id);
    try {
      const response = await fetch(`/api/listings/by-ids?ids=${chunk.join(",")}`);
      if (!response.ok) continue;
      const listings = (await response.json()) as ListingSummary[];
      for (const listing of listings) extrasCache.set(listing.id, listing);
      for (const id of chunk) if (!extrasCache.has(id)) extrasCache.set(id, null);
    } catch {
      // Offline or server error: try again the next time the favorites change.
    } finally {
      for (const id of chunk) extrasInFlight.delete(id);
    }
  }
}

/**
 * Favorite listings that aren't in `listings` (the payload), fetched once per id from
 * `/api/listings/by-ids`. Returned in `ids` order; ids that can't be resolved are left out.
 */
export function useFavoriteExtras(
  ids: readonly string[],
  listings: readonly ListingSummary[],
): readonly ListingSummary[] {
  const payloadIds = useMemo(() => new Set(listings.map((listing) => listing.id)), [listings]);
  const missing = useMemo(() => ids.filter((id) => !payloadIds.has(id)), [ids, payloadIds]);
  const [resolved, setResolved] = useState<ReadonlyMap<string, ListingSummary | null>>(
    () => new Map(extrasCache),
  );

  useEffect(() => {
    const toFetch = missing.filter(
      (id) => LISTING_ID.test(id) && !extrasCache.has(id) && !extrasInFlight.has(id),
    );
    if (toFetch.length === 0) return;
    void fetchExtras(toFetch).then(() => setResolved(new Map(extrasCache)));
  }, [missing]);

  return useMemo(
    () =>
      missing.flatMap((id) => {
        const listing = resolved.get(id);
        return listing ? [listing] : [];
      }),
    [missing, resolved],
  );
}
