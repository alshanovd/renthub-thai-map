import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseListingPageProps, SearchPageSchema } from "./schemas";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8")) as {
    pageProps: Record<string, unknown>;
  };

describe("schemas", () => {
  it("parses the search page fixture", () => {
    const result = SearchPageSchema.safeParse(fixture("search-page.json").pageProps);
    expect(result.success).toBe(true);
    expect(result.data?.pagination).toEqual({
      page: 1,
      perPage: 40,
      totalCount: 361,
      totalPages: 10,
    });
    expect(result.data?.listings[0]).not.toHaveProperty("__typename");
  });

  it("parses the listing detail fixture and drops unknown keys", () => {
    const result = parseListingPageProps(fixture("listing-detail.json").pageProps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).toBe("smith-residence-chiang-mai");
    expect(result.data).not.toHaveProperty("__typename");
    expect(result.data).not.toHaveProperty("userId");
  });

  it("reports a useful path for a mutated fixture", () => {
    const { pageProps } = fixture("listing-detail.json");
    const listing = pageProps.listing as { price: { daily: { type: unknown } }; rooms: unknown[] };
    listing.price.daily.type = 42;
    (listing.rooms[1] as { minSize: unknown }).minSize = "big";
    const result = parseListingPageProps(pageProps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("listing.price.daily.type");
    expect(result.error).toContain("listing.rooms.1.minSize");
  });

  it("rejects a missing listing", () => {
    const result = parseListingPageProps({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("listing");
  });
});
