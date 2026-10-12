"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useRef, useState } from "react";

import { thumbUrl } from "@/lib/images";
import { formatPriceFull } from "@/lib/listings/format";
import type { PriceMode } from "@/lib/listings/types";
import { type MapUiState, useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

import type { PinListing } from "./price-pin";

const HIDE_DELAY_MS = 100;
const PREVIEW_Z = 2_000_000;

const pinHoverId = (state: MapUiState) => (state.hoverSource === "pin" ? state.hoveredId : null);

type PinPreviewProps = {
  /** Listings that currently have a pin, by id. */
  pinsById: ReadonlyMap<string, PinListing>;
  mode: PriceMode;
};

/**
 * Thumbnail popover above a hovered pin. Hiding is delayed by 100 ms and cancelled while the
 * pointer is over the popover, so moving from the pin to the popover doesn't flicker.
 */
export function PinPreview({ pinsById, mode }: PinPreviewProps) {
  const [shownId, setShownId] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overPopover = useRef(false);
  const select = useMapUi((s) => s.select);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!overPopover.current && pinHoverId(useMapUi.getState()) === null) setShownId(null);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    const unsubscribe = useMapUi.subscribe((state, prev) => {
      const id = pinHoverId(state);
      if (id === pinHoverId(prev)) return;
      if (id === null) {
        scheduleHide();
      } else {
        clearTimeout(hideTimer.current);
        overPopover.current = false;
        setShownId(id);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const onMouseEnter = useCallback(() => {
    overPopover.current = true;
    clearTimeout(hideTimer.current);
  }, []);
  const onMouseLeave = useCallback(() => {
    overPopover.current = false;
    scheduleHide();
  }, [scheduleHide]);
  const onClick = useCallback(() => {
    if (shownId !== null) select(shownId, "pin");
  }, [select, shownId]);

  const listing = shownId === null ? undefined : pinsById.get(shownId);
  if (!listing) return null;

  return (
    <AdvancedMarker
      position={{ lat: listing.lat, lng: listing.lng }}
      zIndex={PREVIEW_Z}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      anchorLeft="-50%"
      anchorTop="calc(-100% - 38px)"
    >
      <div className="w-[200px] overflow-hidden rounded-lg bg-white text-neutral-900 shadow-xl ring-1 ring-black/10">
        {listing.cover ? (
          <img
            src={thumbUrl(listing.cover)}
            alt=""
            loading="lazy"
            width={200}
            height={150}
            className="h-[150px] w-[200px] bg-neutral-100 object-cover"
          />
        ) : (
          <div className="flex h-[150px] w-[200px] items-center justify-center bg-neutral-100 text-xs text-neutral-500">
            No photo
          </div>
        )}
        <div className="flex flex-col gap-0.5 p-2 text-xs">
          <div className="line-clamp-2 text-sm leading-tight font-medium">{listing.name}</div>
          <div className={cn(mode === "day" ? "font-semibold" : "text-neutral-500")}>
            {formatPriceFull(listing.daily, "day")}
          </div>
          <div className={cn(mode === "month" ? "font-semibold" : "text-neutral-500")}>
            {formatPriceFull(listing.monthly, "month")}
          </div>
        </div>
      </div>
    </AdvancedMarker>
  );
}
