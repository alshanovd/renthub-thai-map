/**
 * Database writes for the scraper (Neon over HTTP: no interactive transactions, so each
 * statement is atomic on its own).
 */
import {
  and,
  arrayOverlaps,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, type Db } from "@/lib/db/client";
import { listings, scrapeRuns, type NewListing, type ScrapeRunStatus } from "@/lib/db/schema";

export const UPSERT_CHUNK_SIZE = 100;

export interface RunStats {
  listCount: number;
  detailCount: number;
  upserted: number;
  noLocation: number;
  softDeleted: number;
}

export interface StartedRun {
  id: number;
  startedAt: Date;
}

/** Columns never overwritten by an upsert. */
const KEEP_ON_UPDATE = new Set<string>(["id", "firstSeenAt", "sourceSearches", "deletedAt"]);

/** `ON CONFLICT DO UPDATE SET` for every column except id/first_seen_at, merging searches. */
function upsertSet(): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(listings))) {
    if (KEEP_ON_UPDATE.has(key)) continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  set.sourceSearches = sql`array(select distinct s from unnest(${listings.sourceSearches} || excluded.source_searches) as s order by s)`;
  set.deletedAt = sql`null`;
  return set;
}

export function createPersistence(db: Db = getDb()) {
  /**
   * `startedAt` is generated here (millisecond precision, like the `last_seen_at` values written
   * from it) rather than by Postgres `now()` (microseconds), so `last_seen_at < started_at` is
   * false for every row seen in this run.
   */
  async function startRun(searches: readonly string[], partial: boolean): Promise<StartedRun> {
    const [run] = await db
      .insert(scrapeRuns)
      .values({ status: "running", searches: [...searches], partial, startedAt: new Date() })
      .returning({ id: scrapeRuns.id, startedAt: scrapeRuns.startedAt });
    if (!run) throw new Error("failed to insert scrape_runs row");
    return run;
  }

  /** Upserts in chunks of 100; returns the number of rows written. */
  async function upsertListings(rows: readonly NewListing[]): Promise<number> {
    const set = upsertSet();
    let written = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      const result = await db
        .insert(listings)
        .values(chunk)
        .onConflictDoUpdate({ target: listings.id, set })
        .returning({ id: listings.id });
      written += result.length;
    }
    return written;
  }

  /**
   * Bumps `last_seen_at` for listings seen in a search whose detail couldn't be used this run
   * (validation/network failure), so they are not mistaken for removed listings.
   */
  async function markSeen(ids: readonly string[], seenAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(listings)
      .set({ lastSeenAt: seenAt })
      .where(inArray(listings.id, [...ids]));
  }

  /**
   * Soft-deletes listings of these searches not seen since `runStartedAt`. Call only after a
   * complete (non-partial, uninterrupted, no failed pages) run.
   */
  async function softDeleteMissing(
    runStartedAt: Date,
    searchKeys: readonly string[],
  ): Promise<number> {
    const result = await db
      .update(listings)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          isNull(listings.deletedAt),
          lt(listings.lastSeenAt, runStartedAt),
          arrayOverlaps(listings.sourceSearches, [...searchKeys]),
        ),
      )
      .returning({ id: listings.id });
    return result.length;
  }

  async function finishRun(
    id: number,
    outcome: { status: Exclude<ScrapeRunStatus, "running">; stats: RunStats; error?: string },
  ): Promise<void> {
    await db
      .update(scrapeRuns)
      .set({
        ...outcome.stats,
        status: outcome.status,
        error: outcome.error ?? null,
        finishedAt: sql`now()`,
      })
      .where(eq(scrapeRuns.id, id));
  }

  return { startRun, upsertListings, markSeen, softDeleteMissing, finishRun };
}

export type Persistence = ReturnType<typeof createPersistence>;
