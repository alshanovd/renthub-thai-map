/**
 * Runs the real API queries (`./api-query`, built from `./api-sql`) on an in-memory Postgres
 * (PGlite) created from the drizzle migrations, and checks them against the in-memory
 * `matchesSearch` / `applySearch` used by the current UI.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import { applySearch, hasLocation, inBounds, matchesSearch, type Search } from "./filter";
import type { ListingSummary } from "./types";

const client = new PGlite();
const db = drizzle(client, { schema });

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@/lib/db/client", () => ({ getDb: () => db, schema }));

const { getListingCards, getLastScrapeAt, getNoLocationPage, getPins, getSearchTotals } =
  await import("./api-query");

type Price = { type: string; min: number | null; max: number | null };

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fixtureRows(): (typeof schema.listings.$inferInsert)[] {
  const random = rng(42);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const dailyPrices = [100, 300, 500, 500, 650, 800, 801, 1200, 2999, 3000, 15_000];
  const monthlyPrices = [2000, 3500, 9000, 15_000, 15_000, 16_000, 60_000];
  const price = (values: number[], none: string): Price => {
    const kind = random();
    if (kind < 0.15) return { type: "CALL", min: null, max: null };
    if (kind < 0.25) return { type: none, min: null, max: null };
    const min = pick(values);
    const variant = random();
    if (variant < 0.1) return { type: "AMOUNT", min: null, max: min }; // max only
    if (variant < 0.15) return { type: "AMOUNT", min: null, max: null }; // no numbers
    return { type: "AMOUNT", min, max: variant < 0.6 ? min : min + 500 };
  };
  const dates = [null, "2026-10-01T00:00:00Z", "2026-10-05T12:00:00Z", "2026-10-10T08:30:00Z"];
  return Array.from({ length: 80 }, (_, i) => {
    const daily = price(dailyPrices, "NO_DAILY_RENTAL");
    const monthly = price(monthlyPrices, "NO_MONTHLY_RENTAL");
    const located = random() > 0.15;
    const refreshed = pick(dates);
    // Mixed-length ids so byte order differs from numeric order ("100" < "99").
    const id = i % 3 === 0 ? `L-${String(i)}` : String(90 + i * 7);
    return {
      id,
      slug: `slug-${id}`,
      name: `Listing ${id}`,
      lat: located ? 18.7 + random() * 0.2 : null,
      lng: located ? 98.9 + random() * 0.2 : null,
      dailyType: daily.type,
      dailyMin: daily.min,
      dailyMax: daily.max,
      monthlyType: monthly.type,
      monthlyMin: monthly.min,
      monthlyMax: monthly.max,
      pictures: [{ path: `/listing_picture/${id}.jpg`, caption: null }],
      renthubRefreshedAt: refreshed === null ? null : new Date(refreshed),
      detailFetchedAt: new Date("2026-10-12T00:00:00Z"),
      deletedAt: random() < 0.1 ? new Date("2026-10-11T00:00:00Z") : null,
    };
  });
}

const rows = fixtureRows();
let all: ListingSummary[] = [];
let active: ListingSummary[] = [];

beforeAll(async () => {
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    await client.exec(readFileSync(join(dir, file), "utf8"));
  }
  await db.insert(schema.listings).values(rows);
  await db.insert(schema.scrapeRuns).values([
    {
      status: "success",
      partial: false,
      finishedAt: new Date("2026-10-12T08:00:00Z"),
    },
    { status: "success", partial: true, finishedAt: new Date("2026-10-12T09:00:00Z") },
    { status: "failed", partial: false, finishedAt: new Date("2026-10-12T10:00:00Z") },
  ]);
  all = await getListingCards(rows.map((row) => row.id));
  active = all.filter((listing) => !listing.deleted);
});

afterAll(async () => {
  await client.close();
});

const INF = Number.POSITIVE_INFINITY;
const searches: Search[] = [];
for (const mode of ["day", "month"] as const) {
  const maxes = mode === "day" ? [100, 500, 800, 801, 2999, INF] : [2000, 15_000, 16_000, INF];
  for (const max of maxes) {
    for (const call of [false, true]) {
      for (const sort of ["price-asc", "price-desc", "updated"] as const) {
        searches.push({ mode, max, call, sort });
      }
    }
  }
}
const label = (search: Search) =>
  `${search.mode} max=${String(search.max)} call=${String(search.call)} ${search.sort}`;
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

describe("fixture", () => {
  it("covers every case the filter distinguishes", () => {
    expect(all).toHaveLength(rows.length);
    expect(active.length).toBeLessThan(all.length);
    expect(active.some((listing) => !hasLocation(listing))).toBe(true);
    const types = new Set(active.flatMap((l) => [l.daily.type, l.monthly.type]));
    expect([...types].toSorted()).toEqual([
      "AMOUNT",
      "CALL",
      "NO_DAILY_RENTAL",
      "NO_MONTHLY_RENTAL",
    ]);
    expect(active.some((l) => l.daily.type === "AMOUNT" && l.daily.min === null)).toBe(true);
    expect(active.some((l) => l.refreshedAt === null)).toBe(true);
  });
});

describe("SQL filter and sort match applySearch", () => {
  it.each(searches.map((search) => [label(search), search] as const))("%s", async (_, search) => {
    const expected = applySearch(active, search);
    const expectedPins = expected.filter(hasLocation);
    const everywhere = { south: 5.5, west: 97.3, north: 20.6, east: 105.7 };

    const pins = await getPins(everywhere, search);
    expect(ids(pins.map(([id]) => ({ id })))).toEqual(ids(expectedPins));
    for (const [id, lat, lng, priceMin, kind] of pins) {
      const listing = expectedPins.find((item) => item.id === id);
      if (!listing) throw new Error(`unexpected pin ${id}`);
      const range = search.mode === "month" ? listing.monthly : listing.daily;
      expect(kind).toBe(range.type === "CALL" ? 1 : 0);
      expect(priceMin).toBe(range.type === "AMOUNT" ? (range.min ?? range.max) : null);
      expect(lat).toBeCloseTo(listing.lat, 6);
      expect(lng).toBeCloseTo(listing.lng, 6);
    }

    const totals = await getSearchTotals(search);
    expect(totals).toEqual({
      total: expectedPins.length,
      noLocationTotal: expected.length - expectedPins.length,
    });

    const noLocation = await getNoLocationPage(search, 0, 50);
    expect(ids(noLocation.listings)).toEqual(
      ids(expected.filter((listing) => !hasLocation(listing))),
    );
    expect(active.filter((l) => matchesSearch(l, search))).toHaveLength(expected.length);
  });

  it("filters pins by bbox", async () => {
    const search: Search = { mode: "day", max: INF, call: true, sort: "price-asc" };
    const bbox = { south: 18.75, west: 98.95, north: 18.85, east: 99.05 };
    const pins = await getPins(bbox, search);
    const expected = applySearch(active, search).filter((listing) => inBounds(listing, bbox));
    expect(ids(pins.map(([id]) => ({ id })))).toEqual(ids(expected));
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.length).toBeLessThan((await getPins(THAILAND_BOX, search)).length);
  });
});

const THAILAND_BOX = { south: 5.5, west: 97.3, north: 20.6, east: 105.7 };

describe("cards, paging, last scrape", () => {
  it("returns cards by id with soft-deleted ones, omitting unknown ids", async () => {
    const deleted = all.find((listing) => listing.deleted);
    if (!deleted) throw new Error("fixture needs a deleted listing");
    const cards = await getListingCards([deleted.id, "unknown", rows[1].id, deleted.id]);
    expect(ids(cards).toSorted()).toEqual([deleted.id, rows[1].id].toSorted());
    expect(cards.find((card) => card.id === deleted.id)?.deleted).toBe(true);
    expect(cards[0].pictures).toEqual([`/listing_picture/${cards[0].id}.jpg`]);
    expect(await getListingCards([])).toEqual([]);
  });

  it("pages through listings without location", async () => {
    const search: Search = { mode: "day", max: INF, call: true, sort: "updated" };
    const expected = ids(applySearch(active, search).filter((listing) => !hasLocation(listing)));
    expect(expected.length).toBeGreaterThan(2);
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await getNoLocationPage(search, offset, 2);
      expect(page.listings.length).toBeLessThanOrEqual(2);
      seen.push(...ids(page.listings));
      offset = page.nextOffset;
    }
    expect(seen).toEqual(expected);
    const past = await getNoLocationPage(search, 1000, 20);
    expect(past).toEqual({ listings: [], nextOffset: null });
  });

  it("reads the last successful full scrape", async () => {
    expect(await getLastScrapeAt()).toBe("2026-10-12T08:00:00.000Z");
  });
});
