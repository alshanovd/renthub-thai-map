"use client";

import { useEffect } from "react";

import { useMapUi } from "@/lib/store";

/**
 * Scrolls the selected card into view **once**, right after a pin click (`"pin"`) or a `?id=`
 * deep link (`"url"`), then consumes the source so nothing scrolls again. Card clicks never
 * scroll, and the effect doesn't depend on the visible list, so list re-renders never scroll.
 *
 * A deep link waits until the map has panned to the pin and reported the new bounds, so the card
 * is already in its final position in the "On map" list.
 */
/**
 * Smooth scrolling is driven by animation frames, which don't run in a hidden tab (e.g. a deep
 * link opened in the background), so jump instead there and for reduced-motion users.
 */
function scrollBehavior(): ScrollBehavior {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return document.visibilityState === "visible" && !reduced ? "smooth" : "instant";
}

export function useScrollToSelected(): void {
  const selectedId = useMapUi((s) => s.selectedId);
  const selectSource = useMapUi((s) => s.selectSource);
  const consumeSelectSource = useMapUi((s) => s.consumeSelectSource);
  const mapSettled = useMapUi(
    (s) => s.bounds !== null && s.pendingPan === null && !s.awaitingBounds,
  );

  useEffect(() => {
    if (selectedId === null) return;
    if (selectSource !== "pin" && !(selectSource === "url" && mapSettled)) return;
    document
      .getElementById(`card-${selectedId}`)
      ?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
    consumeSelectSource();
  }, [selectedId, selectSource, mapSettled, consumeSelectSource]);
}
