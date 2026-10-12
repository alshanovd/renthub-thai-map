"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useEffectEvent, useRef } from "react";

import { useMapUi } from "@/lib/store";

import type { PinListing } from "./price-pin";

const FIT_PADDING = 64;
const SINGLE_ZOOM = 15;
/** Favorites close together shouldn't zoom in further than this. */
const MAX_FIT_ZOOM = 16;

/**
 * Fits the map to the favorite pins once, when the Favorites tab is activated. Later changes
 * (toggling a favorite, a fetched soft-deleted favorite arriving) never move the camera.
 * One favorite: pan to it at zoom 15. Several: fit them (zoom at most 16). None: no move.
 */
export function FavoritesFit({ pins }: { pins: readonly PinListing[] }) {
  const map = useMap();
  const activeTab = useMapUi((s) => s.activeTab);
  const previousTab = useRef(activeTab);

  const fit = useEffectEvent((target: google.maps.Map) => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      target.setZoom(SINGLE_ZOOM);
      target.panTo({ lat: pins[0].lat, lng: pins[0].lng });
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const pin of pins) bounds.extend({ lat: pin.lat, lng: pin.lng });
    target.fitBounds(bounds, FIT_PADDING);
    google.maps.event.addListenerOnce(target, "idle", () => {
      if ((target.getZoom() ?? 0) > MAX_FIT_ZOOM) target.setZoom(MAX_FIT_ZOOM);
    });
  });

  useEffect(() => {
    const previous = previousTab.current;
    previousTab.current = activeTab;
    if (!map || activeTab !== "favorites" || previous === "favorites") return;
    fit(map);
  }, [map, activeTab]);

  return null;
}
