"use client";

import { Heart } from "lucide-react";
import { memo, type MouseEvent, useCallback } from "react";

import { listingUrl } from "@/lib/images";
import { formatPriceFull } from "@/lib/listings/format";
import type { ListingSummary, PriceMode } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

import { PhotoCarousel } from "./photo-carousel";

type ListingCardProps = {
  listing: ListingSummary;
  mode: PriceMode;
  /** The selected listing, kept in the list although it's outside the map view. */
  outsideView: boolean;
  favorite: boolean;
  /** Wired by plan 10 (favorites store). */
  onToggleFavorite?: (id: string) => void;
};

const stop = (event: MouseEvent) => event.stopPropagation();

function roomLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 room type" : `${String(count)} room types`;
}

function ListingCardImpl({
  listing,
  mode,
  outsideView,
  favorite,
  onToggleFavorite,
}: ListingCardProps) {
  const { id } = listing;
  const selected = useMapUi((s) => s.selectedId === id);
  const pinHovered = useMapUi((s) => s.hoveredId === id && s.hoverSource === "pin");
  const select = useMapUi((s) => s.select);
  const hover = useMapUi((s) => s.hover);

  const onClick = useCallback(() => select(id, "card"), [select, id]);
  const onMouseEnter = useCallback(() => hover(id, "card"), [hover, id]);
  const onMouseLeave = useCallback(() => {
    const state = useMapUi.getState();
    if (state.hoveredId === id && state.hoverSource === "card") hover(null, null);
  }, [hover, id]);
  const onFavorite = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onToggleFavorite?.(id);
    },
    [onToggleFavorite, id],
  );

  const place = [listing.district, listing.subdistrict].filter(Boolean).join(" · ");
  const rooms = roomLabel(listing.roomCount);

  return (
    <article
      id={`card-${id}`}
      data-listing-id={id}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex cursor-pointer flex-col gap-1.5 rounded-xl p-1.5 transition-colors",
        "hover:bg-muted/70",
        pinHovered && "bg-rose-50 hover:bg-rose-50",
        selected && "bg-rose-50/60 ring-2 ring-rose-600",
        listing.deleted && "opacity-60 grayscale",
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="relative">
        <PhotoCarousel listingId={id} pictures={listing.pictures} />
        <button
          type="button"
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          className="absolute top-1.5 right-1.5 z-10 flex size-7 items-center justify-center rounded-full bg-white/90 shadow ring-1 ring-black/10 transition-transform hover:scale-110"
          onClick={onFavorite}
        >
          <Heart
            className={cn("size-4", favorite ? "fill-rose-600 text-rose-600" : "text-neutral-700")}
            aria-hidden
          />
        </button>
        {listing.deleted || outsideView ? (
          <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-medium text-white">
            {listing.deleted ? "No longer listed" : "Outside map view"}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5 text-xs">
        {/* Keyboard access: Enter/Space on this button bubbles a click to the card. */}
        <button
          type="button"
          className="line-clamp-2 text-left text-sm leading-tight font-medium focus-visible:underline focus-visible:outline-none"
        >
          {listing.name}
        </button>
        {place ? <p className="truncate text-muted-foreground">{place}</p> : null}
        <p className={cn(mode === "day" ? "font-semibold" : "text-muted-foreground")}>
          {formatPriceFull(listing.daily, "day")}
        </p>
        <p className={cn(mode === "month" ? "font-semibold" : "text-muted-foreground")}>
          {formatPriceFull(listing.monthly, "month")}
        </p>
        {rooms ? <p className="text-muted-foreground">{rooms}</p> : null}
        <a
          href={listingUrl(listing.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 w-fit font-medium text-rose-700 hover:underline"
          onClick={stop}
        >
          Open on renthub ↗
        </a>
      </div>
    </article>
  );
}

/** A listing card. Memoized: selection/hover changes re-render only the affected cards. */
export const ListingCard = memo(ListingCardImpl);
