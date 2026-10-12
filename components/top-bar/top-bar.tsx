"use client";

import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_SEARCH, matchesSearch, type Search, type SortOrder } from "@/lib/listings/filter";
import type { PriceMode } from "@/lib/listings/types";
import { cachedCard } from "@/lib/queries";
import { isDefaultSearch, PRICE_RANGE, SORT_ORDERS, useAppliedSearch } from "@/lib/search-params";
import { useMapUi } from "@/lib/store";

import { StatusText } from "./status-text";

const SORT_LABELS: Record<SortOrder, string> = {
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  updated: "Recently updated",
};

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const isMode = (value: string): value is PriceMode => value === "day" || value === "month";
const isSort = (value: string): value is SortOrder =>
  (SORT_ORDERS as readonly string[]).includes(value);

/** `Max ฿800 / day`, `Max ฿15,000 / mo`, `Max ฿3,000+ / day` (no limit). */
function maxLabel(mode: PriceMode, max: number): string {
  const value =
    max === Number.POSITIVE_INFINITY
      ? `${intFormat.format(PRICE_RANGE[mode].max)}+`
      : intFormat.format(max);
  return `Max ฿${value} / ${mode === "month" ? "mo" : "day"}`;
}

/**
 * Search controls. Every control applies at once: the slider on release (pointer up or a
 * keyboard step, not while dragging), the mode toggle, the call-for-price switch and sort on
 * change. The applied search lives in the URL.
 *
 * Under `md` the bar collapses (CSS) to the logo, the mode toggle and a "Filters" button that
 * opens a drawer with the same slider, switch and sort.
 */
export function TopBar() {
  const [applied, setApplied] = useAppliedSearch();
  const queryClient = useQueryClient();
  const callId = useId();
  const drawerCallId = useId();

  /**
   * Applies a search; keeps the selection only if it still passes the new filter, judged on its
   * cached card. A selection whose card isn't loaded yet is kept.
   */
  const apply = (next: Search) => {
    setApplied(next);
    const { selectedId, select } = useMapUi.getState();
    if (selectedId === null) return;
    const listing = cachedCard(queryClient, selectedId);
    if (listing === undefined) return;
    if (listing === null || listing.deleted || !matchesSearch(listing, next)) select(null, null);
  };

  const onModeChange = (value: string) => {
    if (!isMode(value) || value === applied.mode) return;
    apply({ ...applied, mode: value, max: PRICE_RANGE[value].default });
  };

  const resetButton = (className?: string) =>
    isDefaultSearch(applied) ? null : (
      <Button size="sm" variant="ghost" onClick={() => apply(DEFAULT_SEARCH)} className={className}>
        Reset
      </Button>
    );

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:gap-4 md:px-4">
      <Logo className="md:mr-2" />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={applied.mode}
        onValueChange={onModeChange}
        aria-label="Price mode"
      >
        <ToggleGroupItem value="day" className="px-3">
          Per day
        </ToggleGroupItem>
        <ToggleGroupItem value="month" className="px-3">
          Per month
        </ToggleGroupItem>
      </ToggleGroup>

      <MaxSlider applied={applied} apply={apply} className="w-44 max-md:hidden" />

      <CallSwitch id={callId} applied={applied} apply={apply} className="max-md:hidden" />

      {resetButton("max-md:hidden")}

      <SortSelect applied={applied} setApplied={setApplied} className="max-md:hidden" />

      <StatusText className="ml-auto max-md:hidden" />

      <Drawer>
        <DrawerTrigger asChild>
          <Button size="sm" variant="outline" className="relative ml-auto md:hidden">
            <SlidersHorizontal aria-hidden />
            Filters
            {isDefaultSearch(applied) ? null : (
              <span
                aria-label="(active)"
                className="absolute -top-1 -right-1 size-2.5 rounded-full bg-brand ring-2 ring-background"
              />
            )}
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle>Filters</DrawerTitle>
            <DrawerDescription>
              {applied.mode === "month" ? "Monthly" : "Daily"} prices. Switch the mode in the top
              bar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-5 px-4 py-2">
            <MaxSlider applied={applied} apply={apply} />
            <CallSwitch id={drawerCallId} applied={applied} apply={apply} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Sort</span>
              <SortSelect applied={applied} setApplied={setApplied} />
            </div>
          </div>
          <DrawerFooter className="flex-row">
            {resetButton("h-9 flex-1")}
            <DrawerClose asChild>
              <Button size="sm" variant="outline" className="h-9 flex-1">
                Done
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </header>
  );
}

type ControlProps = {
  applied: Search;
  apply: (search: Search) => void;
  className?: string;
};

/**
 * `Max ฿800 / day` label and the slider for the applied mode. While dragging only the label and
 * thumb follow (`live`); the search is applied once, on release. `live` remembers the search it
 * was made against, so it's dropped as soon as a search applies.
 *
 * A pointer drag is committed from `lostPointerCapture` with the last value seen in
 * `onValueChange`, not from Radix's `onValueCommit`: that one compares against a render-time
 * copy of the value, which lags behind a fast release (pointermove updates aren't rendered
 * synchronously) and never fires inside the vaul drawer. `onValueCommit` still handles the
 * keyboard (it passes the new value directly).
 */
function MaxSlider({ applied, apply, className }: ControlProps) {
  const { mode } = applied;
  const range = PRICE_RANGE[mode];
  const [live, setLive] = useState<{ value: number; base: Search } | null>(null);
  const pointer = useRef<{ latest: number | null } | null>(null);
  const toMax = (value: number) => (value >= range.max ? Number.POSITIVE_INFINITY : value);
  const commit = (value: number) => apply({ ...applied, max: toMax(value) });
  const max = live?.base === applied ? toMax(live.value) : applied.max;
  return (
    <div className={cn("flex shrink-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium tabular-nums">{maxLabel(mode, max)}</span>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step}
        value={[max === Number.POSITIVE_INFINITY ? range.max : max]}
        onPointerDown={() => {
          pointer.current = { latest: null };
        }}
        onLostPointerCapture={() => {
          const latest = pointer.current?.latest ?? null;
          pointer.current = null;
          if (latest !== null) commit(latest);
        }}
        onValueChange={([value]) => {
          if (value === undefined) return;
          if (pointer.current) pointer.current.latest = value;
          setLive({ value, base: applied });
        }}
        onValueCommit={([value]) => {
          if (value !== undefined && !pointer.current) commit(value);
        }}
        aria-label="Maximum price"
        data-vaul-no-drag
      />
    </div>
  );
}

function CallSwitch({ id, applied, apply, className }: ControlProps & { id: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Switch
        id={id}
        size="sm"
        checked={applied.call}
        onCheckedChange={(call) => apply({ ...applied, call })}
      />
      <label htmlFor={id} className="text-sm whitespace-nowrap">
        Include call-for-price
      </label>
    </div>
  );
}

/** Sort applies immediately. */
function SortSelect({
  applied,
  setApplied,
  className,
}: {
  applied: Search;
  setApplied: (search: Search) => void;
  className?: string;
}) {
  return (
    <Select
      value={applied.sort}
      onValueChange={(value) => {
        if (isSort(value)) setApplied({ ...applied, sort: value });
      }}
    >
      <SelectTrigger size="sm" aria-label="Sort" className={cn("shrink-0", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {SORT_ORDERS.map((sort) => (
          <SelectItem key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
