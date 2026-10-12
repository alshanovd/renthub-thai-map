import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCache, type ResponseCache } from "./cache";
import { createLimiter } from "./http";
import {
  assertSearchPageNotEmpty,
  createRenthubClient,
  EmptyResultError,
  extractBuildId,
  extractNextDataPageProps,
  listingCacheKey,
  ListingGoneError,
  OfflineCacheMissError,
  searchCacheKey,
  stripContactInformation,
  type PageProps,
} from "./renthub";
import { SEARCHES } from "./searches";

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "__fixtures__", name), "utf8");

const DAILY = SEARCHES[0];
const OLD_ID = "renthub-web-old111";
const NEW_ID = "renthub-web-new222";
const homeHtml = (id: string) =>
  `<html><script id="__NEXT_DATA__" type="application/json">{"props":{},"buildId":"${id}","isFallback":false}</script></html>`;

let cacheDir: string;
let cache: ResponseCache;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "renthub-test-"));
  cache = createCache(cacheDir);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cacheDir, { recursive: true, force: true });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Routes mocked requests by URL; records every requested URL. */
function stubFetch(route: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      return route(url);
    }),
  );
  return calls;
}

const newClient = (overrides: Parameters<typeof createRenthubClient>[0] = {}) =>
  createRenthubClient({
    cache,
    limiter: createLimiter({ concurrency: 2, minGapMs: 0, maxGapMs: 0 }),
    sleep: async () => {},
    ...overrides,
  });

describe("extractBuildId", () => {
  it("pulls the build ID out of __NEXT_DATA__", async () => {
    expect(extractBuildId(homeHtml("renthub-web-abc123"))).toBe("renthub-web-abc123");
    expect(extractBuildId(await fixture("listing-page.html"))).toBe("renthub-web-fixture000");
  });

  it("throws when missing", () => {
    expect(() => extractBuildId("<html></html>")).toThrow(/buildId/);
  });
});

describe("extractNextDataPageProps", () => {
  it("parses props.pageProps from the HTML fixture", async () => {
    const detail = JSON.parse(await fixture("listing-detail.json")) as { pageProps: PageProps };
    const pageProps = extractNextDataPageProps(await fixture("listing-page.html"));
    expect(pageProps).toEqual(detail.pageProps);
  });
});

describe("cache keys", () => {
  it("leave out the build ID", () => {
    expect(searchCacheKey(DAILY, 3)).toBe("search/daily/chiang-mai/page-3");
    expect(listingCacheKey("smith-residence-chiang-mai")).toBe(
      "listing/smith-residence-chiang-mai",
    );
  });

  it("survive a build ID change", async () => {
    const detail = JSON.parse(await fixture("listing-detail.json")) as unknown;
    let currentId = OLD_ID;
    const calls = stubFetch((url) => {
      if (url.endsWith("/en")) return new Response(homeHtml(currentId));
      return json(detail);
    });

    await newClient().getListingDetail("smith-residence-chiang-mai");
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    const entry = JSON.parse(await readFile(path.join(cacheDir, files[0]!), "utf8")) as {
      cacheKey: string;
      url: string;
    };
    expect(entry.cacheKey).toBe("listing/smith-residence-chiang-mai");
    expect(entry.url).toContain(OLD_ID);

    // A fresh client (new process) after renthub redeployed still hits the cache.
    currentId = NEW_ID;
    calls.length = 0;
    const second = await newClient().getListingDetail("smith-residence-chiang-mai");
    expect(second.fromCache).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("getListingDetail", () => {
  it("strips contactInformation before caching and returning", async () => {
    const detail = JSON.parse(await fixture("listing-detail.json")) as {
      pageProps: { listing: Record<string, unknown> };
    };
    detail.pageProps.listing.contactInformation = [{ phone: "000" }];
    stubFetch((url) => (url.endsWith("/en") ? new Response(homeHtml(OLD_ID)) : json(detail)));

    const { pageProps } = await newClient().getListingDetail("smith-residence-chiang-mai");
    expect(pageProps.listing).not.toHaveProperty("contactInformation");
    const [file] = await readdir(cacheDir);
    expect(await readFile(path.join(cacheDir, file!), "utf8")).not.toContain("contactInformation");
  });

  it("refreshes the build ID on 404 and retries", async () => {
    const detail = JSON.parse(await fixture("listing-detail.json")) as unknown;
    let homeCalls = 0;
    const calls = stubFetch((url) => {
      if (url.endsWith("/en")) return new Response(homeHtml(homeCalls++ === 0 ? OLD_ID : NEW_ID));
      if (url.includes(`/_next/data/${OLD_ID}/`)) return json({}, 404);
      if (url.includes(`/_next/data/${NEW_ID}/`)) return json(detail);
      throw new Error(`unexpected ${url}`);
    });

    const client = newClient();
    const result = await client.getListingDetail("smith-residence-chiang-mai");

    expect(result.fromCache).toBe(false);
    expect(result.url).toBe(
      `https://www.renthub.in.th/_next/data/${NEW_ID}/en/smith-residence-chiang-mai.json?id=smith-residence-chiang-mai`,
    );
    expect(client.stats.buildIdRefreshes).toBe(1);
    expect(calls).toHaveLength(4); // home, data(old) 404, home, data(new)
  });

  it("falls back to the HTML page's __NEXT_DATA__", async () => {
    const detail = JSON.parse(await fixture("listing-detail.json")) as { pageProps: PageProps };
    const html = await fixture("listing-page.html");
    const calls = stubFetch((url) => {
      if (url.endsWith("/en")) return new Response(homeHtml(OLD_ID));
      if (url.includes("/_next/data/")) return json({}, 404);
      if (url === "https://www.renthub.in.th/en/smith-residence-chiang-mai") {
        return new Response(html);
      }
      throw new Error(`unexpected ${url}`);
    });

    const client = newClient();
    const result = await client.getListingDetail("smith-residence-chiang-mai");

    expect(result.pageProps).toEqual(detail.pageProps);
    expect(result.url).toBe("https://www.renthub.in.th/en/smith-residence-chiang-mai");
    expect(client.stats.htmlFallbacks).toBe(1);
    expect(calls.at(-1)).toBe("https://www.renthub.in.th/en/smith-residence-chiang-mai");
    // Cached: a second call makes no requests.
    calls.length = 0;
    expect((await client.getListingDetail("smith-residence-chiang-mai")).fromCache).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports a removed listing (data route redirect) without an HTML fallback", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/en")) return new Response(homeHtml(OLD_ID));
      return json({ pageProps: { __N_REDIRECT: "/en", __N_REDIRECT_STATUS: 308 }, __N_SSP: true });
    });

    await expect(newClient().getListingDetail("gone-listing")).rejects.toBeInstanceOf(
      ListingGoneError,
    );
    expect(calls.filter((u) => !u.includes("/_next/data/") && !u.endsWith("/en"))).toHaveLength(0);
  });

  it("offline: serves stale cache entries and throws on a miss without fetching", async () => {
    const calls = stubFetch(() => {
      throw new Error("network used");
    });
    await cache.set("listing/old", {
      url: "https://example.test/old",
      fetchedAt: "2020-01-01T00:00:00.000Z",
      status: 200,
      body: { listing: { id: "1" } },
    });

    const client = newClient({ offline: true });
    expect((await client.getListingDetail("old")).fromCache).toBe(true);
    await expect(client.getListingDetail("missing")).rejects.toBeInstanceOf(OfflineCacheMissError);
    expect(calls).toHaveLength(0);
  });
});

describe("getSearchPage", () => {
  it("returns listings and pagination from the data route", async () => {
    const search = JSON.parse(await fixture("search-page.json")) as unknown;
    const calls = stubFetch((url) =>
      url.endsWith("/en") ? new Response(homeHtml(OLD_ID)) : json(search),
    );

    const page = await newClient().getSearchPage(DAILY, 1);
    expect(page.listings.map((l) => l.slug)).toHaveLength(3);
    expect(page.totalPages).toBe(10);
    expect(calls.at(-1)).toBe(
      `https://www.renthub.in.th/_next/data/${OLD_ID}/en/short-term-rental/chiang-mai.json?id=chiang-mai&page=1`,
    );
  });

  it("throws (and caches nothing) when page 1 is empty", async () => {
    const search = JSON.parse(await fixture("search-page.json")) as {
      pageProps: Record<string, unknown>;
    };
    search.pageProps.listings = [];
    stubFetch((url) => (url.endsWith("/en") ? new Response(homeHtml(OLD_ID)) : json(search)));

    await expect(newClient().getSearchPage(DAILY, 1)).rejects.toBeInstanceOf(EmptyResultError);
    expect(await readdir(cacheDir).catch(() => [])).toHaveLength(0);
  });
});

const props = (count: number, totalPages: number): PageProps => ({
  listings: Array.from({ length: count }, (_, i) => ({ id: i, slug: `s${i}` })),
  pagination: { page: 1, perPage: 40, totalCount: totalPages * 40, totalPages },
});

describe("assertSearchPageNotEmpty", () => {
  it("throws for an empty page 1 or a page within totalPages", () => {
    expect(() => assertSearchPageNotEmpty(1, props(0, 0), "u")).toThrow(EmptyResultError);
    expect(() => assertSearchPageNotEmpty(4, props(0, 10), "u")).toThrow(/page 4 of 10/);
  });

  it("accepts non-empty pages and empty pages past the end", () => {
    expect(() => assertSearchPageNotEmpty(1, props(3, 1), "u")).not.toThrow();
    expect(() => assertSearchPageNotEmpty(11, props(0, 10), "u")).not.toThrow();
  });
});

describe("stripContactInformation", () => {
  it("removes nested contactInformation keys", () => {
    expect(
      stripContactInformation({
        a: 1,
        contactInformation: [1],
        b: [{ contactInformation: {}, c: 2 }],
      }),
    ).toEqual({ a: 1, b: [{ c: 2 }] });
  });
});
