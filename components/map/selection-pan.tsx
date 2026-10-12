"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import { useMapUi } from "@/lib/store";

import type { PinListing } from "./price-pin";

const SAME_CENTER_EPSILON = 1e-7;

/**
 * Executes one-shot pan requests from the store (card clicks and `?id=` deep links).
 * - Card click: `panTo` only when the pin is outside the current bounds. Never zooms.
 * - Deep link: centers the pin once.
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
    const target = { lat: pin.lat, lng: pin.lng };
    const bounds = map.getBounds();
    if (!pendingPan.always && bounds?.contains(target)) {
      consumePan(false);
      return;
    }
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
