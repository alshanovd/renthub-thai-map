/**
 * `pnpm scrape`: pulls renthub search pages and listing details (cached on disk).
 * Run `pnpm scrape --help` for flags.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createCache } from "./cache";
import {
  createRenthubClient,
  errorMessage,
  ListingGoneError,
  type Fetched,
  type RenthubClient,
} from "./renthub";
import { findSearch, SEARCHES, type Search, type SearchKey } from "./searches";

export const USAGE = `Usage: pnpm scrape [options]

Scrape renthub.in.th Chiang Mai listings (search pages + listing details).

Options:
  --limit <n>          Process only the first N listings (partial run)
  --max-age <hours>    Reuse cached responses younger than this (default: 12)
  --offline            Never use the network; cache only
  --dry-run            Don't write to the database
  --concurrency <n>    Max parallel requests (default: 2)
  --search <key>       Run only this search (${SEARCHES.map((s) => s.key).join(", ")}; default: all)
  --help               Print this help
`;

export interface CliOptions {
  limit: number | undefined;
  maxAgeHours: number;
  offline: boolean;
  dryRun: boolean;
  concurrency: number;
  searches: Search[];
  help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function toNumber(
  flag: string,
  value: string | undefined,
  opts: { integer: boolean; min: number },
) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (
    value.trim() === "" ||
    !Number.isFinite(n) ||
    (opts.integer && !Number.isInteger(n)) ||
    n < opts.min
  ) {
    throw new UsageError(
      `--${flag} must be ${opts.integer ? "an integer" : "a number"} >= ${opts.min}, got "${value}"`,
    );
  }
  return n;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        limit: { type: "string" },
        "max-age": { type: "string", default: "12" },
        offline: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        concurrency: { type: "string", default: "2" },
        search: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }

  let searches: Search[] = [...SEARCHES];
  if (values.search !== undefined) {
    const search = findSearch(values.search);
    if (!search) {
      throw new UsageError(
        `unknown --search "${values.search}" (known: ${SEARCHES.map((s) => s.key).join(", ")})`,
      );
    }
    searches = [search];
  }

  return {
    limit: toNumber("limit", values.limit, { integer: true, min: 1 }),
    maxAgeHours: toNumber("max-age", values["max-age"], { integer: false, min: 0 }) ?? 12,
    offline: values.offline ?? false,
    dryRun: values["dry-run"] ?? false,
    concurrency: toNumber("concurrency", values.concurrency, { integer: true, min: 1 }) ?? 2,
    searches,
    help: values.help ?? false,
  };
}

/** A listing seen in one or more searches. */
export interface ListedListing {
  id: string;
  slug: string;
  searches: SearchKey[];
}

export interface DetailResult {
  listing: ListedListing;
  fetched: Fetched;
}

export interface CollectResult {
  listed: ListedListing[];
  pages: number;
  details: DetailResult[];
  gone: ListedListing[];
  failed: Array<{ listing: ListedListing; error: string }>;
  interrupted: boolean;
}

const tag = (f: Fetched) => (f.fromCache ? " [cache]" : "");

/** Runs `fn` over `items` with `concurrency` workers; stops picking new items once `shouldStop()`. */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  shouldStop: () => boolean,
  fn: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (!shouldStop() && next < items.length) {
      const index = next++;
      await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function collect(
  client: RenthubClient,
  options: Pick<CliOptions, "searches" | "limit" | "concurrency">,
  shouldStop: () => boolean,
  log: (line: string) => void = console.log,
): Promise<CollectResult> {
  const byId = new Map<string, ListedListing>();
  let pages = 0;
  const addListings = (search: Search, listings: Array<{ id: string; slug: string }>) => {
    for (const { id, slug } of listings) {
      const existing = byId.get(id);
      if (!existing) byId.set(id, { id, slug, searches: [search.key] });
      else if (!existing.searches.includes(search.key)) existing.searches.push(search.key);
    }
  };

  // 1. Search pages (page 1 tells us how many pages there are).
  for (const search of options.searches) {
    if (shouldStop()) break;
    const first = await client.getSearchPage(search, 1);
    pages++;
    const total = first.totalPages;
    log(`[scrape] search ${search.key} p1/${total} (${first.listings.length})${tag(first)}`);
    addListings(search, first.listings);

    const rest = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2);
    const results = new Map<number, Array<{ id: string; slug: string }>>();
    await runPool(rest, options.concurrency, shouldStop, async (page) => {
      const result = await client.getSearchPage(search, page);
      pages++;
      log(
        `[scrape] search ${search.key} p${page}/${total} (${result.listings.length})${tag(result)}`,
      );
      results.set(page, result.listings);
    });
    // Keep renthub's order (page 1, 2, ...) regardless of completion order.
    for (const page of rest) {
      const listings = results.get(page);
      if (listings) addListings(search, listings);
    }
  }

  // 2. Details.
  const listed = [...byId.values()];
  const targets = options.limit === undefined ? listed : listed.slice(0, options.limit);
  const details: DetailResult[] = [];
  const gone: ListedListing[] = [];
  const failed: CollectResult["failed"] = [];
  let done = 0;
  await runPool(targets, options.concurrency, shouldStop, async (listing) => {
    try {
      const fetched = await client.getListingDetail(listing.slug);
      details.push({ listing, fetched });
      log(`[scrape] detail ${++done}/${targets.length} ${listing.slug}${tag(fetched)}`);
    } catch (error) {
      if (error instanceof ListingGoneError) {
        gone.push(listing);
        log(`[scrape] detail ${++done}/${targets.length} ${listing.slug} GONE (${error.redirect})`);
      } else {
        failed.push({ listing, error: errorMessage(error) });
        log(
          `[scrape] detail ${++done}/${targets.length} ${listing.slug} FAILED: ${errorMessage(error)}`,
        );
      }
    }
  });

  return { listed, pages, details, gone, failed, interrupted: shouldStop() };
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`[scrape] ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const started = Date.now();
  const client = createRenthubClient({
    cache: createCache(),
    maxAgeMs: options.maxAgeHours * 60 * 60 * 1000,
    offline: options.offline,
    concurrency: options.concurrency,
    log: (line) => console.log(line),
  });

  let stopping = false;
  const onSigint = () => {
    if (stopping) process.exit(130); // second Ctrl+C: hard exit
    stopping = true;
    console.log("[scrape] SIGINT: finishing in-flight requests (Ctrl+C again to force quit)");
  };
  process.on("SIGINT", onSigint);

  console.log(
    `[scrape] searches=${options.searches.map((s) => s.key).join(",")} limit=${options.limit ?? "all"} ` +
      `max-age=${options.maxAgeHours}h concurrency=${options.concurrency}` +
      `${options.offline ? " offline" : ""}${options.dryRun ? " dry-run" : ""}`,
  );

  let result: CollectResult | undefined;
  let fatal: unknown;
  try {
    result = await collect(client, options, () => stopping);
  } catch (error) {
    fatal = error;
  } finally {
    process.off("SIGINT", onSigint);
  }

  const { stats } = client;
  const lines = [
    `[scrape] ${fatal ? "FAILED" : result?.interrupted ? "INTERRUPTED (partial)" : "done"} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  ];
  if (result) {
    lines.push(
      `  search pages:     ${result.pages}`,
      `  unique listings:  ${result.listed.length}`,
      `  details fetched:  ${result.details.length}${options.limit !== undefined ? ` (limit ${options.limit})` : ""}`,
      `  gone (redirect):  ${result.gone.length}`,
      `  failed:           ${result.failed.length}`,
    );
  }
  lines.push(
    `  network requests: ${stats.networkRequests}`,
    `  cache hits:       ${stats.cacheHits}`,
    `  build id refresh: ${stats.buildIdRefreshes}, html fallbacks: ${stats.htmlFallbacks}`,
    `  db:               ${options.dryRun ? "skipped (--dry-run)" : "not implemented yet (plan 05)"}`,
  );
  console.log(lines.join("\n"));

  if (fatal) {
    console.error(`[scrape] error: ${errorMessage(fatal)}`);
    return 1;
  }
  if (result?.interrupted) return 130;
  return result && result.failed.length > 0 ? 1 : 0;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
