/** Smoke tests of the data API route handlers with a mocked query module. */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ListingCard } from "@/lib/listings/types";

const card = (id: string): ListingCard => ({
  id,
  slug: `slug-${id}`,
  name: `Listing ${id}`,
  district: null,
  subdistrict: null,
  lat: null,
  lng: null,
  daily: { type: "AMOUNT", min: 500, max: 500 },
  monthly: { type: "CALL", min: null, max: null },
  cover: null,
  pictures: [],
  roomCount: 1,
  refreshedAt: null,
  deleted: false,
});

const query = vi.hoisted(() => ({
  getPins: vi.fn(),
  getSearchTotals: vi.fn(),
  getLastScrapeAt: vi.fn(),
  getListingCards: vi.fn(),
  getNoLocationPage: vi.fn(),
}));
vi.mock("@/lib/listings/api-query", () => query);

const { GET: pins } = await import("./pins/route");
const { GET: cards } = await import("./listings/route");
const { GET: byIds } = await import("./listings/by-ids/route");
const { GET: noLocation } = await import("./listings/no-location/route");

const get = (path: string) => new NextRequest(new URL(path, "http://localhost"));
const CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

beforeEach(() => {
  vi.resetAllMocks();
  query.getPins.mockResolvedValue([["1", 18.79, 98.98, 500, 0]]);
  query.getSearchTotals.mockResolvedValue({ total: 1, noLocationTotal: 0 });
  query.getLastScrapeAt.mockResolvedValue("2026-10-12T08:00:00.000Z");
  query.getListingCards.mockImplementation(async (ids: string[]) => ids.map(card));
  query.getNoLocationPage.mockResolvedValue({ listings: [card("9")], nextOffset: 20 });
});

describe("GET /api/pins", () => {
  it("returns pins, totals and the last scrape with cache headers", async () => {
    const response = await pins(get("/api/pins?bbox=18.7,98.9,18.9,99.1&mode=month&call=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE);
    expect(await response.json()).toEqual({
      lastScrapeAt: "2026-10-12T08:00:00.000Z",
      total: 1,
      noLocationTotal: 0,
      pins: [["1", 18.79, 98.98, 500, 0]],
    });
    expect(query.getPins).toHaveBeenCalledWith(
      { south: 18.7, west: 98.9, north: 18.9, east: 99.1 },
      { mode: "month", max: Number.POSITIVE_INFINITY, call: true, sort: "price-asc" },
    );
  });

  it("rejects a bad bbox or search with 400", async () => {
    for (const path of [
      "/api/pins",
      "/api/pins?bbox=1,2,3",
      "/api/pins?bbox=19,98,18,99",
      "/api/pins?bbox=18.7,98.9,18.9,99.1&mode=year",
    ]) {
      const response = await pins(get(path));
      expect(response.status, path).toBe(400);
      expect(Object.keys(await response.json())).toEqual(["error"]);
    }
    expect(query.getPins).not.toHaveBeenCalled();
  });

  it("hides internal errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.getPins.mockRejectedValue(new Error("db password leaked"));
    const response = await pins(get("/api/pins?bbox=18.7,98.9,18.9,99.1"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal error" });
  });
});

describe("GET /api/listings", () => {
  it("returns cards for unique ids", async () => {
    const response = await cards(get("/api/listings?ids=2,1,2"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE);
    const body = (await response.json()) as { listings: ListingCard[] };
    expect(body.listings.map((listing) => listing.id)).toEqual(["2", "1"]);
    expect(query.getListingCards).toHaveBeenCalledWith(["2", "1"]);
  });

  it("rejects missing, malformed or more than 100 ids", async () => {
    const many = Array.from({ length: 101 }, (_, i) => String(i)).join(",");
    for (const path of ["/api/listings", "/api/listings?ids=1;drop", `/api/listings?ids=${many}`]) {
      expect((await cards(get(path))).status, path.slice(0, 30)).toBe(400);
    }
  });

  it("keeps /api/listings/by-ids as a bare-array alias (≤ 200 ids)", async () => {
    const many = Array.from({ length: 150 }, (_, i) => String(i)).join(",");
    const response = await byIds(get(`/api/listings/by-ids?ids=${many}`));
    expect(response.status).toBe(200);
    expect(((await response.json()) as ListingCard[]).length).toBe(150);
    expect((await byIds(get("/api/listings/by-ids?ids="))).status).toBe(400);
  });
});

describe("GET /api/listings/no-location", () => {
  it("returns a page and an opaque next cursor", async () => {
    const response = await noLocation(get("/api/listings/no-location?sort=updated&limit=20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE);
    const body = (await response.json()) as { listings: ListingCard[]; nextCursor: string };
    expect(body.listings.map((listing) => listing.id)).toEqual(["9"]);
    expect(body.nextCursor).toMatch(/^[\w-]+$/);
    await noLocation(get(`/api/listings/no-location?cursor=${body.nextCursor}`));
    expect(query.getNoLocationPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "day" }),
      20,
      20,
    );
  });

  it("returns a null cursor on the last page", async () => {
    query.getNoLocationPage.mockResolvedValue({ listings: [], nextOffset: null });
    const response = await noLocation(get("/api/listings/no-location"));
    expect(await response.json()).toEqual({ listings: [], nextCursor: null });
  });

  it("rejects a bad cursor, limit or search with 400", async () => {
    for (const path of [
      "/api/listings/no-location?cursor=!!",
      "/api/listings/no-location?limit=0",
      "/api/listings/no-location?limit=51",
      "/api/listings/no-location?sort=name",
    ]) {
      expect((await noLocation(get(path))).status, path).toBe(400);
    }
  });
});
