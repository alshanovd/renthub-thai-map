"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { memo, useCallback, useMemo } from "react";

import { formatPinPrice } from "@/lib/listings/format";
import type { Pin, PriceMode } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

export type MarkerRefSetter = (
  marker: google.maps.marker.AdvancedMarkerElement | null,
  id: string,
) => void;

type PricePinProps = {
  pin: Pin;
  mode: PriceMode;
  favorite: boolean;
  selected: boolean;
  /** Registers the marker element with the clusterer; omitted for the (unclustered) selected pin. */
  setMarkerRef?: MarkerRefSetter;
};

const SELECTED_Z = 1_000_000;
const HIGHLIGHTED_Z = 100_000;

function PricePinImpl({ pin, mode, favorite, selected, setMarkerRef }: PricePinProps) {
  const { id } = pin;
  const highlighted = useMapUi((s) => s.hoveredId === id && s.hoverSource === "card");
  const hover = useMapUi((s) => s.hover);
  const select = useMapUi((s) => s.select);

  const position = useMemo(() => ({ lat: pin.lat, lng: pin.lng }), [pin.lat, pin.lng]);
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

  const label = formatPinPrice(pin.price, pin.kind, mode);
  const greyed = favorite && pin.deleted === true;

  return (
    <AdvancedMarker
      ref={ref}
      position={position}
      title={label}
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
            "border-white/70 bg-neutral-900 text-white group-hover:scale-105 group-hover:bg-neutral-700 group-hover:shadow-lg",
            highlighted && "bg-neutral-700 ring-2 ring-brand",
            selected &&
              "scale-115 border-white bg-brand px-2.5 py-1 text-sm text-white group-hover:bg-brand",
            greyed &&
              "border-white/60 bg-neutral-500 text-neutral-100 line-through opacity-75 group-hover:bg-neutral-500",
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
            "absolute bottom-0.5 size-2 rotate-45 border-r border-b border-white/70 bg-neutral-900 group-hover:bg-neutral-700",
            highlighted && "bg-neutral-700",
            selected && "border-white bg-brand group-hover:bg-brand",
            greyed && "bg-neutral-500 opacity-75 group-hover:bg-neutral-500",
          )}
        />
      </div>
    </AdvancedMarker>
  );
}

/** A price pill marker. Memoized: hover/selection changes re-render only the affected pins. */
export const PricePin = memo(PricePinImpl);
