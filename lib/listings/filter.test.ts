import { describe, expect, it } from "vitest";

import { applySearch, DEFAULT_SEARCH, hasLocation, inBounds, type Search } from "./filter";
import type { ListingSummary, PriceRange } from "./types";

const amount = (min: number | null, max: number | null = min): PriceRange => ({
  type: "AMOUNT",
  min,
  max,
});
const call: PriceRange = { type: "CALL", min: null, max: null };
const none: PriceRange = { type: "NO_DAILY_RENTAL", min: null, max: null };

function listing(id: string, overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    id,
    slug: `slug-${id}`,
    name: `Listing ${id}`,
    district: null,
    subdistrict: null,
    lat: 18.79,
    lng: 98.98,
    daily: none,
    monthly: { type: "NO_MONTHLY_RENTAL", min: null, max: null },
    cover: null,
    pictures: [],
    roomCount: 1,
    refreshedAt: null,
    deleted: false,
    ...overrides,
  };
}

const ids = (list: ListingSummary[]) => list.map((item) => item.id);

describe("applySearch", () => {
  const listings = [
    listing("a", { daily: amount(500, 700), monthly: amount(9000) }),
    listing("b", { daily: amount(800), monthly: call }),
    listing("c", { daily: amount(801), monthly: amount(15_000, 20_000) }),
    listing("d", { daily: call, monthly: amount(16_000) }),
    listing("e", { daily: none, monthly: amount(3000) }),
    listing("f", { daily: amount(null, 300) }),
    listing("g", { daily: amount(null, null) }),
    listing("h", { daily: amount(100) }),
  ];

  it("filters day mode by daily min ≤ max, AMOUNT only", () => {
    expect(ids(applySearch(listings, DEFAULT_SEARCH))).toEqual(["h", "f", "a", "b"]);
  });

  it("includes daily CALL listings last when the switch is on", () => {
    expect(ids(applySearch(listings, { ...DEFAULT_SEARCH, call: true }))).toEqual([
      "h",
      "f",
      "a",
      "b",
      "d",
    ]);
  });

  it("sorts price descending with CALL still last", () => {
    const search: Search = { ...DEFAULT_SEARCH, call: true, sort: "price-desc" };
    expect(ids(applySearch(listings, search))).toEqual(["b", "a", "f", "h", "d"]);
  });

  it("filters month mode by the monthly price", () => {
    const search: Search = { mode: "month", max: 15_000, call: false, sort: "price-asc" };
    expect(ids(applySearch(listings, search))).toEqual(["e", "a", "c"]);
    expect(ids(applySearch(listings, { ...search, call: true }))).toEqual(["e", "a", "c", "b"]);
  });

  it("breaks price ties by id", () => {
    const tied = [listing("z", { daily: amount(500) }), listing("y", { daily: amount(500) })];
    expect(ids(applySearch(tied, DEFAULT_SEARCH))).toEqual(["y", "z"]);
  });

  it("sorts by refreshedAt newest first, nulls last", () => {
    const list = [
      listing("old", { daily: amount(100), refreshedAt: "2026-01-01T00:00:00Z" }),
      listing("never", { daily: amount(100) }),
      listing("new", { daily: amount(100), refreshedAt: "2026-10-01T00:00:00Z" }),
    ];
    expect(ids(applySearch(list, { ...DEFAULT_SEARCH, sort: "updated" }))).toEqual([
      "new",
      "old",
      "never",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [listing("b", { daily: amount(200) }), listing("a", { daily: amount(100) })];
    applySearch(input, DEFAULT_SEARCH);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("inBounds", () => {
  const bounds = { north: 19, south: 18, east: 99, west: 98 };

  it("accepts points inside, including the edges", () => {
    expect(inBounds({ lat: 18.5, lng: 98.5 }, bounds)).toBe(true);
    expect(inBounds({ lat: 19, lng: 98 }, bounds)).toBe(true);
  });

  it("rejects points outside and missing coordinates", () => {
    expect(inBounds({ lat: 19.1, lng: 98.5 }, bounds)).toBe(false);
    expect(inBounds({ lat: 18.5, lng: 99.1 }, bounds)).toBe(false);
    expect(inBounds({ lat: null, lng: 98.5 }, bounds)).toBe(false);
    expect(inBounds({ lat: 18.5, lng: null }, bounds)).toBe(false);
  });

  it("handles bounds crossing the antimeridian", () => {
    const wrap = { north: 10, south: -10, east: -170, west: 170 };
    expect(inBounds({ lat: 0, lng: 175 }, wrap)).toBe(true);
    expect(inBounds({ lat: 0, lng: -175 }, wrap)).toBe(true);
    expect(inBounds({ lat: 0, lng: 0 }, wrap)).toBe(false);
  });
});

describe("hasLocation", () => {
  it("requires both coordinates", () => {
    expect(hasLocation(listing("a"))).toBe(true);
    expect(hasLocation(listing("b", { lat: null }))).toBe(false);
  });
});
