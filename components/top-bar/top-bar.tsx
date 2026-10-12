"use client";

import { cn } from "cn";
import { type KeyboardEvent, useId, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
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

  const dirty = !sameDraft(draft, appliedDraft);
  const range = PRICE_RANGE[draft.mode];
  const callId = useId();

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

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    // Ignore events bubbling through portals (the sort menu) and buttons with their own action.
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || target.closest("[data-native-enter]")) return;
    event.preventDefault();
    applyDraft();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4" onKeyDown={onKeyDown}>
      <Logo className="mr-2" />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={draft.mode}
        onValueChange={(value) => {
          if (isMode(value) && value !== draft.mode) {
            setDraft({ ...draft, mode: value, max: PRICE_RANGE[value].default });
          }
        }}
        aria-label="Price mode"
      >
        <ToggleGroupItem value="day" className="px-3">
          Per day
        </ToggleGroupItem>
        <ToggleGroupItem value="month" className="px-3">
          Per month
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="flex w-44 shrink-0 flex-col gap-1.5">
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

      <div className="flex shrink-0 items-center gap-2">
        <Switch
          id={callId}
          size="sm"
          checked={draft.call}
          onCheckedChange={(call) => setDraft({ ...draft, call })}
        />
        <label htmlFor={callId} className="text-sm whitespace-nowrap">
          Include call-for-price
        </label>
      </div>

      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty}
        onClick={applyDraft}
        data-native-enter
        className={cn("px-4", dirty && "animate-pulse")}
      >
        Search
      </Button>

      {!isDefaultSearch(applied) && (
        <Button size="sm" variant="ghost" onClick={() => apply(DEFAULT_SEARCH)} data-native-enter>
          Reset
        </Button>
      )}

      <Select
        value={applied.sort}
        onValueChange={(value) => {
          if (isSort(value)) setApplied({ ...applied, sort: value });
        }}
      >
        <SelectTrigger size="sm" aria-label="Sort" className="shrink-0">
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

      <StatusText
        listings={listings}
        filtered={filtered}
        lastScrapeAt={lastScrapeAt}
        className="ml-auto"
      />
    </header>
  );
}
