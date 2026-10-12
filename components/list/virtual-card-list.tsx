"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Spinner } from "@/components/ui-ext/spinner";
import type { PriceMode } from "@/lib/listings/types";
import { chunkRows, listColumns, rowIndexOf, type VisibleItem } from "@/lib/listings/visible";

import { ListingCard } from "./listing-card";
import { useScrollToSelected } from "./use-scroll-to-selected";

/** Row padding (`p-2`), the gap between rows (`gap-y-2`) and between cards (`gap-x-1`), px. */
const PAD = 8;
const ROW_GAP = 8;
const COLUMN_GAP = 4;
/** A card's height minus its photo: padding, gap and the text lines (see `ListingCard`). */
const CARD_CHROME = 137;
/** Height of the "Loading more…" row. */
const FOOTER_HEIGHT = 48;

/** Estimated row height for a list `width`: a 4:3 photo plus the card's text. */
function estimateRowHeight(width: number, columns: number): number {
  const cardWidth = (Math.max(width, 320) - 2 * PAD - COLUMN_GAP * (columns - 1)) / columns;
  return Math.round((cardWidth - 12) * 0.75 + CARD_CHROME);
}

type VirtualCardListProps = {
  items: readonly VisibleItem[];
  /** Chip "No location" on cards without coordinates (Favorites tab). */
  markNoLocation: boolean;
  mode: PriceMode;
  favoriteSet: ReadonlySet<string>;
  onToggleFavorite?: (id: string) => void;
  /** Loading text when there's nothing to show yet; null when loaded. */
  loading: string | null;
  empty: string;
  /** The list is in its final state for a `?id=` deep link (see `useScrollToSelected`). */
  listReady: boolean;
  /** More pages exist (No location tab): a last row asks for them when it's rendered. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

/**
 * The cards of one list tab, virtualized by rows (`@tanstack/react-virtual`): two cards per row,
 * or one when the list is narrower than `TWO_COLUMN_MIN_WIDTH`; only the rows near the visible
 * part (overscan 2) are mounted, so scrolled-away cards and their photos unmount and their card
 * data is evicted after `gcTime`. Rows are measured (`measureElement`), so real heights win
 * over the estimate. Owns the scroll element (`[data-list-scroller]`), which is the sheet's
 * scrolling area on mobile.
 */
export function VirtualCardList({
  items,
  markNoLocation,
  mode,
  favoriteSet,
  onToggleFavorite,
  loading,
  empty,
  listReady,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: VirtualCardListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = listColumns(width);
  const rows = useMemo(() => chunkRows(items, columns), [items, columns]);
  const count = rows.length + (hasMore ? 1 : 0);

  const getItemKey = useCallback(
    (index: number) =>
      index < rows.length ? rows[index].map((entry) => entry.id).join(",") : "load-more",
    [rows],
  );
  const estimateSize = useCallback(
    (index: number) => (index < rows.length ? estimateRowHeight(width, columns) : FOOTER_HEIGHT),
    [rows.length, width, columns],
  );

  // No React Compiler here, so the compiler-compat warning doesn't apply; the instance is stable.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 2,
    gap: ROW_GAP,
    paddingStart: PAD,
    paddingEnd: PAD,
  });

  const scrollTo = useCallback(
    (id: string, behavior: ScrollBehavior) => {
      const row = rowIndexOf(items, id, columns);
      if (row >= 0) virtualizer.scrollToIndex(row, { align: "auto", behavior });
    },
    [items, columns, virtualizer],
  );
  useScrollToSelected(listReady, scrollTo);

  const virtualRows = virtualizer.getVirtualItems();
  const lastRendered = virtualRows.at(-1)?.index ?? -1;

  // Infinite scroll: the "Loading more…" row (the last one) is rendered → fetch the next page.
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });
  useEffect(() => {
    if (hasMore && !loadingMore && lastRendered >= rows.length) onLoadMoreRef.current?.();
  }, [hasMore, loadingMore, lastRendered, rows.length]);

  return (
    <div
      ref={scrollRef}
      data-list-scroller
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {items.length === 0 ? (
        <ListStatus loading={loading} empty={empty} />
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index] as VisibleItem[] | undefined;
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
              >
                {row ? (
                  <div
                    className="grid gap-x-1 px-2"
                    style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
                  >
                    {row.map(({ id, pin, outsideView }) => (
                      <ListingCard
                        key={id}
                        id={id}
                        pin={pin}
                        mode={mode}
                        outsideView={outsideView}
                        favorite={favoriteSet.has(id)}
                        markNoLocation={markNoLocation}
                        onToggleFavorite={onToggleFavorite}
                      />
                    ))}
                  </div>
                ) : (
                  <LoadMoreRow loading={loadingMore} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListStatus({ loading, empty }: { loading: string | null; empty: string }) {
  if (loading === null) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <Spinner />
      {loading}
    </div>
  );
}

/** Last row of a list with more pages: a spinner while the next page loads. */
function LoadMoreRow({ loading }: { loading: boolean }) {
  return (
    <div
      role="status"
      aria-busy={loading}
      className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
      style={{ height: FOOTER_HEIGHT }}
    >
      {loading ? (
        <>
          <Spinner />
          Loading more…
        </>
      ) : null}
    </div>
  );
}
