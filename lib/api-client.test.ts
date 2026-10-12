import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ListingCard } from "@/lib/listings/types";

import { createCardLoader, fetchPins } from "./api-client";

function card(id: string): ListingCard {
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
  };
}

/**
 * A fake `/api/listings?ids=` that knows ids not starting with `unknown`, ordered by id.
 * Responses wait for `release()` (so requests can be observed in flight).
 */
function fakeApi() {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  let gate = Promise.withResolvers<void>();
  const release = () => {
    gate.resolve();
    gate = Promise.withResolvers<void>();
  };
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (init?.signal) signals.push(init.signal);
    await gate.promise;
    const ids = new URL(url, "http://x").searchParams.get("ids")?.split(",") ?? [];
    const listings = ids
      .filter((id) => !id.startsWith("unknown"))
      .toSorted()
      .map(card);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return Response.json({ listings });
  });
  return { fetchImpl, urls, signals, release };
}

/** Sends the queued batch, then lets the fake API answer. */
async function flush(api: ReturnType<typeof fakeApi>) {
  await vi.runAllTimersAsync();
  api.release();
  await vi.runAllTimersAsync();
}

const idsOf = (url: string) => new URL(url, "http://x").searchParams.get("ids")?.split(",") ?? [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createCardLoader", () => {
  it("sends one request for every id asked for in the same tick, in any response order", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const promises = ["c", "a", "b"].map((id) => loadCard(id));
    expect(api.fetchImpl).not.toHaveBeenCalled();
    await flush(api);
    const cards = await Promise.all(promises);
    expect(api.fetchImpl).toHaveBeenCalledTimes(1);
    expect(idsOf(api.urls[0])).toEqual(["c", "a", "b"]);
    expect(cards.map((c) => c?.id)).toEqual(["c", "a", "b"]);
  });

  it("splits more than 100 ids into several requests", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const ids = Array.from({ length: 250 }, (_, i) => `id${String(i)}`);
    const promises = ids.map((id) => loadCard(id));
    await flush(api);
    const cards = await Promise.all(promises);
    expect(api.urls.map((url) => idsOf(url).length)).toEqual([100, 100, 50]);
    expect(cards.map((c) => c?.id)).toEqual(ids);
  });

  it("dedupes ids that are queued or already in flight", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const first = loadCard("a");
    const second = loadCard("a");
    await vi.advanceTimersByTimeAsync(16);
    // In flight now: asking again joins the running request.
    const third = loadCard("a");
    await flush(api);
    const cards = await Promise.all([first, second, third]);
    expect(api.fetchImpl).toHaveBeenCalledTimes(1);
    expect(idsOf(api.urls[0])).toEqual(["a"]);
    expect(cards.every((c) => c?.id === "a")).toBe(true);
  });

  it("resolves ids missing from the response to null", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const known = loadCard("a");
    const unknown = loadCard("unknown-1");
    await flush(api);
    expect((await known)?.id).toBe("a");
    expect(await unknown).toBeNull();
  });

  it("fetches again after a request settled (no stale in-flight state)", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const first = loadCard("a");
    await flush(api);
    await first;
    const second = loadCard("a");
    await flush(api);
    expect((await second)?.id).toBe("a");
    expect(api.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects every waiter of a failed request", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const { loadCard } = createCardLoader({ fetchImpl });
    const results = Promise.allSettled([loadCard("a"), loadCard("b")]);
    await vi.runAllTimersAsync();
    expect((await results).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });

  it("drops an aborted id before sending and aborts a request nobody awaits", async () => {
    const api = fakeApi();
    const { loadCard } = createCardLoader({ fetchImpl: api.fetchImpl });
    const queued = new AbortController();
    const dropped = loadCard("x", queued.signal);
    const kept = loadCard("y");
    queued.abort();
    await expect(dropped).rejects.toThrow();
    await flush(api);
    expect(idsOf(api.urls[0])).toEqual(["y"]);
    expect((await kept)?.id).toBe("y");

    const a = new AbortController();
    const b = new AbortController();
    const pa = loadCard("a", a.signal);
    const pb = loadCard("b", b.signal);
    await vi.advanceTimersByTimeAsync(16);
    a.abort();
    expect(api.signals[1].aborted).toBe(false); // "b" still awaited
    b.abort();
    expect(api.signals[1].aborted).toBe(true);
    await expect(pa).rejects.toThrow();
    await expect(pb).rejects.toThrow();
  });
});

describe("fetchPins", () => {
  it("builds the URL from the search and bbox and decodes the tuples", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({
        lastScrapeAt: null,
        total: 2,
        noLocationTotal: 0,
        pins: [
          ["a", 18.7, 98.9, 500, 0],
          ["b", 18.8, 99, null, 1],
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const data = await fetchPins({
        bbox: { south: 18.7, west: 98.9, north: 18.8, east: 99 },
        search: { mode: "day", max: 800, call: false, sort: "price-asc" },
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        "/api/pins?mode=day&max=800&call=0&sort=price-asc&bbox=18.70000%2C98.90000%2C18.80000%2C99.00000",
      );
      expect(data.pins).toEqual([
        { id: "a", lat: 18.7, lng: 98.9, price: 500, kind: "amount" },
        { id: "b", lat: 18.8, lng: 99, price: null, kind: "call" },
      ]);
      expect(data.total).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
