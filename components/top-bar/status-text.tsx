"use client";

import { cn } from "cn";
import { useMemo, useSyncExternalStore } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/listings/format";
import type { ListingSummary } from "@/lib/listings/types";
import { computeTabCounts } from "@/lib/listings/visible";
import { useMapUi } from "@/lib/store";

const MINUTE = 60_000;

const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE);
  return () => clearInterval(timer);
};
/** Current time rounded down to the minute, so the snapshot is stable between renders. */
const getNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
/** No clock on the server: `/` is prerendered, the time is filled in after hydration. */
const getServerNow = () => null;

/** The current time (updated every minute) on the client, `null` during prerender/hydration. */
function useNow(): number | null {
  return useSyncExternalStore(subscribeMinute, getNow, getServerNow);
}

const absoluteFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const intFormat = new Intl.NumberFormat("en-US");

type StatusTextProps = {
  listings: readonly ListingSummary[];
  filtered: readonly ListingSummary[];
  lastScrapeAt: string | null;
  /** One row (`124 in view · 228 total` left, `Updated …` right) for the mobile sheet. */
  inline?: boolean;
  className?: string;
};

/** `124 in view · 228 total` (the On map tab's count) and `Updated 3 hours ago`. */
export function StatusText({
  listings,
  filtered,
  lastScrapeAt,
  inline = false,
  className,
}: StatusTextProps) {
  const bounds = useMapUi((s) => s.bounds);
  const now = useNow();
  const inView = useMemo(
    () => computeTabCounts({ listings, filtered, bounds, favoriteIds: [] }).map,
    [listings, filtered, bounds],
  );

  return (
    <div
      className={cn(
        "flex min-w-0 text-xs leading-tight text-muted-foreground",
        inline ? "flex-row items-center justify-between gap-2" : "flex-col items-end",
        className,
      )}
    >
      <span className="whitespace-nowrap tabular-nums" aria-live="polite">
        {bounds === null ? "" : `${intFormat.format(inView)} in view · `}
        {intFormat.format(filtered.length)} total
      </span>
      {now !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default whitespace-nowrap" tabIndex={0}>
              Updated {relativeTime(lastScrapeAt, now)}
            </span>
          </TooltipTrigger>
          {lastScrapeAt !== null && (
            <TooltipContent side={inline ? "top" : "bottom"} align="end">
              Last scrape: {absoluteFormat.format(new Date(lastScrapeAt))}
            </TooltipContent>
          )}
        </Tooltip>
      )}
    </div>
  );
}
