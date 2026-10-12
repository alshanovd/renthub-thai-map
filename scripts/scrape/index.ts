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
import { toListingRow, type MappedListing } from "./map";
import { createPersistence, type RunStats } from "./persist";
import { parseListingPageProps } from "./schemas";
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
  // renthub sometimes lists two ids under one slug (duplicate listings); the slug resolves to
  // only one of them, so fetch each slug once.
  const bySlug = new Map<string, ListedListing>();
  for (const listing of listed) {
    const first = bySlug.get(listing.slug);
    if (!first) bySlug.set(listing.slug, listing);
    else
      log(
        `[scrape] WARN ids ${first.id} and ${listing.id} share slug ${listing.slug}; fetching it once`,
      );
  }
  const unique = [...bySlug.values()];
  const targets = options.limit === undefined ? unique : unique.slice(0, options.limit);
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

/** Max share of fetched details allowed to fail validation before the run aborts. */
export const MAX_INVALID_SHARE = 0.1;

export interface ProcessedDetails {
  rows: MappedListing["row"][];
  noLocation: ListedListing[];
  invalid: Array<{ listing: ListedListing; error: string }>;
}

/**
 * Validates and maps fetched details. Invalid listings are skipped with a warning; more than
 * 10% invalid throws.
 */
export function processDetails(
  details: readonly DetailResult[],
  now: Date,
  log: (line: string) => void = console.log,
): ProcessedDetails {
  const out: ProcessedDetails = { rows: [], noLocation: [], invalid: [] };
  const seenIds = new Map<string, MappedListing["row"]>();
  for (const { listing, fetched } of details) {
    const parsed = parseListingPageProps(fetched.pageProps);
    if (!parsed.ok) {
      log(`[scrape] WARN invalid listing ${listing.slug}: ${parsed.error}`);
      out.invalid.push({ listing, error: parsed.error });
      continue;
    }
    const fetchedAt = fetched.fetchedAt ? new Date(fetched.fetchedAt) : now;
    const { row, noLocation } = toListingRow(parsed.data, listing.searches, now, fetchedAt);
    const duplicate = seenIds.get(row.id);
    if (duplicate) {
      // Two slugs resolved to the same listing: keep one row, merging the searches.
      log(`[scrape] WARN ${listing.slug} resolves to already mapped listing ${row.id}; skipped`);
      duplicate.sourceSearches = [
        ...new Set([...(duplicate.sourceSearches ?? []), ...listing.searches]),
      ];
      continue;
    }
    seenIds.set(row.id, row);
    if (noLocation) {
      log(`[scrape] WARN no location: ${listing.slug}`);
      out.noLocation.push(listing);
    }
    out.rows.push(row);
  }
  if (details.length > 0 && out.invalid.length / details.length > MAX_INVALID_SHARE) {
    throw new Error(
      `${out.invalid.length}/${details.length} listings failed validation (> ${MAX_INVALID_SHARE * 100}%), aborting`,
    );
  }
  return out;
}

/**
 * Error text for logs and `scrape_runs.error`. Drizzle query errors embed the full SQL and every
 * parameter; keep only the database's own message and the start of the statement.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("Failed query:")) {
    const statement = error.message.slice("Failed query: ".length, 60).trim();
    const cause = error.cause instanceof Error ? error.cause.message : "unknown cause";
    return `database error: ${cause} (in: ${statement}…)`;
  }
  return errorMessage(error);
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/** POSTs to `REVALIDATE_URL` (if configured); failures only warn. */
async function revalidate(): Promise<void> {
  const url = process.env.REVALIDATE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!url || !secret) {
    console.log("[scrape] revalidate skipped (REVALIDATE_URL or REVALIDATE_SECRET not set)");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) console.log(`[scrape] revalidate: HTTP ${res.status}`);
    else console.warn(`[scrape] WARN revalidate failed: HTTP ${res.status}`);
  } catch (error) {
    console.warn(`[scrape] WARN revalidate failed: ${errorMessage(error)}`);
  }
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
  const searchKeys = options.searches.map((s) => s.key);
  const partial = options.limit !== undefined;
  const client = createRenthubClient({
    cache: createCache(),
    maxAgeMs: options.maxAgeHours * 60 * 60 * 1000,
    offline: options.offline,
    concurrency: options.concurrency,
    log: (line) => console.log(line),
  });

  console.log(
    `[scrape] searches=${searchKeys.join(",")} limit=${options.limit ?? "all"} ` +
      `max-age=${options.maxAgeHours}h concurrency=${options.concurrency}` +
      `${options.offline ? " offline" : ""}${options.dryRun ? " dry-run" : ""}`,
  );

  const db = options.dryRun ? undefined : createPersistence();
  const run = db ? await db.startRun(searchKeys, partial) : undefined;
  const runStartedAt = run?.startedAt ?? new Date();
  const stats: RunStats = {
    listCount: 0,
    detailCount: 0,
    upserted: 0,
    noLocation: 0,
    softDeleted: 0,
  };

  let stopping = false;
  const onSigint = () => {
    if (stopping) process.exit(130); // second Ctrl+C: hard exit
    stopping = true;
    console.log("[scrape] SIGINT: finishing in-flight requests (Ctrl+C again to force quit)");
  };
  process.on("SIGINT", onSigint);

  let result: CollectResult;
  try {
    try {
      result = await collect(client, options, () => stopping);
    } finally {
      process.off("SIGINT", onSigint);
    }
    stats.listCount = result.listed.length;
    stats.detailCount = result.details.length;

    const processed = processDetails(result.details, runStartedAt);
    stats.noLocation = processed.noLocation.length;

    const complete = !partial && !result.interrupted && result.failed.length === 0;
    if (db) {
      stats.upserted = await db.upsertListings(processed.rows);
      // Seen in a search but not upserted: keep them from being soft-deleted.
      await db.markSeen(
        [...processed.invalid, ...result.failed].map(({ listing }) => listing.id),
        runStartedAt,
      );
      if (complete) stats.softDeleted = await db.softDeleteMissing(runStartedAt, searchKeys);
    }

    const problems = [
      result.interrupted ? "interrupted (SIGINT)" : "",
      result.failed.length > 0
        ? `${result.failed.length} detail(s) failed: ${result.failed.map((f) => f.listing.slug).join(", ")}`
        : "",
      processed.invalid.length > 0
        ? `${processed.invalid.length} invalid: ${processed.invalid.map((f) => f.listing.slug).join(", ")}`
        : "",
    ].filter(Boolean);
    if (db && run) {
      await db.finishRun(run.id, {
        status: result.interrupted ? "failed" : "success",
        stats,
        error: problems.length > 0 ? problems.join("; ") : undefined,
      });
    }
    if (db && !result.interrupted) await revalidate();

    const fromCache = result.details.filter((d) => d.fetched.fromCache).length;
    const status = result.interrupted
      ? "INTERRUPTED (partial)"
      : partial
        ? "done (partial)"
        : "done";
    console.log(
      `[scrape] ${status} in ${formatDuration(Date.now() - started)} — ` +
        `searches: ${searchKeys.map((k) => `${k}(${result.listed.filter((l) => l.searches.includes(k)).length})`).join(" ")} · ` +
        `details: ${result.details.length} (cache ${fromCache}, net ${result.details.length - fromCache}) · ` +
        `upserted ${db ? stats.upserted : "skipped (dry run)"} · no-location ${stats.noLocation} · ` +
        `soft-deleted ${stats.softDeleted} · gone ${result.gone.length} · invalid ${processed.invalid.length} · ` +
        `failed ${result.failed.length}`,
    );
    console.log(
      `[scrape] network requests ${client.stats.networkRequests} · cache hits ${client.stats.cacheHits} · ` +
        `build id refreshes ${client.stats.buildIdRefreshes} · html fallbacks ${client.stats.htmlFallbacks}` +
        (run ? ` · scrape_runs #${run.id}` : ""),
    );
    for (const problem of problems) console.log(`[scrape] note: ${problem}`);

    if (result.interrupted) return 130;
    return result.failed.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(
      `[scrape] FAILED in ${formatDuration(Date.now() - started)}: ${describeError(error)}`,
    );
    if (db && run) {
      try {
        await db.finishRun(run.id, { status: "failed", stats, error: describeError(error) });
      } catch (finishError) {
        console.error(`[scrape] could not record the failed run: ${describeError(finishError)}`);
      }
    }
    return 1;
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`[scrape] FAILED: ${describeError(error)}`);
      process.exitCode = 1;
    },
  );
}
