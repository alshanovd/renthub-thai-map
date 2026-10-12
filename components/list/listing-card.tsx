"use client";

import { Heart, MapPinOff, RotateCw } from "lucide-react";
import { memo, type MouseEvent, useCallback } from "react";

import { Spinner } from "@/components/ui-ext/spinner";
import { listingUrl } from "@/lib/images";
import { formatPinPrice, formatPriceFull } from "@/lib/listings/format";
import type { ListingSummary, Pin, PriceMode } from "@/lib/listings/types";
import { useCard } from "@/lib/queries";
import { useMapUi } from "@/lib/store";
import { cn } from "@/lib/utils";

import { PhotoCarousel } from "./photo-carousel";

type ListingCardProps = {
  id: string;
  /** The listing's pin when known: its price is shown while the card data loads. */
  pin: Pin | null;
  mode: PriceMode;
  /** The selected listing, kept in the list although it's outside the map view. */
  outsideView: boolean;
  favorite: boolean;
  /** Show a "No location" chip on a listing without coordinates (Favorites tab). */
  markNoLocation?: boolean;
  onToggleFavorite?: (id: string) => void;
};

type LoadedCardProps = Omit<ListingCardProps, "id" | "pin" | "markNoLocation"> & {
  listing: ListingSummary;
  noLocation: boolean;
};

const stop = (event: MouseEvent) => event.stopPropagation();

function roomLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 room type" : `${String(count)} room types`;
}

/**
 * A listing card: fetches its data by id (`useCard`, batched with the other cards of the render)
 * and shows a same-size skeleton until it arrives, or "Couldn't load · Retry" on failure.
 * Unknown ids render nothing.
 */
function ListingCardImpl({
  id,
  pin,
  mode,
  outsideView,
  favorite,
  markNoLocation = false,
  onToggleFavorite,
}: ListingCardProps) {
  const { data, isPending, isError, refetch, isFetching } = useCard(id);
  if (data) {
    return (
      <LoadedCard
        listing={data}
        mode={mode}
        outsideView={outsideView}
        favorite={favorite}
        noLocation={markNoLocation && (data.lat === null || data.lng === null)}
        onToggleFavorite={onToggleFavorite}
      />
    );
  }
  if (isError && !isFetching) {
    return <CardError id={id} onRetry={() => void refetch()} />;
  }
  if (isPending || isFetching) {
    return <CardSkeleton id={id} pin={pin} mode={mode} outsideView={outsideView} />;
  }
  return null;
}

function LoadedCard({
  listing,
  mode,
  outsideView,
  favorite,
  noLocation,
  onToggleFavorite,
}: LoadedCardProps) {
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
        pinHovered && "bg-brand/10 hover:bg-brand/10",
        selected && "bg-brand/5 ring-2 ring-brand",
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
        {noLocation ? (
          <span className="flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <MapPinOff className="size-3" aria-hidden />
            No location
          </span>
        ) : null}
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

/** Placeholder with the loaded card's layout (photo, two-line name, place, prices, rooms, link). */
function CardSkeleton({
  id,
  pin,
  mode,
  outsideView,
}: {
  id: string;
  pin: Pin | null;
  mode: PriceMode;
  outsideView: boolean;
}) {
  const select = useMapUi((s) => s.select);
  const selected = useMapUi((s) => s.selectedId === id);
  return (
    <article
      id={`card-${id}`}
      data-card-skeleton={id}
      aria-busy="true"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex cursor-pointer flex-col gap-1.5 rounded-xl p-1.5",
        selected && "bg-brand/5 ring-2 ring-brand",
      )}
      onClick={() => select(id, "card")}
    >
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        <div className="absolute inset-0 animate-pulse bg-neutral-200/60 motion-reduce:animate-none" />
        <Spinner className="size-5 text-neutral-500" label="Loading listing" />
        {outsideView ? (
          <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-medium text-white">
            Outside map view
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5 text-xs">
        <div className="h-[35px] py-0.5">
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="mt-1 h-3.5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
        <div className="my-0.5 h-3 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <p className={cn("h-4", mode === "day" ? "font-semibold" : "text-muted-foreground")}>
          {pin && mode === "day" ? formatPinPrice(pin.price, pin.kind, mode) : null}
        </p>
        <p className={cn("h-4", mode === "month" ? "font-semibold" : "text-muted-foreground")}>
          {pin && mode === "month" ? formatPinPrice(pin.price, pin.kind, mode) : null}
        </p>
        <div className="h-4" />
        <div className="mt-0.5 h-4" />
      </div>
    </article>
  );
}

function CardError({ id, onRetry }: { id: string; onRetry: () => void }) {
  return (
    <article
      id={`card-${id}`}
      className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl bg-muted/60 p-3 text-center text-xs text-muted-foreground"
    >
      <span>Couldn&apos;t load</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded-full px-2 py-1 font-medium text-foreground ring-1 ring-border hover:bg-background"
      >
        <RotateCw className="size-3" aria-hidden />
        Retry
      </button>
    </article>
  );
}

/** A listing card. Memoized: selection/hover changes re-render only the affected cards. */
export const ListingCard = memo(ListingCardImpl);
