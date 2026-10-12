"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import type { Pin } from "@/lib/listings/types";
import { centerAboveInset, inVisibleArea, usableInset } from "@/lib/map-inset";
import { useCard } from "@/lib/queries";
import { useMapUi } from "@/lib/store";

const SAME_CENTER_EPSILON = 1e-7;
/** Map pixels that must stay visible above the mobile sheet for it to count as an inset. */
const MIN_VISIBLE_PX = 160;

/**
 * Executes one-shot pan requests from the store (card clicks and `?id=` deep links).
 * - Card click: `panTo` only when the pin is outside the current bounds. Never zooms.
 * - Deep link: centers the pin once.
 * On mobile the list sheet covers the bottom of the map (`mapInsetBottom`): a pin behind it
 * counts as off-screen, and pans put the pin in the middle of the area above it.
 * The position comes from the drawn pins or, failing that, the listing's card (`useCard`): a deep
 * link waits for its card, then pans once. The request is consumed as soon as it is handled, so
 * the bounds update that follows a pan can never cause another pan (no idle → setBounds → pan
 * cycle).
 */
export function SelectionPan({ pinsById }: { pinsById: ReadonlyMap<string, Pin> }) {
  const map = useMap();
  const pendingPan = useMapUi((s) => s.pendingPan);
  const consumePan = useMapUi((s) => s.consumePan);
  const card = useCard(pendingPan?.id ?? null);
  const cardData = card.data;
  const cardLoading = card.isPending && card.fetchStatus !== "idle";

  useEffect(() => {
    if (!map || !pendingPan) return;
    const pin = pinsById.get(pendingPan.id);
    const position =
      pin ??
      (cardData && cardData.lat !== null && cardData.lng !== null
        ? { lat: cardData.lat, lng: cardData.lng }
        : null);
    if (!position) {
      // Wait for the card; a card without location (or an unknown id / error) never pans.
      if (!cardLoading) consumePan(false);
      return;
    }
    const pinPosition = { lat: position.lat, lng: position.lng };
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
  }, [map, pendingPan, pinsById, cardData, cardLoading, consumePan]);

  return null;
}
