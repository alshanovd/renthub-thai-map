import { create } from "zustand";

/** Visible map area, as `google.maps.LatLngBoundsLiteral`. */
export type Bounds = { north: number; south: number; east: number; west: number };

export type SelectSource = "pin" | "card" | "url";
export type HoverSource = "pin" | "card";
export type ListTab = "map" | "favorites" | "nolocation";

/**
 * A one-shot camera request created by a card click or a `?id=` deep link, consumed by the map.
 * `always`: pan even if the pin is already visible (deep link); otherwise only when off-screen.
 */
export type PanRequest = { id: string; always: boolean };

/** Fullscreen photo viewer target (rendered by plan 10). */
export type ViewerTarget = { listingId: string; index: number };

export type MapUiState = {
  /** Updated by the map on `idle` (debounced); the list only reads it. */
  bounds: Bounds | null;
  setBounds: (bounds: Bounds | null) => void;
  selectedId: string | null;
  /**
   * Where the current selection came from. `"pin"`/`"url"` ask the list to scroll the card into
   * view once; the list then calls `consumeSelectSource()`.
   */
  selectSource: SelectSource | null;
  select: (id: string | null, source: SelectSource | null) => void;
  consumeSelectSource: () => void;
  /** Set by `select` for card clicks and deep links; the map pans (or not) and consumes it. */
  pendingPan: PanRequest | null;
  /** `moved`: the camera is moving, so the bounds are stale until the next `setBounds`. */
  consumePan: (moved: boolean) => void;
  /** True between a pan and the bounds it produces (see `consumePan`). */
  awaitingBounds: boolean;
  hoveredId: string | null;
  hoverSource: HoverSource | null;
  hover: (id: string | null, source: HoverSource | null) => void;
  activeTab: ListTab;
  setTab: (tab: ListTab) => void;
  viewer: ViewerTarget | null;
  openViewer: (listingId: string, index: number) => void;
  closeViewer: () => void;
};

/** Single source of truth for interactive map/list UI state. */
export const useMapUi = create<MapUiState>()((set) => ({
  bounds: null,
  setBounds: (bounds) => set({ bounds, awaitingBounds: false }),
  selectedId: null,
  selectSource: null,
  select: (id, source) =>
    set({
      selectedId: id,
      selectSource: id === null ? null : source,
      pendingPan:
        id !== null && (source === "card" || source === "url")
          ? { id, always: source === "url" }
          : null,
    }),
  consumeSelectSource: () => set({ selectSource: null }),
  pendingPan: null,
  consumePan: (moved) => set({ pendingPan: null, awaitingBounds: moved }),
  awaitingBounds: false,
  hoveredId: null,
  hoverSource: null,
  hover: (id, source) => set({ hoveredId: id, hoverSource: id === null ? null : source }),
  activeTab: "map",
  setTab: (activeTab) => set({ activeTab }),
  viewer: null,
  openViewer: (listingId, index) => set({ viewer: { listingId, index } }),
  closeViewer: () => set({ viewer: null }),
}));
