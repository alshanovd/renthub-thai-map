import { describe, expect, it } from "vitest";

import {
  bboxFromParam,
  bboxToParam,
  decodeCursor,
  encodeCursor,
  idsFromParam,
  limitFromParam,
  ParamError,
  searchFromParams,
  searchToParams,
  snapBounds,
  snapStep,
  THAILAND,
} from "./api-params";
import { DEFAULT_SEARCH, type Search } from "./filter";

const INF = Number.POSITIVE_INFINITY;
const params = (query: string) => new URLSearchParams(query);
const roundTrip = (search: Search) => searchFromParams(searchToParams(search));

describe("searchFromParams / searchToParams", () => {
  it("round-trips searches, including no limit", () => {
    const searches: Search[] = [
      DEFAULT_SEARCH,
      { mode: "day", max: INF, call: true, sort: "price-desc" },
      { mode: "month", max: 15_000, call: false, sort: "updated" },
      { mode: "month", max: INF, call: true, sort: "price-asc" },
    ];
    for (const search of searches) expect(roundTrip(search)).toEqual(search);
  });

  it("always writes all four params in a fixed order", () => {
    expect(searchToParams(DEFAULT_SEARCH).toString()).toBe(
      "mode=day&max=800&call=0&sort=price-asc",
    );
    expect(searchToParams({ ...DEFAULT_SEARCH, mode: "month", max: INF }).toString()).toBe(
      "mode=month&max=60000&call=0&sort=price-asc",
    );
  });

  it("defaults: day, no limit, no call-for-price, price-asc", () => {
    expect(searchFromParams(params(""))).toEqual({ ...DEFAULT_SEARCH, max: INF });
  });

  it("clamps max like the page URL", () => {
    expect(searchFromParams(params("max=10")).max).toBe(100);
    expect(searchFromParams(params("max=1234")).max).toBe(1234);
    expect(searchFromParams(params("max=3000")).max).toBe(INF);
    expect(searchFromParams(params("max=99999")).max).toBe(INF);
    expect(searchFromParams(params("mode=month&max=900")).max).toBe(2000);
    expect(searchFromParams(params("mode=month&max=60000")).max).toBe(INF);
  });

  it("accepts call as 1/0/true/false", () => {
    expect(searchFromParams(params("call=1")).call).toBe(true);
    expect(searchFromParams(params("call=true")).call).toBe(true);
    expect(searchFromParams(params("call=0")).call).toBe(false);
    expect(searchFromParams(params("call=false")).call).toBe(false);
  });

  it("rejects unknown values", () => {
    for (const query of ["mode=year", "max=abc", "max=-5", "max=1.5", "call=yes", "sort=name"]) {
      expect(() => searchFromParams(params(query)), query).toThrow(ParamError);
    }
  });
});

describe("bbox params", () => {
  const box = { south: 18.7, west: 98.9, north: 18.85, east: 99.05 };

  it("serializes with 5 decimals and parses back", () => {
    expect(bboxToParam(box)).toBe("18.70000,98.90000,18.85000,99.05000");
    expect(bboxFromParam(bboxToParam(box))).toEqual(box);
    expect(bboxToParam({ ...box, south: 18.123456789 })).toMatch(/^18\.12346,/);
  });

  it("clamps to Thailand", () => {
    expect(bboxFromParam("0,90,30,110")).toEqual(THAILAND);
    expect(bboxFromParam("18,104,19,106")).toEqual({
      south: 18,
      west: 104,
      north: 19,
      east: 105.7,
    });
  });

  it("rejects malformed boxes", () => {
    for (const value of [
      null,
      "",
      "1,2,3",
      "1,2,3,4,5",
      "18,98,abc,99",
      "18,98,,99",
      "18,98,Infinity,99",
      "19,98,18,99", // south > north
      "18,98,18,99", // empty
      "18,99,19,98", // west > east (antimeridian)
      "40,98,41,99", // outside Thailand
    ]) {
      expect(() => bboxFromParam(value), String(value)).toThrow(ParamError);
    }
  });
});

describe("snapBounds", () => {
  const view = { south: 18.76, west: 98.95, north: 18.81, east: 99.02 };

  it("uses 0.005° at zoom 14, doubling per level out, clamped to zoom 8–16", () => {
    expect(snapStep(14)).toBe(0.005);
    expect(snapStep(13)).toBe(0.01);
    expect(snapStep(13.7)).toBe(0.01);
    expect(snapStep(16)).toBe(0.00125);
    expect(snapStep(20)).toBe(0.00125);
    expect(snapStep(8)).toBe(0.32);
    expect(snapStep(3)).toBe(0.32);
  });

  it("expands by at least 25% per side and lands on the grid", () => {
    for (const zoom of [8, 10, 12, 13, 14, 15, 16]) {
      const snapped = snapBounds(view, zoom);
      expect(snapped).not.toBeNull();
      if (!snapped) continue;
      const latPad = (view.north - view.south) * 0.25;
      const lngPad = (view.east - view.west) * 0.25;
      expect(snapped.south).toBeLessThanOrEqual(view.south - latPad + 1e-9);
      expect(snapped.north).toBeGreaterThanOrEqual(view.north + latPad - 1e-9);
      expect(snapped.west).toBeLessThanOrEqual(view.west - lngPad + 1e-9);
      expect(snapped.east).toBeGreaterThanOrEqual(view.east + lngPad - 1e-9);
      const step = snapStep(zoom);
      for (const value of Object.values(snapped)) {
        const cells = value / step;
        expect(
          Math.abs(cells - Math.round(cells)),
          `${String(value)} @${String(zoom)}`,
        ).toBeLessThan(1e-6);
      }
    }
  });

  it("gives the same box for small pans", () => {
    const pan = (dLat: number, dLng: number) => ({
      south: view.south + dLat,
      north: view.north + dLat,
      west: view.west + dLng,
      east: view.east + dLng,
    });
    expect(snapBounds(pan(0.0004, 0.0004), 13)).toEqual(snapBounds(view, 13));
    expect(bboxToParam(snapBounds(pan(-0.0003, 0.0002), 13) ?? THAILAND)).toBe(
      bboxToParam(snapBounds(view, 13) ?? THAILAND),
    );
  });

  it("only grows (never shrinks) as the zoom level decreases", () => {
    let previous = snapBounds(view, 16);
    for (let zoom = 15; zoom >= 8; zoom -= 1) {
      const current = snapBounds(view, zoom);
      if (!previous || !current) throw new Error("expected a box");
      expect(current.south).toBeLessThanOrEqual(previous.south);
      expect(current.west).toBeLessThanOrEqual(previous.west);
      expect(current.north).toBeGreaterThanOrEqual(previous.north);
      expect(current.east).toBeGreaterThanOrEqual(previous.east);
      previous = current;
    }
  });

  it("clamps to Thailand and returns null outside it or across the antimeridian", () => {
    const wide = snapBounds({ south: 0, west: 90, north: 30, east: 110 }, 5);
    expect(wide).toEqual(THAILAND);
    expect(snapBounds({ south: 40, west: 98, north: 41, east: 99 }, 10)).toBeNull();
    expect(snapBounds({ south: 18, west: 179, north: 19, east: -179 }, 10)).toBeNull();
  });

  it("produces boxes the server accepts unchanged", () => {
    const snapped = snapBounds(view, 13);
    if (!snapped) throw new Error("expected a box");
    expect(bboxFromParam(bboxToParam(snapped))).toEqual(snapped);
  });
});

describe("ids, cursor and limit", () => {
  it("parses, trims and de-duplicates ids", () => {
    expect(idsFromParam(" 10512, 10576 ,10512,,abc-1_2")).toEqual(["10512", "10576", "abc-1_2"]);
  });

  it("rejects empty, too many and malformed ids", () => {
    const many = Array.from({ length: 101 }, (_, i) => String(i)).join(",");
    for (const value of [null, "", ",", many, "1;drop", "a b", "x".repeat(65)]) {
      expect(() => idsFromParam(value), String(value).slice(0, 20)).toThrow(ParamError);
    }
    expect(idsFromParam(Array.from({ length: 100 }, (_, i) => String(i)).join(","))).toHaveLength(
      100,
    );
    expect(() => idsFromParam(many, 200)).not.toThrow();
  });

  it("round-trips cursors and rejects garbage", () => {
    for (const offset of [0, 20, 40, 12_345]) {
      const cursor = encodeCursor(offset);
      expect(cursor).toMatch(/^[\w-]+$/);
      expect(decodeCursor(cursor)).toBe(offset);
    }
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor("")).toBe(0);
    for (const cursor of ["!!", "abc", encodeCursor(-1), "a".repeat(40)]) {
      expect(() => decodeCursor(cursor), cursor).toThrow(ParamError);
    }
  });

  it("limits the page size to 1–50, default 20", () => {
    expect(limitFromParam(null)).toBe(20);
    expect(limitFromParam("1")).toBe(1);
    expect(limitFromParam("50")).toBe(50);
    for (const value of ["0", "51", "-1", "abc", "2.5"]) {
      expect(() => limitFromParam(value), value).toThrow(ParamError);
    }
  });
});
