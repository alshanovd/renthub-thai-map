"use client";

import {
  MarkerClusterer,
  type onClusterClickHandler,
  type Renderer,
} from "@googlemaps/markerclusterer";
import { useMap } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PriceMode } from "@/lib/listings/types";

import { type PinListing, PricePin } from "./price-pin";

type Markers = Record<string, google.maps.marker.AdvancedMarkerElement>;

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
      "flex items-center justify-center rounded-full bg-neutral-900/90 text-xs font-semibold text-white shadow-lg ring-4 ring-neutral-900/20 transition-transform hover:scale-110";
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

type ClusteredPinsProps = {
  pins: readonly PinListing[];
  mode: PriceMode;
  favoriteIds: ReadonlySet<string>;
  selectedId: string | null;
};

/**
 * Price pins clustered with `@googlemaps/markerclusterer` (pattern from the
 * `@vis.gl/react-google-maps` clustering example). The selected pin is rendered outside the
 * clusterer so it is never hidden in a cluster.
 */
export function ClusteredPins({ pins, mode, favoriteIds, selectedId }: ClusteredPinsProps) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const [markers, setMarkers] = useState<Markers>({});

  // Created in an effect (not useMemo) so React strict mode's mount/unmount/mount cycle
  // leaves exactly one live clusterer attached to the map.
  useEffect(() => {
    if (!map) return;
    const clusterer = new MarkerClusterer({ map, renderer, onClusterClick: NO_LIBRARY_CLICK });
    clustererRef.current = clusterer;
    return () => {
      clusterer.clearMarkers(true);
      clusterer.setMap(null);
      clustererRef.current = null;
    };
  }, [map]);

  // Re-sync whenever the set of mounted markers changes.
  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!clusterer) return;
    clusterer.clearMarkers(true);
    clusterer.addMarkers(Object.values(markers));
  }, [markers]);

  const setMarkerRef = useCallback(
    (marker: google.maps.marker.AdvancedMarkerElement | null, id: string) => {
      setMarkers((current) => {
        if ((marker && current[id] === marker) || (!marker && !current[id])) return current;
        if (marker) return { ...current, [id]: marker };
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
    },
    [],
  );

  const selected = selectedId === null ? undefined : pins.find((pin) => pin.id === selectedId);

  return (
    <>
      {pins.map((pin) =>
        pin.id === selectedId ? null : (
          <PricePin
            key={pin.id}
            listing={pin}
            mode={mode}
            favorite={favoriteIds.has(pin.id)}
            selected={false}
            setMarkerRef={setMarkerRef}
          />
        ),
      )}
      {selected ? (
        <PricePin
          key={`selected-${selected.id}`}
          listing={selected}
          mode={mode}
          favorite={favoriteIds.has(selected.id)}
          selected
        />
      ) : null}
    </>
  );
}
