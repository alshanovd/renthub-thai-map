"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useEffectEvent, useRef } from "react";

import { centerAboveInset, usableInset } from "@/lib/map-inset";
import { useMapUi } from "@/lib/store";

import type { PinListing } from "./price-pin";

const FIT_PADDING = 64;
const SINGLE_ZOOM = 15;
/** Favorites close together shouldn't zoom in further than this. */
const MAX_FIT_ZOOM = 16;
/** Map pixels (inside the padding) that must stay visible above the mobile sheet. */
const MIN_VISIBLE_PX = 120;

/**
 * Fits the map to the favorite pins once, when the Favorites tab is activated. Later changes
 * (toggling a favorite, a fetched soft-deleted favorite arriving) never move the camera.
 * One favorite: pan to it at zoom 15. Several: fit them (zoom at most 16). None: no move.
 * On mobile the bottom padding grows by the list sheet's height (`mapInsetBottom`).
 */
export function FavoritesFit({ pins }: { pins: readonly PinListing[] }) {
  const map = useMap();
  const activeTab = useMapUi((s) => s.activeTab);
  const previousTab = useRef(activeTab);

  const fit = useEffectEvent((target: google.maps.Map) => {
    if (pins.length === 0) return;
    const inset = usableInset(
      useMapUi.getState().mapInsetBottom,
      target.getDiv().clientHeight,
      2 * FIT_PADDING + MIN_VISIBLE_PX,
    );
    if (pins.length === 1) {
      target.setZoom(SINGLE_ZOOM);
      target.panTo(centerAboveInset({ lat: pins[0].lat, lng: pins[0].lng }, inset, SINGLE_ZOOM));
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const pin of pins) bounds.extend({ lat: pin.lat, lng: pin.lng });
    target.fitBounds(
      bounds,
      inset > 0
        ? { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING + inset, left: FIT_PADDING }
        : FIT_PADDING,
    );
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
