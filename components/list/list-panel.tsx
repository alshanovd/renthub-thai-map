"use client";

import { useMemo } from "react";

import { inBounds } from "@/lib/listings/filter";
import type { ListingSummary } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";

/** Placeholder list (plan 08 replaces it): the number of filtered listings in the map view. */
export function ListPanel({
  listings,
  selected,
}: {
  listings: readonly ListingSummary[];
  selected: ListingSummary | undefined;
}) {
  const bounds = useMapUi((s) => s.bounds);
  const inView = useMemo(
    () => (bounds ? listings.filter((listing) => inBounds(listing, bounds)).length : null),
    [listings, bounds],
  );

  return (
    <div className="flex flex-col gap-2 p-4 text-sm">
      <p className="text-lg font-semibold" data-testid="in-view-count">
        {inView === null ? "Loading map…" : `${String(inView)} in view`}
      </p>
      {selected ? <p className="text-muted-foreground">Selected: {selected.name}</p> : null}
    </div>
  );
}
