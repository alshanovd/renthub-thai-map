"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { memo, useCallback, useMemo } from "react";

import { modePrice } from "@/lib/listings/filter";
import { formatPinLabel } from "@/lib/listings/format";
import type { ListingSummary, PriceMode } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

export type PinListing = ListingSummary & { lat: number; lng: number };

export type MarkerRefSetter = (
  marker: google.maps.marker.AdvancedMarkerElement | null,
  id: string,
) => void;

type PricePinProps = {
  listing: PinListing;
  mode: PriceMode;
  favorite: boolean;
  selected: boolean;
  /** Registers the marker element with the clusterer; omitted for the (unclustered) selected pin. */
  setMarkerRef?: MarkerRefSetter;
};

const SELECTED_Z = 1_000_000;
const HIGHLIGHTED_Z = 100_000;

function PricePinImpl({ listing, mode, favorite, selected, setMarkerRef }: PricePinProps) {
  const { id } = listing;
  const highlighted = useMapUi((s) => s.hoveredId === id && s.hoverSource === "card");
  const hover = useMapUi((s) => s.hover);
  const select = useMapUi((s) => s.select);

  const position = useMemo(
    () => ({ lat: listing.lat, lng: listing.lng }),
    [listing.lat, listing.lng],
  );
  const ref = useCallback(
    (marker: google.maps.marker.AdvancedMarkerElement | null) => setMarkerRef?.(marker, id),
    [setMarkerRef, id],
  );
  const onMouseEnter = useCallback(() => hover(id, "pin"), [hover, id]);
  const onMouseLeave = useCallback(() => {
    const state = useMapUi.getState();
    if (state.hoveredId === id && state.hoverSource === "pin") hover(null, null);
  }, [hover, id]);
  const onClick = useCallback(() => select(id, "pin"), [select, id]);

  const label = formatPinLabel(modePrice(listing, mode), mode);
  const greyed = favorite && listing.deleted;

  return (
    <AdvancedMarker
      ref={ref}
      position={position}
      title={listing.name}
      zIndex={selected ? SELECTED_Z : highlighted ? HIGHLIGHTED_Z : undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      anchorLeft="-50%"
      anchorTop="-100%"
    >
      <div className="group relative flex flex-col items-center pb-1.5" data-pin-id={id}>
        <div
          className={cn(
            "relative rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap shadow-md transition-[transform,background-color,color,box-shadow] duration-100",
            "border-neutral-300 bg-white text-neutral-900 group-hover:scale-105 group-hover:shadow-lg",
            highlighted && "border-rose-500 ring-2 ring-rose-500",
            selected && "scale-115 border-rose-600 bg-rose-600 px-2.5 py-1 text-sm text-white",
            greyed && "border-neutral-300 bg-neutral-200 text-neutral-500 line-through",
          )}
        >
          {label}
          {favorite ? (
            <span
              aria-label="Favorite"
              className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-white text-[10px] leading-none text-rose-600 shadow ring-1 ring-rose-200"
            >
              ♥
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "absolute bottom-0.5 size-2 rotate-45 border-r border-b border-neutral-300 bg-white",
            selected && "border-rose-600 bg-rose-600",
            greyed && "bg-neutral-200",
          )}
        />
      </div>
    </AdvancedMarker>
  );
}

/** A price pill marker. Memoized: hover/selection changes re-render only the affected pins. */
export const PricePin = memo(PricePinImpl);
