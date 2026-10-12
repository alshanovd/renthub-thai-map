"use client";

import { cn } from "cn";
import { SlidersHorizontal } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Drawer,
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
import type { ListingSummary, PriceMode } from "@/lib/listings/types";
import {
  isDefaultSearch,
  PRICE_RANGE,
  sameDraft,
  type SearchDraft,
  SORT_ORDERS,
  useAppliedSearch,
} from "@/lib/search-params";
import { useMapUi } from "@/lib/store";
import { useIsMobile } from "@/lib/use-media-query";

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

const toDraft = ({ mode, max, call }: Search): SearchDraft => ({ mode, max, call });

/** `Max ฿800 / day`, `Max ฿15,000 / mo`, `Max ฿3,000+ / day` (no limit). */
function maxLabel({ mode, max }: SearchDraft): string {
  const value =
    max === Number.POSITIVE_INFINITY
      ? `${intFormat.format(PRICE_RANGE[mode].max)}+`
      : intFormat.format(max);
  return `Max ฿${value} / ${mode === "month" ? "mo" : "day"}`;
}

type TopBarProps = {
  /** Every listing in the payload (to check whether the selection survives a new search). */
  listings: readonly ListingSummary[];
  /** The payload after the applied search. */
  filtered: readonly ListingSummary[];
  lastScrapeAt: string | null;
};

/**
 * Search controls. Mode, max price and call-for-price are a draft applied with Search (or Enter
 * anywhere in the bar); sort applies immediately. The applied search lives in the URL.
 *
 * Under `md` the bar collapses (CSS) to the logo, the mode toggle and a "Filters" button that
 * opens a drawer with the same slider, switch, sort and Search, driven by the same draft. There
 * the mode toggle applies at once (the slider and Search are hidden in the drawer).
 */
export function TopBar({ listings, filtered, lastScrapeAt }: TopBarProps) {
  const [applied, setApplied] = useAppliedSearch();
  const appliedDraft = toDraft(applied);
  const [draft, setDraft] = useState<SearchDraft>(appliedDraft);
  // The draft follows the applied search whenever that changes (URL load, Reset, Search).
  const [draftBase, setDraftBase] = useState<SearchDraft>(appliedDraft);
  if (!sameDraft(draftBase, appliedDraft)) {
    setDraftBase(appliedDraft);
    setDraft(appliedDraft);
  }

  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dirty = !sameDraft(draft, appliedDraft);
  const callId = useId();
  const drawerCallId = useId();

  /** Applies a search; keeps the selection only if it still passes the new filter. */
  const apply = (next: Search) => {
    setApplied(next);
    const { selectedId, select } = useMapUi.getState();
    if (selectedId === null) return;
    const listing = listings.find((item) => item.id === selectedId);
    if (!listing || !matchesSearch(listing, next)) select(null, null);
  };

  const applyDraft = () => {
    if (dirty) apply({ ...applied, ...draft });
  };

  const onModeChange = (value: string) => {
    if (!isMode(value) || value === draft.mode) return;
    const max = PRICE_RANGE[value].default;
    if (isMobile) apply({ ...applied, mode: value, max });
    else setDraft({ ...draft, mode: value, max });
  };

  /** Enter applies the draft (`after` runs once it did, e.g. closing the drawer). */
  const enterApplies = (after?: () => void) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    // Ignore events bubbling through portals (the sort menu) and buttons with their own action.
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || target.closest("[data-native-enter]")) return;
    event.preventDefault();
    applyDraft();
    after?.();
  };

  const searchButton = (className?: string, after?: () => void) => (
    <Button
      size="sm"
      variant={dirty ? "default" : "outline"}
      disabled={!dirty}
      onClick={() => {
        applyDraft();
        after?.();
      }}
      data-native-enter
      className={cn("px-4", dirty && "animate-pulse", className)}
    >
      Search
    </Button>
  );

  const resetButton = (className?: string) =>
    isDefaultSearch(applied) ? null : (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => apply(DEFAULT_SEARCH)}
        data-native-enter
        className={className}
      >
        Reset
      </Button>
    );

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:gap-4 md:px-4"
      onKeyDown={enterApplies()}
    >
      <Logo className="md:mr-2" />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={draft.mode}
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

      <MaxSlider draft={draft} setDraft={setDraft} className="w-44 max-md:hidden" />

      <CallSwitch id={callId} draft={draft} setDraft={setDraft} className="max-md:hidden" />

      {searchButton("max-md:hidden")}

      {resetButton("max-md:hidden")}

      <SortSelect applied={applied} setApplied={setApplied} className="max-md:hidden" />

      <StatusText
        listings={listings}
        filtered={filtered}
        lastScrapeAt={lastScrapeAt}
        className="ml-auto max-md:hidden"
      />

      <Drawer
        open={filtersOpen}
        onOpenChange={(open) => {
          setFiltersOpen(open);
          // Closing without Search drops the unsaved draft.
          if (!open) setDraft(appliedDraft);
        }}
      >
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
        <DrawerContent onKeyDown={enterApplies(() => setFiltersOpen(false))}>
          <DrawerHeader className="pb-2">
            <DrawerTitle>Filters</DrawerTitle>
            <DrawerDescription>
              {draft.mode === "month" ? "Monthly" : "Daily"} prices. Switch the mode in the top bar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-5 px-4 py-2">
            <MaxSlider draft={draft} setDraft={setDraft} />
            <CallSwitch id={drawerCallId} draft={draft} setDraft={setDraft} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Sort</span>
              <SortSelect applied={applied} setApplied={setApplied} />
            </div>
          </div>
          <DrawerFooter className="flex-row">
            {resetButton("h-9 flex-1")}
            {searchButton("h-9 flex-1", () => setFiltersOpen(false))}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </header>
  );
}

type DraftProps = {
  draft: SearchDraft;
  setDraft: (draft: SearchDraft) => void;
  className?: string;
};

/** `Max ฿800 / day` label and the slider for the draft's mode. */
function MaxSlider({ draft, setDraft, className }: DraftProps) {
  const range = PRICE_RANGE[draft.mode];
  return (
    <div className={cn("flex shrink-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium tabular-nums">{maxLabel(draft)}</span>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step}
        value={[draft.max === Number.POSITIVE_INFINITY ? range.max : draft.max]}
        onValueChange={([value]) => {
          if (value === undefined) return;
          setDraft({ ...draft, max: value >= range.max ? Number.POSITIVE_INFINITY : value });
        }}
        aria-label="Maximum price"
      />
    </div>
  );
}

function CallSwitch({ id, draft, setDraft, className }: DraftProps & { id: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Switch
        id={id}
        size="sm"
        checked={draft.call}
        onCheckedChange={(call) => setDraft({ ...draft, call })}
      />
      <label htmlFor={id} className="text-sm whitespace-nowrap">
        Include call-for-price
      </label>
    </div>
  );
}

/** Sort applies immediately (no draft). */
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
