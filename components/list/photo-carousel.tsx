"use client";

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { type MouseEvent, useCallback } from "react";

import { LazyImage } from "@/components/ui-ext/lazy-image";
import { thumbUrl } from "@/lib/images";
import { useMapUi } from "@/lib/store";
import { usePhotoStepper } from "@/lib/use-photo-stepper";
import { cn } from "@/lib/utils";

type PhotoCarouselProps = {
  listingId: string;
  /** CDN paths in display order. */
  pictures: readonly string[];
};

/** Arrow click handler: steps without letting the click reach the card/marker. */
const onStep = (go: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  go();
};

const arrowClass =
  "absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow ring-1 ring-black/10 transition-opacity hover:bg-white focus-visible:opacity-100 opacity-0 group-hover/photo:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * 4:3 thumbnail carousel with a single mounted photo (a `LazyImage`: spinner until it loads).
 * Hovering, focusing or pressing an arrow silently preloads the neighbour on that side, and each
 * step preloads the next one in the same direction, so stepping is instant without keeping
 * neighbours decoded. Clicking the photo opens the fullscreen viewer. Clicks never reach the
 * card (no selection).
 */
export function PhotoCarousel({ listingId, pictures }: PhotoCarouselProps) {
  const { index, next, prev, preload } = usePhotoStepper(pictures);
  const openViewer = useMapUi((s) => s.openViewer);
  const count = pictures.length;

  const stop = useCallback((event: MouseEvent) => event.stopPropagation(), []);
  const preloadPrev = () => preload(-1);
  const preloadNext = () => preload(1);

  if (count === 0) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg bg-muted text-xs text-muted-foreground">
        <ImageOff className="size-5" aria-hidden />
        No photo
      </div>
    );
  }

  return (
    <div
      className="group/photo relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted"
      onClick={stop}
    >
      <button
        type="button"
        className="absolute inset-0 block size-full cursor-zoom-in"
        data-viewer-opener={listingId}
        aria-label={`Open photo ${String(index + 1)} of ${String(count)}`}
        onClick={() => openViewer(listingId, index)}
      >
        <LazyImage src={thumbUrl(pictures[index])} alt="" className="absolute inset-0 size-full" />
      </button>
      {count > 1 ? (
        <>
          <button
            type="button"
            className={cn(arrowClass, "left-1.5")}
            aria-label="Previous photo"
            onPointerEnter={preloadPrev}
            onPointerDown={preloadPrev}
            onFocus={preloadPrev}
            onClick={onStep(prev)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={cn(arrowClass, "right-1.5")}
            aria-label="Next photo"
            onPointerEnter={preloadNext}
            onPointerDown={preloadNext}
            onFocus={preloadNext}
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
