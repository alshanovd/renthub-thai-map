"use client";

import { Suspense, useMemo, useState } from "react";

import { ListingsMap } from "@/components/map/listings-map";
import type { PinListing } from "@/components/map/price-pin";
import { ListPanel } from "@/components/list/list-panel";
import { MobileSheet } from "@/components/list/mobile-sheet";
import { SearchUrlSync } from "@/components/search-url-sync";
import { SelectionUrlSync } from "@/components/selection-url-sync";
import { StatusText } from "@/components/top-bar/status-text";
import { TopBar } from "@/components/top-bar/top-bar";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { useFavoriteExtras, useFavorites } from "@/lib/favorites";
import { applySearch, hasLocation } from "@/lib/listings/filter";
import type { ListingSummary, ListingsPayload } from "@/lib/listings/types";
import { useAppliedSearch } from "@/lib/search-params";
import { type ListTab, useMapUi } from "@/lib/store";
import { useIsMobile } from "@/lib/use-media-query";

/**
 * Which pins the map draws for the active list tab: none on "No location", only the favorites
 * with coordinates on "Favorites", otherwise the filtered pins plus the selected one.
 */
function pinsForTab(
  tab: ListTab,
  filtered: readonly PinListing[],
  selected: PinListing | undefined,
  favoritePins: readonly PinListing[],
): readonly PinListing[] {
  if (tab === "nolocation") return [];
  if (tab === "favorites") return favoritePins;
  if (!selected || filtered.some((pin) => pin.id === selected.id)) return filtered;
  return [...filtered, selected];
}

/**
 * Client root: top bar, list panel and map. Receives the whole (cached) payload.
 * Desktop: list on the left, map on the right. Under `md`: the map fills the screen and the list
 * lives in a bottom sheet. The prerendered HTML is the desktop tree; CSS hides the side panel on
 * phones, and after hydration `useIsMobile()` moves the (single) list into the sheet.
 */
export function AppShell({ payload }: { payload: ListingsPayload }) {
  const activeTab = useMapUi((s) => s.activeTab);
  const selectedId = useMapUi((s) => s.selectedId);
  const [search] = useAppliedSearch();
  const favorites = useFavorites();
  const extraListings = useFavoriteExtras(favorites.ids, payload.listings);

  /** Payload plus fetched favorites (for the viewer and the favorite pins). */
  const listingsById = useMemo(() => {
    const byId = new Map<string, ListingSummary>();
    for (const listing of extraListings) byId.set(listing.id, listing);
    for (const listing of payload.listings) byId.set(listing.id, listing);
    return byId;
  }, [payload.listings, extraListings]);
  const favoritePins = useMemo(
    () =>
      favorites.ids.flatMap((id) => {
        const listing = listingsById.get(id);
        return listing && hasLocation(listing) ? [listing] : [];
      }),
    [favorites.ids, listingsById],
  );

  const filtered = useMemo(() => applySearch(payload.listings, search), [payload.listings, search]);
  const filteredPins = useMemo(() => filtered.filter(hasLocation), [filtered]);
  const selected = useMemo(() => {
    const listing = payload.listings.find((item) => item.id === selectedId);
    return listing && hasLocation(listing) ? listing : undefined;
  }, [payload.listings, selectedId]);
  const pins = useMemo(
    () => pinsForTab(activeTab, filteredPins, selected, favoritePins),
    [activeTab, filteredPins, selected, favoritePins],
  );

  const isMobile = useIsMobile();
  const [sheetContainer, setSheetContainer] = useState<HTMLDivElement | null>(null);

  // Rendered in exactly one place (side panel or sheet): card ids must stay unique.
  const listPanel = (
    <ListPanel
      listings={payload.listings}
      filtered={filtered}
      mode={search.mode}
      favoriteIds={favorites.ids}
      extraListings={extraListings}
      onToggleFavorite={favorites.toggle}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* URL syncs (`?id=`, search) read the URL on the client; Suspense keeps `/` prerendered. */}
      <Suspense fallback={null}>
        <SelectionUrlSync />
        <SearchUrlSync />
      </Suspense>
      <TopBar listings={payload.listings} filtered={filtered} lastScrapeAt={payload.lastScrapeAt} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[420px] shrink-0 flex-col border-r max-md:hidden">
          {isMobile ? null : listPanel}
        </aside>
        <main className="relative min-w-0 flex-1">
          <ListingsMap
            pins={pins}
            mode={search.mode}
            favoriteIds={favorites.idSet}
            compact={isMobile}
          />
          {isMobile ? (
            // `overflow-clip`: the sheet's off-screen part must not make anything scrollable.
            <div
              ref={setSheetContainer}
              className="pointer-events-none absolute inset-0 z-10 overflow-clip"
            />
          ) : null}
          {isMobile && sheetContainer ? (
            <MobileSheet
              container={sheetContainer}
              header={
                <StatusText
                  inline
                  listings={payload.listings}
                  filtered={filtered}
                  lastScrapeAt={payload.lastScrapeAt}
                  className="px-4 pt-1"
                />
              }
            >
              {listPanel}
            </MobileSheet>
          ) : null}
        </main>
      </div>
      <ImageViewer listingsById={listingsById} />
    </div>
  );
}
