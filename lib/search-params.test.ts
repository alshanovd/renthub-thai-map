import { createLoader } from "nuqs";
import { describe, expect, it } from "vitest";

import { DEFAULT_SEARCH, type Search } from "./listings/filter";
import {
  clampMax,
  isDefaultSearch,
  normalizeSearch,
  sameSearch,
  searchFromUrl,
  searchParsers,
  searchToUrl,
  serializeSearch,
} from "./search-params";

const INF = Number.POSITIVE_INFINITY;
const loadSearch = createLoader(searchParsers);

/** Search → query string → Search, the way the browser round-trips it. */
const roundTrip = (search: Search) =>
  searchFromUrl(loadSearch(serializeSearch(searchToUrl(search))));
const parse = (query: string) => searchFromUrl(loadSearch(query));

describe("search equality", () => {
  it("compares mode, max, call and sort", () => {
    expect(sameSearch({ ...DEFAULT_SEARCH, max: 800 }, DEFAULT_SEARCH)).toBe(true);
    expect(sameSearch({ ...DEFAULT_SEARCH, max: 850 }, DEFAULT_SEARCH)).toBe(false);
    expect(sameSearch({ ...DEFAULT_SEARCH, call: true }, DEFAULT_SEARCH)).toBe(false);
    expect(sameSearch({ ...DEFAULT_SEARCH, mode: "month" }, DEFAULT_SEARCH)).toBe(false);
    expect(sameSearch({ ...DEFAULT_SEARCH, sort: "updated" }, DEFAULT_SEARCH)).toBe(false);
  });

  it("treats Infinity and the top of the range as the same (no limit)", () => {
    const inf: Search = { ...DEFAULT_SEARCH, max: INF };
    expect(sameSearch(inf, { ...inf })).toBe(true);
    expect(sameSearch(inf, { ...inf, max: 3000 })).toBe(true);
    expect(sameSearch(inf, { ...inf, max: 2950 })).toBe(false);
    expect(sameSearch({ ...inf, mode: "month" }, { ...inf, mode: "month", max: 60_000 })).toBe(
      true,
    );
  });

  it("isDefaultSearch checks every field", () => {
    expect(isDefaultSearch({ ...DEFAULT_SEARCH, sort: "updated" })).toBe(false);
    expect(isDefaultSearch({ ...DEFAULT_SEARCH })).toBe(true);
  });
});

describe("clampMax", () => {
  it("clamps to the mode's range; the top means no limit", () => {
    expect(clampMax(50, "day")).toBe(100);
    expect(clampMax(2999, "day")).toBe(2999);
    expect(clampMax(3000, "day")).toBe(INF);
    expect(clampMax(INF, "day")).toBe(INF);
    expect(clampMax(800, "month")).toBe(2000);
    expect(clampMax(99_999, "month")).toBe(INF);
    expect(clampMax(Number.NaN, "month")).toBe(15_000);
  });
});

describe("URL parse/serialise", () => {
  it("leaves defaults out of the URL", () => {
    expect(serializeSearch(searchToUrl(DEFAULT_SEARCH))).toBe("");
    expect(parse("")).toEqual(DEFAULT_SEARCH);
  });

  it("uses the mode's default max when max is absent", () => {
    expect(parse("?mode=month")).toEqual({ ...DEFAULT_SEARCH, mode: "month", max: 15_000 });
    expect(serializeSearch(searchToUrl({ ...DEFAULT_SEARCH, mode: "month", max: 15_000 }))).toBe(
      "?mode=month",
    );
  });

  it("writes every non-default value", () => {
    const search: Search = { mode: "month", max: 7500, call: true, sort: "price-desc" };
    expect(serializeSearch(searchToUrl(search))).toBe(
      "?mode=month&max=7500&call=1&sort=price-desc",
    );
  });

  it("writes no limit as the top of the range", () => {
    expect(serializeSearch(searchToUrl({ ...DEFAULT_SEARCH, max: INF }))).toBe("?max=3000");
    expect(parse("?max=3000").max).toBe(INF);
    expect(parse("?mode=month&max=60000").max).toBe(INF);
  });

  it("round-trips searches", () => {
    const searches: Search[] = [
      DEFAULT_SEARCH,
      { mode: "day", max: 1250, call: true, sort: "updated" },
      { mode: "day", max: INF, call: false, sort: "price-desc" },
      { mode: "month", max: 15_000, call: false, sort: "price-asc" },
      { mode: "month", max: 2000, call: true, sort: "price-asc" },
      { mode: "month", max: INF, call: true, sort: "updated" },
    ];
    for (const search of searches) expect(roundTrip(search)).toEqual(search);
  });

  it("clamps out-of-range and ignores invalid values", () => {
    expect(parse("?max=10")).toEqual({ ...DEFAULT_SEARCH, max: 100 });
    expect(parse("?mode=month&max=900")).toEqual({ ...DEFAULT_SEARCH, mode: "month", max: 2000 });
    expect(parse("?max=999999").max).toBe(INF);
    expect(parse("?mode=week&max=abc&call=maybe&sort=random")).toEqual(DEFAULT_SEARCH);
    expect(parse("?call=true").call).toBe(true);
    expect(parse("?call=0").call).toBe(false);
  });

  it("keeps other params out of the search", () => {
    expect(parse("?id=70366&mode=month")).toEqual({
      ...DEFAULT_SEARCH,
      mode: "month",
      max: 15_000,
    });
  });

  it("normalizes a search before storing it", () => {
    expect(normalizeSearch({ ...DEFAULT_SEARCH, max: 5000 }).max).toBe(INF);
    expect(normalizeSearch({ ...DEFAULT_SEARCH, max: 812.4 }).max).toBe(812);
  });
});
