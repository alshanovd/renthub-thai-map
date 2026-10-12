"use client";

import { useMemo } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ListingSummary, PriceMode } from "@/lib/listings/types";
import { computeTabCounts, computeVisibleItems, type VisibleItem } from "@/lib/listings/visible";
import { type ListTab, useMapUi } from "@/lib/store";

import { ListingCard } from "./listing-card";
import { useScrollToSelected } from "./use-scroll-to-selected";

type ListPanelProps = {
  /** Every listing in the payload. */
  listings: readonly ListingSummary[];
  /** The payload after the applied search. */
  filtered: readonly ListingSummary[];
  mode: PriceMode;
  /** Favorite ids in display order (plan 10). */
  favoriteIds: readonly string[];
  /** Favorites missing from the payload, fetched from `/api/listings/by-ids` (plan 10). */
  extraListings?: readonly ListingSummary[];
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
 * It only *reads* the map bounds; it never moves the map (see `SelectionPan` for card clicks).
 */
export function ListPanel({
  listings,
  filtered,
  mode,
  favoriteIds,
  extraListings,
  onToggleFavorite,
}: ListPanelProps) {
  const activeTab = useMapUi((s) => s.activeTab);
  const setTab = useMapUi((s) => s.setTab);
  const bounds = useMapUi((s) => s.bounds);
  const selectedId = useMapUi((s) => s.selectedId);

  useScrollToSelected();

  const items = useMemo(
    () =>
      computeVisibleItems({
        tab: activeTab,
        listings,
        filtered,
        bounds,
        selectedId,
        favoriteIds,
        extraListings,
      }),
    [activeTab, listings, filtered, bounds, selectedId, favoriteIds, extraListings],
  );
  const counts = useMemo(
    () => computeTabCounts({ listings, filtered, bounds, favoriteIds, extraListings }),
    [listings, filtered, bounds, favoriteIds, extraListings],
  );
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

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
              <span className="text-muted-foreground tabular-nums">
                {tab.value === "map" && bounds === null ? "" : `(${String(counts[tab.value])})`}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {TABS.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="min-h-0 overflow-y-auto overscroll-contain"
        >
          {tab.value === activeTab ? (
            <CardGrid
              items={items}
              mode={mode}
              favoriteSet={favoriteSet}
              onToggleFavorite={onToggleFavorite}
              empty={tab.value === "map" && bounds === null ? "Loading map…" : EMPTY[tab.value]}
            />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CardGrid({
  items,
  mode,
  favoriteSet,
  onToggleFavorite,
  empty,
}: {
  items: readonly VisibleItem[];
  mode: PriceMode;
  favoriteSet: ReadonlySet<string>;
  onToggleFavorite?: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-1 gap-y-2 p-2">
      {items.map(({ listing, outsideView }) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          mode={mode}
          outsideView={outsideView}
          favorite={favoriteSet.has(listing.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}
