"use client";

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { type MouseEvent, useCallback, useState } from "react";

import { thumbUrl } from "@/lib/images";
import { useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

type PhotoCarouselProps = {
  listingId: string;
  /** CDN paths in display order. */
  pictures: readonly string[];
};

const arrowClass =
  "absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow ring-1 ring-black/10 transition-opacity hover:bg-white focus-visible:opacity-100 opacity-0 group-hover/photo:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * 4:3 thumbnail carousel. Only the current photo and its neighbours are mounted (the next one
 * preloads while it's off to the side); all use `loading="lazy"`. Clicking the photo opens the
 * fullscreen viewer. Clicks never reach the card (no selection).
 */
export function PhotoCarousel({ listingId, pictures }: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const openViewer = useMapUi((s) => s.openViewer);
  const count = pictures.length;

  const stop = useCallback((event: MouseEvent) => event.stopPropagation(), []);
  const step = useCallback(
    (delta: number) => (event: MouseEvent) => {
      event.stopPropagation();
      setIndex((current) => (current + delta + count) % count);
    },
    [count],
  );

  if (count === 0) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg bg-muted text-xs text-muted-foreground">
        <ImageOff className="size-5" aria-hidden />
        No photo
      </div>
    );
  }

  // Current photo plus its (wrap-around) neighbours, as [picture index, offset in slots].
  const mounted = new Map<number, number>();
  for (const offset of [0, 1, -1]) {
    const i = (index + offset + count) % count;
    if (!mounted.has(i)) mounted.set(i, offset);
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
        {[...mounted].map(([i, offset]) => (
          <img
            key={i}
            src={thumbUrl(pictures[i])}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            aria-hidden={offset !== 0}
            className="absolute inset-0 size-full object-cover"
            style={{ transform: `translateX(${String(offset * 100)}%)` }}
          />
        ))}
      </button>
      {count > 1 ? (
        <>
          <button
            type="button"
            className={cn(arrowClass, "left-1.5")}
            aria-label="Previous photo"
            onClick={step(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={cn(arrowClass, "right-1.5")}
            aria-label="Next photo"
            onClick={step(1)}
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
