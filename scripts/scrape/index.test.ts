import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatDuration,
  parseCliArgs,
  processDetails,
  UsageError,
  type DetailResult,
} from "./index";
import { SEARCHES } from "./searches";

describe("parseCliArgs", () => {
  it("has the documented defaults", () => {
    expect(parseCliArgs([])).toEqual({
      limit: undefined,
      maxAgeHours: 12,
      offline: false,
      dryRun: false,
      concurrency: 2,
      searches: [...SEARCHES],
      help: false,
    });
  });

  it("parses every flag", () => {
    const options = parseCliArgs([
      "--limit",
      "5",
      "--max-age",
      "0.5",
      "--offline",
      "--dry-run",
      "--concurrency=3",
      "--search",
      "daily",
      "--help",
    ]);
    expect(options).toMatchObject({
      limit: 5,
      maxAgeHours: 0.5,
      offline: true,
      dryRun: true,
      concurrency: 3,
      help: true,
    });
    expect(options.searches.map((s) => s.key)).toEqual(["daily"]);
  });

  it("rejects bad values and unknown flags", () => {
    expect(() => parseCliArgs(["--limit", "0"])).toThrow(UsageError);
    expect(() => parseCliArgs(["--limit", "abc"])).toThrow(UsageError);
    expect(() => parseCliArgs(["--concurrency", "1.5"])).toThrow(UsageError);
    expect(() => parseCliArgs(["--search", "weekly"])).toThrow(/unknown --search/);
    expect(() => parseCliArgs(["--nope"])).toThrow(UsageError);
  });
});

describe("processDetails", () => {
  const raw = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "__fixtures__", "listing-detail.json"), "utf8"),
  ) as { pageProps: { listing: Record<string, unknown> } };
  const now = new Date("2026-10-12T00:00:00.000Z");
  const detail = (i: number, valid: boolean): DetailResult => {
    const listing = { ...structuredClone(raw.pageProps.listing), id: String(i), slug: `l-${i}` };
    if (!valid) delete (listing as { price?: unknown }).price;
    return {
      listing: { id: String(i), slug: `l-${i}`, searches: ["daily"] },
      fetched: { pageProps: { listing }, fromCache: true, url: "x", fetchedAt: now.toISOString() },
    };
  };

  it("maps valid details and skips up to 10% invalid ones", () => {
    const lines: string[] = [];
    const details = Array.from({ length: 10 }, (_, i) => detail(i, i !== 3));
    const result = processDetails(details, now, (line) => lines.push(line));
    expect(result.rows).toHaveLength(9);
    expect(result.invalid.map((x) => x.listing.slug)).toEqual(["l-3"]);
    expect(lines.join("\n")).toMatch(/WARN invalid listing l-3: listing\.price/);
  });

  it("aborts when more than 10% are invalid", () => {
    const details = Array.from({ length: 10 }, (_, i) => detail(i, i > 1));
    expect(() => processDetails(details, now, () => {})).toThrow(
      /2\/10 listings failed validation/,
    );
  });

  it("keeps one row when two slugs resolve to the same listing", () => {
    const a = detail(1, true);
    const b = detail(2, true);
    (b.fetched.pageProps.listing as { id: string }).id = "1";
    b.listing.searches = ["monthly" as never];
    const result = processDetails([a, b], now, () => {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sourceSearches).toEqual(["daily", "monthly"]);
  });

  it("counts listings without a location", () => {
    const noLoc = detail(1, true);
    (noLoc.fetched.pageProps.listing as { location: unknown }).location = null;
    const lines: string[] = [];
    const result = processDetails([noLoc, detail(2, true)], now, (line) => lines.push(line));
    expect(result.noLocation.map((l) => l.slug)).toEqual(["l-1"]);
    expect(lines).toContain("[scrape] WARN no location: l-1");
  });
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(252_000)).toBe("4m12s");
  });
});
