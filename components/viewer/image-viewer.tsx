"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Heart, ImageOff, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { LazyImage } from "@/components/ui-ext/lazy-image";
import { Spinner } from "@/components/ui-ext/spinner";
import { useFavorites } from "@/lib/favorites";
import { fullUrl, listingUrl, thumbUrl } from "@/lib/images";
import type { ListingSummary } from "@/lib/listings/types";
import { useCard } from "@/lib/queries";
import { type ViewerTarget, useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Minimum horizontal travel (px) for a swipe to change the photo. */
const SWIPE_PX = 50;

const roundButton =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

const arrowButton =
  "absolute top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none";

/**
 * Almost full-screen photo viewer for `useMapUi().viewer`, reading the listing's card
 * (`useCard`; a centered spinner until it arrives). Full-size images (no `?class=thumbnail`)
 * over a blurred thumbnail placeholder with a spinner; ←/→ keys, buttons and swipe, wrapping at
 * both ends; Esc closes. On close, focus returns to the card photo that opened it.
 */
export function ImageViewer() {
  const viewer = useMapUi((s) => s.viewer);
  const closeViewer = useMapUi((s) => s.closeViewer);

  // Keep rendering the last target during the close animation.
  const [shown, setShown] = useState<ViewerTarget | null>(viewer);
  if (viewer !== null && viewer !== shown) setShown(viewer);

  const card = useCard(shown ? shown.listingId : null);
  const listing = card.data ?? undefined;
  // An unknown id (null card) closes; a card still loading shows a spinner.
  const open = viewer !== null && card.data !== null;

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      if (!shown) return;
      const opener = document.querySelector<HTMLElement>(
        `[data-viewer-opener="${CSS.escape(shown.listingId)}"]`,
      );
      if (opener) {
        event.preventDefault();
        opener.focus({ preventScroll: true });
      }
    },
    [shown],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeViewer();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/85 supports-backdrop-filter:backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex h-[92dvh] w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-neutral-950 text-white shadow-2xl ring-1 ring-white/10 outline-none",
            // Phones: edge to edge.
            "max-md:h-dvh max-md:w-screen max-md:rounded-none max-md:ring-0",
            "duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          {listing && shown ? (
            <ViewerBody listing={listing} index={shown.index} />
          ) : (
            <>
              <DialogTitle className="sr-only">Photos</DialogTitle>
              <div className="flex flex-1 items-center justify-center" aria-busy="true">
                {card.isError ? (
                  <span className="text-sm text-white/70">Couldn&apos;t load this listing.</span>
                ) : (
                  <Spinner className="size-8 text-white/80" label="Loading photos" />
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function ViewerBody({ listing, index: rawIndex }: { listing: ListingSummary; index: number }) {
  const openViewer = useMapUi((s) => s.openViewer);
  const { isFavorite, toggle } = useFavorites();
  const favorite = isFavorite(listing.id);
  const { pictures } = listing;
  const count = pictures.length;
  const index = count > 0 ? ((rawIndex % count) + count) % count : 0;

  const step = useCallback(
    (delta: number) => {
      if (count < 2) return;
      openViewer(listing.id, (index + delta + count) % count);
    },
    [count, index, listing.id, openViewer],
  );

  // Preload the neighbours' full images.
  useEffect(() => {
    if (count < 2) return;
    for (const delta of [1, -1]) {
      const image = new Image();
      image.decoding = "async";
      image.src = fullUrl(pictures[(index + delta + count) % count]);
    }
  }, [count, index, pictures]);

  // ←/→ wherever focus is inside the (modal) viewer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  // Swipe: pointer events (touch, pen, or a mouse drag) on the photo stage.
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 py-2 pr-2 pl-4 max-[400px]:gap-1 max-[400px]:pl-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3 max-[400px]:gap-2">
          <DialogTitle className="truncate text-base font-medium text-white">
            {listing.name}
          </DialogTitle>
          {listing.deleted ? (
            <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
              No longer listed
            </span>
          ) : null}
          {count > 0 ? (
            <span className="shrink-0 text-sm text-white/70 tabular-nums" aria-live="polite">
              {index + 1} / {count}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={roundButton}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          onClick={() => toggle(listing.id)}
        >
          <Heart
            className={cn("size-5", favorite ? "fill-rose-500 text-rose-500" : "text-white")}
            aria-hidden
          />
        </button>
        <a
          href={listingUrl(listing.slug)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on renthub"
          className="flex shrink-0 items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none max-[400px]:size-9 max-[400px]:p-0"
        >
          {/* Under 400px only the icon fits next to the name. */}
          <span className="max-[400px]:hidden">Open on renthub ↗</span>
          <ExternalLink className="size-5 min-[401px]:hidden" aria-hidden />
        </a>
        <DialogPrimitive.Close className={roundButton} aria-label="Close">
          <XIcon className="size-5" aria-hidden />
        </DialogPrimitive.Close>
      </header>

      <div
        className="relative min-h-0 flex-1 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        {count === 0 ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-white/60">
            <ImageOff className="size-8" aria-hidden />
            No photos
          </div>
        ) : (
          <ViewerImage key={pictures[index]} path={pictures[index]} alt={listing.name} />
        )}
        {count > 1 ? (
          <>
            <button
              type="button"
              className={cn(arrowButton, "left-3")}
              aria-label="Previous photo"
              onClick={() => step(-1)}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              className={cn(arrowButton, "right-3")}
              aria-label="Next photo"
              onClick={() => step(1)}
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Full-size photo (a `LazyImage`) fading in over its blurred thumbnail, with a spinner on top. */
function ViewerImage({ path, alt }: { path: string; alt: string }) {
  return (
    <LazyImage
      src={fullUrl(path)}
      alt={alt}
      loading="eager"
      className="absolute inset-0 size-full"
      imgClassName="object-contain"
      placeholder={
        <img
          src={thumbUrl(path)}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 size-full scale-105 object-contain blur-xl"
        />
      }
    />
  );
}
