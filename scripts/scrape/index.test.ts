import { describe, expect, it } from "vitest";

import { parseCliArgs, UsageError } from "./index";
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
