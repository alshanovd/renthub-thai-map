import { describe, expect, it } from "vitest";

import type { Bounds } from "@/lib/store";

import type { Pin } from "./types";
import { computeTabCounts, computeVisibleItems, pinsInView, type VisibleInput } from "./visible";

function pin(id: string, overrides: Partial<Pin> = {}): Pin {
  return { id, lat: 18.79, lng: 98.98, price: 500, kind: "amount", ...overrides };
}

const bounds: Bounds = { north: 18.8, south: 18.78, east: 99, west: 98.97 };
// Server order (e.g. price ascending): cheap, outside (in the expanded bbox only), pricey.
const cheap = pin("cheap", { price: 300 });
const outside = pin("out", { lat: 18.9, price: 400 });
const pricey = pin("pricey", { price: 700 });
const call = pin("call", { price: null, kind: "call" });
const pins = [cheap, outside, pricey, call];

const base: VisibleInput = {
  tab: "map",
  pins,
  bounds,
  selectedId: null,
  selectedPin: null,
  favoriteIds: [],
  noLocationIds: [],
};

const ids = (input: Partial<VisibleInput>) =>
  computeVisibleItems({ ...base, ...input }).map((v) => `${v.id}${v.outsideView ? "*" : ""}`);

describe("computeVisibleItems: map tab", () => {
  it("keeps only pins inside the actual bounds, in the server's order", () => {
    expect(ids({})).toEqual(["cheap", "pricey", "call"]);
    expect(ids({ pins: [call, pricey, cheap] })).toEqual(["call", "pricey", "cheap"]);
  });

  it("carries the pin (for the skeleton's price)", () => {
    expect(computeVisibleItems(base)[0].pin).toBe(cheap);
  });

  it("is empty until the map reports its bounds", () => {
    expect(ids({ bounds: null })).toEqual([]);
  });

  it("doesn't duplicate a selected listing that's already in view", () => {
    expect(ids({ selectedId: "pricey" })).toEqual(["cheap", "pricey", "call"]);
  });

  it("prepends a selected pin that's loaded but outside the view", () => {
    expect(ids({ selectedId: "out" })).toEqual(["out*", "cheap", "pricey", "call"]);
  });

  it("keeps the selection from its card when the search filters it out", () => {
    const expensive = pin("expensive", { lat: 18.95, price: 5000 });
    expect(ids({ selectedId: "expensive", selectedPin: expensive })).toEqual([
      "expensive*",
      "cheap",
      "pricey",
      "call",
    ]);
  });

  it("keeps the selection before the bounds are known", () => {
    expect(ids({ bounds: null, selectedId: "out" })).toEqual(["out*"]);
  });

  it("shows nothing extra while the selection's location is unknown", () => {
    expect(ids({ selectedId: "missing" })).toEqual(["cheap", "pricey", "call"]);
    // A stale selectedPin of another listing is ignored.
    expect(ids({ selectedId: "missing", selectedPin: pin("other") })).toEqual([
      "cheap",
      "pricey",
      "call",
    ]);
  });
});

describe("computeVisibleItems: favorites tab", () => {
  it("is empty without favorites", () => {
    expect(ids({ tab: "favorites" })).toEqual([]);
  });

  it("ignores the search, bounds and selection; keeps favorite order once per id", () => {
    expect(
      ids({ tab: "favorites", favoriteIds: ["gone", "noloc", "out", "noloc"], selectedId: "x" }),
    ).toEqual(["gone", "noloc", "out"]);
  });
});

describe("computeVisibleItems: no-location tab", () => {
  it("lists the loaded no-location ids, ignoring bounds and selection", () => {
    expect(
      ids({ tab: "nolocation", bounds: null, selectedId: "out", noLocationIds: ["a", "b"] }),
    ).toEqual(["a", "b"]);
  });
});

describe("pinsInView", () => {
  it("filters by the unexpanded bounds and keeps order", () => {
    expect(pinsInView(pins, bounds).map((p) => p.id)).toEqual(["cheap", "pricey", "call"]);
    expect(pinsInView(pins, null)).toEqual([]);
  });
});

describe("computeTabCounts", () => {
  it("counts pins in view, favorite ids and the no-location total", () => {
    expect(
      computeTabCounts({
        pins,
        bounds,
        favoriteIds: ["out", "unknown", "out"],
        noLocationTotal: 4,
      }),
    ).toEqual({ map: 3, favorites: 2, nolocation: 4 });
    expect(
      computeTabCounts({ pins, bounds: null, favoriteIds: [], noLocationTotal: null }),
    ).toEqual({ map: 0, favorites: 0, nolocation: 0 });
  });
});
