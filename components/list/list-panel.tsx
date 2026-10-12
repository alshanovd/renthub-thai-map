"use client";

import { RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui-ext/spinner";
import type { PriceMode } from "@/lib/listings/types";
import { computeTabCounts, computeVisibleItems, type VisibleItem } from "@/lib/listings/visible";
import { useNoLocation, usePins, useSelectedPin } from "@/lib/queries";
import { useAppliedSearch } from "@/lib/search-params";
import { type ListTab, useMapUi } from "@/lib/store";

import { ListingCard } from "./listing-card";
import { useScrollToSelected } from "./use-scroll-to-selected";

type ListPanelProps = {
  mode: PriceMode;
  /** Favorite ids in display order (newest added first). */
  favoriteIds: readonly string[];
  onToggleFavorite?: (id: string) => void;
};

const TABS: { value: ListTab; label: string }[] = [
  { value: "map", label: "On map" },
  { value: "favorites", label: "Favorites" },
  { value: "nolocation", label: "No location" },
];

const EMPTY: Record<ListTab, string> = {
  map: "Nothing in this area. Zoom out or raise the max price.",
  favorites: "No favorites yet. Tap ♥ on a listing to keep it here.",
  nolocation: "Every listing that matches the search has a location.",
};

const isListTab = (value: string): value is ListTab => TABS.some((tab) => tab.value === value);

/**
 * Left panel: tabs "On map" / "Favorites" / "No location" and the cards of the active tab.
 * Card ids come from the pins (On map), the favorites, or the no-location pages; each card
 * fetches its own data. It only *reads* the map bounds; it never moves the map.
 */
export function ListPanel({ mode, favoriteIds, onToggleFavorite }: ListPanelProps) {
  const activeTab = useMapUi((s) => s.activeTab);
  const setTab = useMapUi((s) => s.setTab);
  const bounds = useMapUi((s) => s.bounds);
  const selectedId = useMapUi((s) => s.selectedId);
  const [search] = useAppliedSearch();
  const pinsState = usePins();
  const selectedPin = useSelectedPin(mode);
  const noLocation = useNoLocation(search, activeTab === "nolocation");

  useScrollToSelected(pinsState.loaded && !pinsState.isFetching);

  const noLocationIds = useMemo(
    () => noLocation.data?.pages.flatMap((page) => page.listings.map((card) => card.id)) ?? [],
    [noLocation.data],
  );
  const items = useMemo(
    () =>
      computeVisibleItems({
        tab: activeTab,
        pins: pinsState.pins,
        bounds,
        selectedId,
        selectedPin,
        favoriteIds,
        noLocationIds,
      }),
    [activeTab, pinsState.pins, bounds, selectedId, selectedPin, favoriteIds, noLocationIds],
  );
  const counts = useMemo(
    () =>
      computeTabCounts({
        pins: pinsState.pins,
        bounds,
        favoriteIds,
        noLocationTotal: pinsState.noLocationTotal,
      }),
    [pinsState.pins, bounds, favoriteIds, pinsState.noLocationTotal],
  );
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  /** Shown instead of the grid when it's empty and the reason is loading, not "no results". */
  const loadingText = (tab: ListTab): string | null => {
    if (tab === "map") {
      if (bounds === null) return "Loading map…";
      // Also while a pan/filter refetch runs: the old pins may simply not cover the new view.
      if (!pinsState.loaded || pinsState.isFetching) return "Loading listings…";
    }
    if (tab === "nolocation" && noLocation.isPending) return "Loading listings…";
    return null;
  };

  const countLabel = (tab: ListTab): string => {
    if (tab === "map" && (bounds === null || !pinsState.loaded)) return "";
    if (tab === "nolocation" && pinsState.noLocationTotal === null) return "";
    return `(${String(counts[tab])})`;
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (isListTab(value)) setTab(value);
      }}
      className="h-full min-h-0 gap-0"
    >
      <div className="shrink-0 border-b p-2">
        <TabsList className="w-full">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              <span className="text-muted-foreground tabular-nums">{countLabel(tab.value)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {pinsState.error ? (
          <p
            role="alert"
            className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
          >
            Couldn&apos;t load listings ·
            <button
              type="button"
              onClick={pinsState.refetch}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <RotateCw className="size-3" aria-hidden />
              Retry
            </button>
          </p>
        ) : null}
      </div>
      {TABS.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="min-h-0 overflow-y-auto overscroll-contain"
          data-list-scroller
        >
          {tab.value === activeTab ? (
            <CardGrid
              items={items}
              markNoLocation={tab.value === "favorites"}
              mode={mode}
              favoriteSet={favoriteSet}
              onToggleFavorite={onToggleFavorite}
              loading={loadingText(tab.value)}
              empty={EMPTY[tab.value]}
              footer={
                tab.value === "nolocation" && noLocation.hasNextPage ? (
                  <LoadMore
                    loading={noLocation.isFetchingNextPage}
                    onVisible={() => {
                      if (!noLocation.isFetchingNextPage) void noLocation.fetchNextPage();
                    }}
                  />
                ) : null
              }
            />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CardGrid({
  items,
  markNoLocation,
  mode,
  favoriteSet,
  onToggleFavorite,
  loading,
  empty,
  footer,
}: {
  items: readonly VisibleItem[];
  /** Chip "No location" on cards without coordinates (Favorites tab). */
  markNoLocation: boolean;
  mode: PriceMode;
  favoriteSet: ReadonlySet<string>;
  onToggleFavorite?: (id: string) => void;
  /** Loading text when there's nothing to show yet; null when loaded. */
  loading: string | null;
  empty: string;
  footer?: ReactNode;
}) {
  if (items.length === 0) {
    if (loading !== null) {
      return (
        <div
          role="status"
          aria-busy="true"
          className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
        >
          <Spinner />
          {loading}
        </div>
      );
    }
    return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-x-1 gap-y-2 p-2">
        {items.map(({ id, pin, outsideView }) => (
          <ListingCard
            key={id}
            id={id}
            pin={pin}
            mode={mode}
            outsideView={outsideView}
            favorite={favoriteSet.has(id)}
            markNoLocation={markNoLocation}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
      {footer}
    </>
  );
}

/** Infinite-scroll sentinel: asks for the next page when it nears the visible area. */
function LoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  });
  // Re-observed after each page: a sentinel that stays in view must trigger the next page too.
  useEffect(() => {
    const element = ref.current;
    if (!element || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);
  return (
    <div
      ref={ref}
      role="status"
      aria-busy={loading}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      {loading ? (
        <>
          <Spinner />
          Loading more…
        </>
      ) : null}
    </div>
  );
}
