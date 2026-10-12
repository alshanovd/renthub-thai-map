"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import { centerAboveInset, inVisibleArea, usableInset } from "@/lib/map-inset";
import { useMapUi } from "@/lib/store";

import type { PinListing } from "./price-pin";

const SAME_CENTER_EPSILON = 1e-7;
/** Map pixels that must stay visible above the mobile sheet for it to count as an inset. */
const MIN_VISIBLE_PX = 160;

/**
 * Executes one-shot pan requests from the store (card clicks and `?id=` deep links).
 * - Card click: `panTo` only when the pin is outside the current bounds. Never zooms.
 * - Deep link: centers the pin once.
 * On mobile the list sheet covers the bottom of the map (`mapInsetBottom`): a pin behind it
 * counts as off-screen, and pans put the pin in the middle of the area above it.
 * The request is consumed immediately, so the bounds update that follows a pan can never cause
 * another pan (no idle → setBounds → pan cycle).
 */
export function SelectionPan({ pinsById }: { pinsById: ReadonlyMap<string, PinListing> }) {
  const map = useMap();
  const pendingPan = useMapUi((s) => s.pendingPan);
  const consumePan = useMapUi((s) => s.consumePan);

  useEffect(() => {
    if (!map || !pendingPan) return;
    const pin = pinsById.get(pendingPan.id);
    if (!pin) {
      consumePan(false);
      return;
    }
    const pinPosition = { lat: pin.lat, lng: pin.lng };
    const bounds = map.getBounds();
    const inset = usableInset(
      useMapUi.getState().mapInsetBottom,
      map.getDiv().clientHeight,
      MIN_VISIBLE_PX,
    );
    if (
      !pendingPan.always &&
      bounds &&
      inVisibleArea(bounds.toJSON(), pinPosition, inset, map.getDiv().clientHeight)
    ) {
      consumePan(false);
      return;
    }
    const target = centerAboveInset(pinPosition, inset, map.getZoom() ?? 13);
    const center = map.getCenter();
    const moved =
      !center ||
      Math.abs(center.lat() - target.lat) > SAME_CENTER_EPSILON ||
      Math.abs(center.lng() - target.lng) > SAME_CENTER_EPSILON;
    if (moved) {
      // Before the first render `panTo` has nothing to animate from; jump instead.
      if (bounds) map.panTo(target);
      else map.setCenter(target);
    }
    consumePan(moved);
  }, [map, pendingPan, pinsById, consumePan]);

  return null;
}
