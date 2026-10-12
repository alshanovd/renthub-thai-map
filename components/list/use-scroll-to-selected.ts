"use client";

import { useEffect, useRef } from "react";

import { useMapUi } from "@/lib/store";

/**
 * Smooth scrolling is driven by animation frames, which don't run in a hidden tab (e.g. a deep
 * link opened in the background), so jump instead there and for reduced-motion users.
 */
function scrollBehavior(): ScrollBehavior {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return document.visibilityState === "visible" && !reduced ? "smooth" : "instant";
}

/**
 * Scrolls the selected card into view **once**, right after a pin click (`"pin"`) or a `?id=`
 * deep link (`"url"`), then consumes the source so nothing scrolls again. Card clicks never
 * scroll, and the effect doesn't depend on the visible list, so list re-renders never scroll.
 *
 * The list is virtualized, so the card may not be mounted: `scrollTo(id, behavior)` scrolls the
 * virtualizer to the card's row (`align: "auto"`, i.e. "nearest"); it's a no-op for an id that
 * isn't in the list.
 *
 * A deep link waits until the map has panned to the pin, reported the new bounds, and the pins of
 * that area have loaded (`listReady`), so the card is already in its final position in the
 * "On map" list.
 */
export function useScrollToSelected(
  listReady: boolean,
  scrollTo: (id: string, behavior: ScrollBehavior) => void,
): void {
  const selectedId = useMapUi((s) => s.selectedId);
  const selectSource = useMapUi((s) => s.selectSource);
  const consumeSelectSource = useMapUi((s) => s.consumeSelectSource);
  const mapSettled = useMapUi(
    (s) => s.bounds !== null && s.pendingPan === null && !s.awaitingBounds,
  );
  // Read at scroll time only: a new list (new rows) must not re-run the effect.
  const scrollToRef = useRef(scrollTo);
  useEffect(() => {
    scrollToRef.current = scrollTo;
  });

  useEffect(() => {
    if (selectedId === null) return;
    if (selectSource !== "pin" && !(selectSource === "url" && mapSettled && listReady)) return;
    scrollToRef.current(selectedId, scrollBehavior());
    consumeSelectSource();
  }, [selectedId, selectSource, mapSettled, listReady, consumeSelectSource]);
}
