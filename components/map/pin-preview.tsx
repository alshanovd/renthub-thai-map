"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LazyImage } from "@/components/ui-ext/lazy-image";
import { Spinner } from "@/components/ui-ext/spinner";
import { thumbUrl } from "@/lib/images";
import { formatPinPrice, formatPriceFull } from "@/lib/listings/format";
import type { ListingCard, Pin, PriceMode } from "@/lib/listings/types";
import { useCard } from "@/lib/queries";
import { type MapUiState, useMapUi } from "@/lib/store";
import { type StepDirection, usePhotoStepper } from "@/lib/use-photo-stepper";
import { cn } from "@/lib/utils";

const HIDE_DELAY_MS = 100;
const PREVIEW_Z = 2_000_000;

const pinHoverId = (state: MapUiState) => (state.hoverSource === "pin" ? state.hoveredId : null);

type PinPreviewProps = {
  /** Pins currently drawn, by id. */
  pinsById: ReadonlyMap<string, Pin>;
  mode: PriceMode;
};

/**
 * Thumbnail popover above a hovered pin. The card data is fetched on hover (`useCard`); until it
 * arrives the same frame shows a photo loader and the pin's price (no name). Hiding is delayed by 100 ms and cancelled while the
 * pointer is over the popover, so moving from the pin to the popover doesn't flicker.
 */
export function PinPreview({ pinsById, mode }: PinPreviewProps) {
  const [shownId, setShownId] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overPopover = useRef(false);
  /** Set when a press starts on a carousel arrow, so the marker's click doesn't select. */
  const navPress = useRef(false);
  const select = useMapUi((s) => s.select);
  const selectedId = useMapUi((s) => s.selectedId);

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
  const setNavPress = useCallback((pressed: boolean) => {
    navPress.current = pressed;
  }, []);
  const onClick = useCallback(() => {
    if (navPress.current) {
      navPress.current = false;
      return;
    }
    if (shownId !== null) select(shownId, "pin");
  }, [select, shownId]);

  const pin = shownId === null ? undefined : pinsById.get(shownId);
  const { data: listing } = useCard(pin ? pin.id : null);
  if (!pin) return null;

  return (
    <AdvancedMarker
      position={{ lat: pin.lat, lng: pin.lng }}
      zIndex={PREVIEW_Z}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      anchorLeft="-50%"
      // Clears the pin with a ~4px gap; the selected pin is drawn larger.
      anchorTop={shownId === selectedId ? "calc(-100% - 38px)" : "calc(-100% - 32px)"}
    >
      <div className="w-[200px] overflow-hidden rounded-lg bg-white text-neutral-900 shadow-xl ring-1 ring-black/10">
        {listing ? (
          <>
            <PreviewPhotos key={listing.id} listing={listing} onNavPress={setNavPress} />
            <div className="flex flex-col gap-0.5 p-2 text-xs">
              <div className="line-clamp-2 text-sm leading-tight font-medium">{listing.name}</div>
              <div className={cn(mode === "day" ? "font-semibold" : "text-neutral-500")}>
                {formatPriceFull(listing.daily, "day")}
              </div>
              <div className={cn(mode === "month" ? "font-semibold" : "text-neutral-500")}>
                {formatPriceFull(listing.monthly, "month")}
              </div>
            </div>
          </>
        ) : (
          <div aria-busy="true">
            <div className="flex h-[150px] w-[200px] items-center justify-center bg-neutral-100">
              <Spinner className="size-5 text-neutral-500" label="Loading listing" />
            </div>
            <div className="p-2 text-sm font-semibold">
              {formatPinPrice(pin.price, pin.kind, mode)}
            </div>
          </div>
        )}
      </div>
    </AdvancedMarker>
  );
}

/** Arrow click handler: steps without letting the click reach the card/marker. */
const onStep = (go: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  go();
};

const arrowClass =
  "absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow ring-1 ring-black/10 hover:bg-white";

type PreviewPhotosProps = {
  listing: ListingCard;
  /** Called with `true` when a press starts on an arrow, `false` for any other press. */
  onNavPress: (pressed: boolean) => void;
};

/**
 * Small thumbnail carousel for the hover preview, with a single mounted photo (`LazyImage`);
 * arrow hover/focus/press silently preloads that side's neighbour (see `usePhotoStepper`).
 * Arrow presses are reported via `onNavPress`: the marker's `gmp-click` fires on the marker
 * element, outside React's propagation, so `stopPropagation` alone can't stop it.
 */
function PreviewPhotos({ listing, onNavPress }: PreviewPhotosProps) {
  const pictures = useMemo(
    () => (listing.pictures.length > 0 ? listing.pictures : listing.cover ? [listing.cover] : []),
    [listing.pictures, listing.cover],
  );
  const count = pictures.length;
  const { index, next, prev, preload } = usePhotoStepper(pictures);

  const pressArrow = (dir: StepDirection) => () => {
    onNavPress(true);
    preload(dir);
  };
  const preloadPrev = () => preload(-1);
  const preloadNext = () => preload(1);

  if (count === 0) {
    return (
      <div className="flex h-[150px] w-[200px] items-center justify-center bg-neutral-100 text-xs text-neutral-500">
        No photo
      </div>
    );
  }

  return (
    <div
      className="relative h-[150px] w-[200px] overflow-hidden bg-neutral-100"
      onPointerDownCapture={() => onNavPress(false)}
    >
      <LazyImage
        src={thumbUrl(pictures[index])}
        alt=""
        width={200}
        height={150}
        className="absolute inset-0 size-full"
        placeholder={<div className="absolute inset-0 bg-neutral-100" />}
      />
      {count > 1 ? (
        <>
          <button
            type="button"
            className={cn(arrowClass, "left-1.5")}
            aria-label="Previous photo"
            onPointerEnter={preloadPrev}
            onFocus={preloadPrev}
            onPointerDown={pressArrow(-1)}
            onClick={onStep(prev)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={cn(arrowClass, "right-1.5")}
            aria-label="Next photo"
            onPointerEnter={preloadNext}
            onFocus={preloadNext}
            onPointerDown={pressArrow(1)}
            onClick={onStep(next)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
            {index + 1}/{count}
          </span>
        </>
      ) : null}
    </div>
  );
}
