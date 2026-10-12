"use client";

import { Suspense, useMemo } from "react";

import { ListingsMap } from "@/components/map/listings-map";
import type { PinListing } from "@/components/map/price-pin";
import { ListPanel } from "@/components/list/list-panel";
import { SearchUrlSync } from "@/components/search-url-sync";
import { SelectionUrlSync } from "@/components/selection-url-sync";
import { TopBar } from "@/components/top-bar/top-bar";
import { applySearch, hasLocation } from "@/lib/listings/filter";
import type { ListingsPayload } from "@/lib/listings/types";
import { useAppliedSearch } from "@/lib/search-params";
import { type ListTab, useMapUi } from "@/lib/store";

/** Favorites arrive in plan 10; until then nobody has any. */
const NO_FAVORITES: ReadonlySet<string> = new Set();
const NO_FAVORITE_IDS: readonly string[] = [];

/** Which pins the map draws for the active list tab. */
function pinsForTab(
  tab: ListTab,
  filtered: readonly PinListing[],
  selected: PinListing | undefined,
): readonly PinListing[] {
  if (tab === "nolocation") return [];
  // Favorites tab is wired in plan 10.
  if (tab === "favorites") return [];
  if (!selected || filtered.some((pin) => pin.id === selected.id)) return filtered;
  return [...filtered, selected];
}

/** Client root: top bar, list panel and map. Receives the whole (cached) payload. */
export function AppShell({ payload }: { payload: ListingsPayload }) {
  const activeTab = useMapUi((s) => s.activeTab);
  const selectedId = useMapUi((s) => s.selectedId);
  const [search] = useAppliedSearch();

  const filtered = useMemo(() => applySearch(payload.listings, search), [payload.listings, search]);
  const filteredPins = useMemo(() => filtered.filter(hasLocation), [filtered]);
  const selected = useMemo(() => {
    const listing = payload.listings.find((item) => item.id === selectedId);
    return listing && hasLocation(listing) ? listing : undefined;
  }, [payload.listings, selectedId]);
  const pins = useMemo(
    () => pinsForTab(activeTab, filteredPins, selected),
    [activeTab, filteredPins, selected],
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
        <aside className="flex w-[420px] shrink-0 flex-col border-r">
          <ListPanel
            listings={payload.listings}
            filtered={filtered}
            mode={search.mode}
            favoriteIds={NO_FAVORITE_IDS}
          />
        </aside>
        <main className="relative min-w-0 flex-1">
          <ListingsMap pins={pins} mode={search.mode} favoriteIds={NO_FAVORITES} />
        </main>
      </div>
    </div>
  );
}
