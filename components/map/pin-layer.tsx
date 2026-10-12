"use client";

import {
  type Marker,
  MarkerClusterer,
  type onClusterClickHandler,
  type Renderer,
  SuperClusterAlgorithm,
} from "@googlemaps/markerclusterer";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef } from "react";

import { diffPins, pinView, type PinView } from "@/lib/listings/pin-diff";
import type { Pin, PriceMode } from "@/lib/listings/types";
import { type MapUiState, useMapUi } from "@/lib/store";

import { createPinElement, setFlag, updatePinElement } from "./pin-element";

/** Cluster radius in px: markers closer than this (at the current zoom) merge. */
export const CLUSTER_RADIUS = 80;
/** Above this zoom nothing is clustered. */
export const CLUSTER_MAX_ZOOM = 14;

const SELECTED_Z = 1_000_000;
const HIGHLIGHTED_Z = 100_000;

/**
 * The library's own cluster-click handler is attached with `addListener("gmp-click")`, which
 * Maps warns about for Advanced Markers. `null` disables it; the renderer adds a DOM
 * `gmp-click` listener with the same default behaviour (zoom to the cluster's bounds).
 */
const NO_LIBRARY_CLICK = null as unknown as onClusterClickHandler;

/** Dark circle with the count, centered on the cluster position. Click zooms into it. */
const renderer: Renderer = {
  render(cluster, _stats, map) {
    const { count, position } = cluster;
    const size = Math.round(32 + Math.min(20, Math.log2(count) * 4));
    const content = document.createElement("div");
    content.className =
      "flex items-center justify-center rounded-full border-2 border-white/80 bg-neutral-900 text-xs font-semibold text-white shadow-lg ring-4 ring-neutral-900/15 transition-transform hover:scale-110";
    content.style.width = `${String(size)}px`;
    content.style.height = `${String(size)}px`;
    content.style.transform = "translateY(50%)";
    content.textContent = String(count);
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position,
      content,
      title: `${String(count)} listings — click to zoom in`,
      zIndex: 10_000 + count,
      gmpClickable: true,
    });
    marker.addEventListener("gmp-click", () => {
      if (cluster.bounds) map.fitBounds(cluster.bounds);
    });
    return marker;
  },
};

/** Something with a unique own key: never deep-equal to a marker list entry. */
const DIRTY = [{ dirty: Symbol("dirty") }] as unknown as Marker[];

/**
 * `SuperClusterAlgorithm` decides whether the marker set changed with a deep equality check,
 * which can't tell two `AdvancedMarkerElement`s apart (and ignores position changes). The layer
 * calls `invalidate()` whenever it adds, removes or moves a marker, forcing a re-cluster.
 */
class PinClusterAlgorithm extends SuperClusterAlgorithm {
  invalidate() {
    this.markers = DIRTY;
  }
}

type Entry = {
  marker: google.maps.marker.AdvancedMarkerElement;
  el: HTMLElement;
  view: PinView;
};

type PinLayerController = {
  setPins: (views: readonly PinView[]) => void;
  destroy: () => void;
};

const idOf = (event: Event) => (event.currentTarget as HTMLElement).dataset.pinId;

const onPinEnter = (event: Event) => {
  const id = idOf(event);
  if (id) useMapUi.getState().hover(id, "pin");
};
/** Clears the hover only if this pin still owns it (another pin or a card may have taken it). */
const onPinLeave = (event: Event) => {
  const id = idOf(event);
  const state = useMapUi.getState();
  if (state.hoveredId === id && state.hoverSource === "pin") state.hover(null, null);
};
const onMarkerClick = (event: Event) => {
  const marker = event.currentTarget as google.maps.marker.AdvancedMarkerElement;
  const id = (marker.content as HTMLElement | null)?.dataset.pinId;
  if (id) useMapUi.getState().select(id, "pin");
};

const cardHoverId = (state: MapUiState) => (state.hoverSource === "card" ? state.hoveredId : null);

/**
 * The imperative half of `PinLayer`: one `AdvancedMarkerElement` + plain-DOM pill per pin, fed
 * to a `MarkerClusterer`. The selected pin is kept out of the clusterer (always visible).
 * Selection and card-hover states are applied from a store subscription, never via React.
 */
function createPinLayer(
  map: google.maps.Map,
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement,
): PinLayerController {
  const entries = new Map<string, Entry>();
  const views = new Map<string, PinView>();
  const algorithm = new PinClusterAlgorithm({
    radius: CLUSTER_RADIUS,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  const clusterer = new MarkerClusterer({
    map,
    algorithm,
    renderer,
    onClusterClick: NO_LIBRARY_CLICK,
  });
  let selectedId = useMapUi.getState().selectedId;
  let highlightedId = cardHoverId(useMapUi.getState());

  const zIndexOf = (id: string) =>
    id === selectedId ? SELECTED_Z : id === highlightedId ? HIGHLIGHTED_Z : null;

  /**
   * Re-clusters after markers were added/removed/moved. The selected marker is shown after the
   * render: rendering hides single-marker clusters that are no longer in the clusterer, which
   * includes a marker that was just taken out of it for being selected.
   */
  const recluster = () => {
    algorithm.invalidate();
    clusterer.render();
    const selected = selectedId === null ? undefined : entries.get(selectedId);
    if (selected) selected.marker.map = map;
  };

  const create = (view: PinView): Entry => {
    const el = createPinElement(view);
    setFlag(el, "selected", view.id === selectedId);
    setFlag(el, "hovered", view.id === highlightedId);
    const marker = new AdvancedMarkerElement({
      position: { lat: view.lat, lng: view.lng },
      content: el,
      title: view.label,
      gmpClickable: true,
      zIndex: zIndexOf(view.id),
    });
    el.addEventListener("mouseenter", onPinEnter);
    el.addEventListener("mouseleave", onPinLeave);
    marker.addEventListener("gmp-click", onMarkerClick);
    return { marker, el, view };
  };

  const dispose = (entry: Entry) => {
    entry.el.removeEventListener("mouseenter", onPinEnter);
    entry.el.removeEventListener("mouseleave", onPinLeave);
    entry.marker.removeEventListener("gmp-click", onMarkerClick);
    clusterer.removeMarker(entry.marker, true);
    entry.marker.map = null;
  };

  const setPins = (next: readonly PinView[]) => {
    const { add, remove, update } = diffPins(views, next);
    if (add.length === 0 && remove.length === 0 && update.length === 0) return;
    let moved = remove.length > 0 || add.length > 0;
    for (const id of remove) {
      const entry = entries.get(id);
      if (entry) dispose(entry);
      entries.delete(id);
      views.delete(id);
    }
    for (const view of update) {
      const entry = entries.get(view.id);
      if (!entry) continue;
      updatePinElement(entry.el, view);
      entry.marker.title = view.label;
      if (entry.view.lat !== view.lat || entry.view.lng !== view.lng) {
        entry.marker.position = { lat: view.lat, lng: view.lng };
        moved = true;
      }
      entry.view = view;
      views.set(view.id, view);
    }
    for (const view of add) {
      const entry = create(view);
      entries.set(view.id, entry);
      views.set(view.id, view);
      if (view.id !== selectedId) clusterer.addMarker(entry.marker, true);
    }
    if (moved) recluster();
  };

  const setSelected = (id: string | null) => {
    if (id === selectedId) return;
    const previous = selectedId === null ? undefined : entries.get(selectedId);
    selectedId = id;
    const next = id === null ? undefined : entries.get(id);
    if (previous) {
      setFlag(previous.el, "selected", false);
      previous.marker.zIndex = zIndexOf(previous.view.id);
      clusterer.addMarker(previous.marker, true);
    }
    if (next) {
      setFlag(next.el, "selected", true);
      next.marker.zIndex = SELECTED_Z;
      clusterer.removeMarker(next.marker, true);
    }
    if (previous || next) recluster();
  };

  const setHighlighted = (id: string | null) => {
    if (id === highlightedId) return;
    const previous = highlightedId === null ? undefined : entries.get(highlightedId);
    highlightedId = id;
    if (previous) {
      setFlag(previous.el, "hovered", false);
      previous.marker.zIndex = zIndexOf(previous.view.id);
    }
    const next = id === null ? undefined : entries.get(id);
    if (next) {
      setFlag(next.el, "hovered", true);
      next.marker.zIndex = zIndexOf(next.view.id);
    }
  };

  const unsubscribe = useMapUi.subscribe((state, prev) => {
    if (state.selectedId !== prev.selectedId) setSelected(state.selectedId);
    const hovered = cardHoverId(state);
    if (hovered !== cardHoverId(prev)) setHighlighted(hovered);
  });

  return {
    setPins,
    destroy: () => {
      unsubscribe();
      for (const entry of entries.values()) dispose(entry);
      entries.clear();
      views.clear();
      clusterer.clearMarkers(true);
      clusterer.setMap(null);
    },
  };
}

type PinLayerProps = {
  /** Pins to draw (the selected one included). On the Favorites tab: the favorite pins. */
  pins: readonly Pin[];
  mode: PriceMode;
  favoriteIds: ReadonlySet<string>;
};

/**
 * Price pins without a React tree per pin: React only computes the pin views; a single
 * imperative layer (`createPinLayer`) diffs them by id into `AdvancedMarkerElement`s, clusters
 * them (`SuperClusterAlgorithm`, radius 80 px, up to zoom 14) and toggles selection/hover
 * states from store subscriptions. Pin events call the store's `hover(id, "pin")` and
 * `select(id, "pin")`, which the list and the hover preview react to.
 */
export function PinLayer({ pins, mode, favoriteIds }: PinLayerProps) {
  const map = useMap();
  const markerLibrary = useMapsLibrary("marker");
  const controller = useRef<PinLayerController | null>(null);
  const latest = useRef<readonly PinView[]>([]);

  const views = useMemo(
    () => pins.map((pin) => pinView(pin, mode, favoriteIds)),
    [pins, mode, favoriteIds],
  );

  // Declared before the creation effect, so on mount `latest` is set before the layer reads it.
  useEffect(() => {
    latest.current = views;
    controller.current?.setPins(views);
  }, [views]);

  useEffect(() => {
    if (!map || !markerLibrary) return;
    const layer = createPinLayer(map, markerLibrary.AdvancedMarkerElement);
    controller.current = layer;
    layer.setPins(latest.current);
    return () => {
      layer.destroy();
      controller.current = null;
    };
  }, [map, markerLibrary]);

  return null;
}
