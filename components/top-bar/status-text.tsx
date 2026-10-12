"use client";

import { cn } from "cn";
import { useMemo, useSyncExternalStore } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui-ext/spinner";
import { relativeTime } from "@/lib/listings/format";
import { pinsInView } from "@/lib/listings/visible";
import { usePins } from "@/lib/queries";
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
  /** One row (`124 in view · 228 total` left, `Updated …` right) for the mobile sheet. */
  inline?: boolean;
  className?: string;
};

/**
 * `124 in view · 228 total` (the On map tab's count; from the pins response) with a spinner
 * while pins load, and `Updated 3 hours ago` (the last scrape, also from the pins response).
 */
export function StatusText({ inline = false, className }: StatusTextProps) {
  const bounds = useMapUi((s) => s.bounds);
  const now = useNow();
  const { pins, total, lastScrapeAt, loaded, isFetching } = usePins();
  const inView = useMemo(() => pinsInView(pins, bounds).length, [pins, bounds]);

  return (
    <div
      className={cn(
        "flex min-w-0 text-xs leading-tight text-muted-foreground",
        inline ? "flex-row items-center justify-between gap-2" : "flex-col items-end",
        className,
      )}
    >
      <span
        className="flex items-center gap-1.5 whitespace-nowrap tabular-nums"
        aria-live="polite"
        aria-busy={isFetching}
      >
        {isFetching ? <Spinner className="size-3" label="Loading listings" /> : null}
        {total === null
          ? isFetching
            ? "Loading…"
            : ""
          : `${bounds === null || !loaded ? "" : `${intFormat.format(inView)} in view · `}${intFormat.format(total)} total`}
      </span>
      {now !== null && loaded && (
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
