"use client";

import { Suspense, useMemo, useState } from "react";

import { ListPanel } from "@/components/list/list-panel";
import { MobileSheet } from "@/components/list/mobile-sheet";
import { ListingsMap } from "@/components/map/listings-map";
import { SearchUrlSync } from "@/components/search-url-sync";
import { SelectionUrlSync } from "@/components/selection-url-sync";
import { StatusText } from "@/components/top-bar/status-text";
import { TopBar } from "@/components/top-bar/top-bar";
import { Spinner } from "@/components/ui-ext/spinner";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { useFavorites } from "@/lib/favorites";
import { pinFromCard } from "@/lib/listings/filter";
import type { Pin } from "@/lib/listings/types";
import { useCards, usePins, useSelectedPin } from "@/lib/queries";
import { useAppliedSearch } from "@/lib/search-params";
import { type ListTab, useMapUi } from "@/lib/store";
import { useIsMobile } from "@/lib/use-media-query";

const NO_IDS: readonly string[] = Object.freeze([]);

/**
 * Which pins the map draws for the active list tab: none on "No location", only the favorites
 * with coordinates on "Favorites", otherwise the loaded pins plus the selected one.
 */
function pinsForTab(
  tab: ListTab,
  pins: readonly Pin[],
  selected: Pin | null,
  favoritePins: readonly Pin[],
): readonly Pin[] {
  if (tab === "nolocation") return [];
  if (tab === "favorites") return favoritePins;
  if (!selected || pins.some((pin) => pin.id === selected.id)) return pins;
  return [...pins, selected];
}

/**
 * Client root: top bar, list panel and map. A static shell: pins come from `/api/pins` for the
 * visible area and card data from `/api/listings?ids=` (TanStack Query, see `@/lib/queries`).
 * Desktop: list on the left, map on the right. Under `md`: the map fills the screen and the list
 * lives in a bottom sheet. The prerendered HTML is the desktop tree; CSS hides the side panel on
 * phones, and after hydration `useIsMobile()` moves the (single) list into the sheet.
 */
export function AppShell() {
  const activeTab = useMapUi((s) => s.activeTab);
  const [search] = useAppliedSearch();
  const favorites = useFavorites();
  const pinsState = usePins();
  const selectedPin = useSelectedPin(search.mode);

  // Favorite cards are only needed (for their pins) while the Favorites tab is open.
  const favoriteCards = useCards(activeTab === "favorites" ? favorites.ids : NO_IDS);
  const favoritePins = useMemo(
    () =>
      favoriteCards.cards.flatMap((card) => {
        const pin = card ? pinFromCard(card, search.mode) : null;
        return pin ? [pin] : [];
      }),
    [favoriteCards.cards, search.mode],
  );

  const pins = useMemo(
    () => pinsForTab(activeTab, pinsState.pins, selectedPin, favoritePins),
    [activeTab, pinsState.pins, selectedPin, favoritePins],
  );
  const mapLoading =
    activeTab === "map"
      ? pinsState.isFetching
      : activeTab === "favorites" && favoriteCards.isLoading;

  const isMobile = useIsMobile();
  const [sheetContainer, setSheetContainer] = useState<HTMLDivElement | null>(null);

  // Rendered in exactly one place (side panel or sheet): card ids must stay unique.
  const listPanel = (
    <ListPanel mode={search.mode} favoriteIds={favorites.ids} onToggleFavorite={favorites.toggle} />
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* URL syncs (`?id=`, search) read the URL on the client; Suspense keeps `/` prerendered. */}
      <Suspense fallback={null}>
        <SelectionUrlSync />
        <SearchUrlSync />
      </Suspense>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[420px] shrink-0 flex-col border-r max-md:hidden">
          {isMobile ? null : listPanel}
        </aside>
        <main className="relative min-w-0 flex-1">
          <ListingsMap
            pins={pins}
            fitReady={!favoriteCards.isLoading}
            mode={search.mode}
            favoriteIds={favorites.idSet}
            compact={isMobile}
          />
          {mapLoading ? (
            <div
              role="status"
              className="pointer-events-none absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-neutral-700 shadow-md ring-1 ring-black/10"
            >
              <Spinner className="size-3.5" />
              Loading…
            </div>
          ) : null}
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
              header={<StatusText inline className="px-4 pt-1" />}
            >
              {listPanel}
            </MobileSheet>
          ) : null}
        </main>
      </div>
      <ImageViewer />
    </div>
  );
}
