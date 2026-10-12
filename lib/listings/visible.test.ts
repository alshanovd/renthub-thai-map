import { describe, expect, it } from "vitest";

import type { Bounds } from "@/lib/store";

import type { ListingSummary } from "./types";
import { computeTabCounts, computeVisibleItems, type VisibleInput } from "./visible";

function listing(id: string, overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    id,
    slug: `slug-${id}`,
    name: `Listing ${id}`,
    district: null,
    subdistrict: null,
    lat: 18.79,
    lng: 98.98,
    daily: { type: "AMOUNT", min: 500, max: 500 },
    monthly: { type: "NO_MONTHLY_RENTAL", min: null, max: null },
    cover: null,
    pictures: [],
    roomCount: 1,
    refreshedAt: null,
    deleted: false,
    ...overrides,
  };
}

const bounds: Bounds = { north: 18.8, south: 18.78, east: 99, west: 98.97 };
const inside = listing("in");
const outside = listing("out", { lat: 18.9 });
const noLoc = listing("noloc", { lat: null, lng: null });
const filteredOut = listing("expensive", { lat: 18.95 });
const all = [inside, outside, noLoc, filteredOut];
const filtered = [inside, outside, noLoc];

const base: VisibleInput = {
  tab: "map",
  listings: all,
  filtered,
  bounds,
  selectedId: null,
  favoriteIds: [],
};

const ids = (input: Partial<VisibleInput>) =>
  computeVisibleItems({ ...base, ...input }).map(
    (v) => `${v.listing.id}${v.outsideView ? "*" : ""}`,
  );

describe("computeVisibleItems: map tab", () => {
  it("keeps filtered listings inside the bounds", () => {
    expect(ids({})).toEqual(["in"]);
  });

  it("is empty until the map reports its bounds", () => {
    expect(ids({ bounds: null })).toEqual([]);
  });

  it("doesn't duplicate a selected listing that's already in view", () => {
    expect(ids({ selectedId: "in" })).toEqual(["in"]);
  });

  it("prepends the selected listing when it's outside the bounds", () => {
    expect(ids({ selectedId: "out" })).toEqual(["out*", "in"]);
  });

  it("keeps the selection even when the search filters it out", () => {
    expect(ids({ selectedId: "expensive" })).toEqual(["expensive*", "in"]);
  });

  it("keeps the selection before the bounds are known", () => {
    expect(ids({ bounds: null, selectedId: "out" })).toEqual(["out*"]);
  });

  it("shows nothing extra for a selection without coordinates or an unknown id", () => {
    expect(ids({ selectedId: "noloc" })).toEqual(["in"]);
    expect(ids({ selectedId: "missing" })).toEqual(["in"]);
  });
});

describe("computeVisibleItems: favorites tab", () => {
  const gone = listing("gone", { deleted: true });

  it("is empty without favorites", () => {
    expect(ids({ tab: "favorites" })).toEqual([]);
  });

  it("ignores the search and bounds, keeps favorite order, includes no-location", () => {
    expect(
      ids({ tab: "favorites", favoriteIds: ["expensive", "noloc", "out"], selectedId: "in" }),
    ).toEqual(["expensive", "noloc", "out"]);
  });

  it("unions the payload with fetched (soft-deleted) listings and skips unknown ids", () => {
    expect(
      ids({
        tab: "favorites",
        favoriteIds: ["gone", "unknown", "in", "in"],
        extraListings: [gone],
      }),
    ).toEqual(["gone", "in"]);
  });
});

describe("computeVisibleItems: no-location tab", () => {
  it("lists filtered listings without coordinates, ignoring bounds and selection", () => {
    expect(ids({ tab: "nolocation", bounds: null, selectedId: "out" })).toEqual(["noloc"]);
  });
});

describe("computeTabCounts", () => {
  it("counts listings in view, resolvable favorites and no-location listings", () => {
    expect(computeTabCounts({ ...base, favoriteIds: ["out", "unknown"] })).toEqual({
      map: 1,
      favorites: 1,
      nolocation: 1,
    });
    expect(computeTabCounts({ ...base, bounds: null }).map).toBe(0);
  });
});
