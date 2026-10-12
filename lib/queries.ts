"use client";

import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchNoLocationPage, fetchPins, loadCard } from "@/lib/api-client";
import { bboxToParam, searchToParams, snapBounds } from "@/lib/listings/api-params";
import { pinFromCard, type Search } from "@/lib/listings/filter";
import type { ListingCard, Pin, PriceMode } from "@/lib/listings/types";
import { useAppliedSearch } from "@/lib/search-params";
import { useMapUi } from "@/lib/store";

/** Zoom used for the pins grid if the map hasn't reported one (it always does with bounds). */
const FALLBACK_ZOOM = 13;

/** Per-id card cache key, shared by list cards, the preview, the viewer and favorites. */
export const cardKey = (id: string) => ["card", id] as const;

const cardQuery = (id: string) => ({
  queryKey: cardKey(id),
  queryFn: ({ signal }: { signal: AbortSignal }) => loadCard(id, signal),
});

/** Canonical string of a search (all four API params), used in query keys. */
const searchKey = (search: Search) => searchToParams(search).toString();

/** Card data of one listing (`null` data = unknown id). Disabled for a null id. */
export function useCard(id: string | null): UseQueryResult<ListingCard | null> {
  return useQuery({
    queryKey: cardKey(id ?? ""),
    queryFn: ({ signal }) => loadCard(id ?? "", signal),
    enabled: id !== null,
  });
}

/** Non-reactive read of a cached card (undefined when not loaded). */
export function cachedCard(queryClient: QueryClient, id: string): ListingCard | null | undefined {
  return queryClient.getQueryData<ListingCard | null>(cardKey(id));
}

export type CardsResult = {
  /** In input order: a card, `null` (unknown id) or `undefined` (not loaded yet / failed). */
  cards: (ListingCard | null | undefined)[];
  /** True while any id has no data yet. */
  isLoading: boolean;
};

const combineCards = (results: UseQueryResult<ListingCard | null>[]): CardsResult => ({
  cards: results.map((result) => result.data),
  isLoading: results.some((result) => result.isPending),
});

/** Card data of several listings, through the same per-id cache entries as `useCard`. */
export function useCards(ids: readonly string[]): CardsResult {
  return useQueries({ queries: ids.map(cardQuery), combine: combineCards });
}

export type PinsState = {
  /** Pins of the expanded, snapped bbox in the server's sort order (empty until loaded). */
  pins: readonly Pin[];
  /** Filtered listings with coordinates in the whole DB; null until loaded. */
  total: number | null;
  noLocationTotal: number | null;
  lastScrapeAt: string | null;
  /** True once a pins response (for any area/search) is shown. */
  loaded: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
};

const NO_PINS: readonly Pin[] = Object.freeze([]);

/**
 * Pins for the visible map area and the applied search. The bbox is the visible bounds expanded
 * and snapped to a zoom-dependent grid, so small pans reuse the cached request; a changed key
 * aborts the superseded request. Disabled until the map reports its first bounds, and when the
 * view doesn't overlap Thailand (no pins then).
 */
export function usePins(): PinsState {
  const bounds = useMapUi((s) => s.bounds);
  const zoom = useMapUi((s) => s.zoom);
  const [search] = useAppliedSearch();
  const snapped = useMemo(
    () => (bounds ? snapBounds(bounds, zoom ?? FALLBACK_ZOOM) : null),
    [bounds, zoom],
  );
  const bboxParam = snapped ? bboxToParam(snapped) : null;

  const query = useQuery({
    queryKey: ["pins", bboxParam, searchKey(search)],
    queryFn: ({ signal }) => {
      if (!snapped) throw new Error("pins requested without a bbox");
      return fetchPins({ bbox: snapped, search }, signal);
    },
    enabled: snapped !== null,
    placeholderData: keepPreviousData,
  });

  const { data, isFetching, error, refetch } = query;
  const outside = bounds !== null && snapped === null;
  return {
    pins: outside || !data ? NO_PINS : data.pins,
    total: data?.total ?? null,
    noLocationTotal: data?.noLocationTotal ?? null,
    lastScrapeAt: data?.lastScrapeAt ?? null,
    loaded: data !== undefined || outside,
    isFetching,
    error: data === undefined ? error : null,
    refetch: () => void refetch(),
  };
}

/**
 * Pages of filtered listings without coordinates (the No location tab), enabled only while
 * that tab is active. Each page's cards are also put in the per-id card cache (viewer, preview).
 */
export function useNoLocation(search: Search, enabled: boolean) {
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: ["nolocation", searchKey(search)],
    queryFn: async ({ pageParam, signal }) => {
      const page = await fetchNoLocationPage({ search, cursor: pageParam }, signal);
      for (const card of page.listings) queryClient.setQueryData(cardKey(card.id), card);
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** The selected listing as a pin (from its card data), null when unknown or without location. */
export function useSelectedPin(mode: PriceMode): Pin | null {
  const selectedId = useMapUi((s) => s.selectedId);
  const { data } = useCard(selectedId);
  return useMemo(() => (data ? pinFromCard(data, mode) : null), [data, mode]);
}
