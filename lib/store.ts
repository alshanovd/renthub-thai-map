import { create } from "zustand";

/** Visible map area, as `google.maps.LatLngBoundsLiteral`. */
export type Bounds = { north: number; south: number; east: number; west: number };

export type SelectSource = "pin" | "card" | "url";
export type HoverSource = "pin" | "card";
export type ListTab = "map" | "favorites" | "nolocation";

export type MapUiState = {
  /** Updated by the map on `idle` (debounced); the list only reads it. */
  bounds: Bounds | null;
  setBounds: (bounds: Bounds | null) => void;
  selectedId: string | null;
  /** Where the current selection came from (drives "scroll card into view" only after a pin click). */
  selectSource: SelectSource | null;
  select: (id: string | null, source: SelectSource | null) => void;
  hoveredId: string | null;
  hoverSource: HoverSource | null;
  hover: (id: string | null, source: HoverSource | null) => void;
  activeTab: ListTab;
  setTab: (tab: ListTab) => void;
};

/** Single source of truth for interactive map/list UI state. */
export const useMapUi = create<MapUiState>()((set) => ({
  bounds: null,
  setBounds: (bounds) => set({ bounds }),
  selectedId: null,
  selectSource: null,
  select: (id, source) => set({ selectedId: id, selectSource: id === null ? null : source }),
  hoveredId: null,
  hoverSource: null,
  hover: (id, source) => set({ hoveredId: id, hoverSource: id === null ? null : source }),
  activeTab: "map",
  setTab: (activeTab) => set({ activeTab }),
}));
