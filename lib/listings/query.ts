import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { type Db, getDb, schema } from "@/lib/db/client";

import type { ListingSummary, ListingsPayload } from "./types";

/** Cache tag of the listings payload; `/api/revalidate` invalidates it after a scrape. */
export const LISTINGS_TAG = "listings";

const { listings, scrapeRuns } = schema;

/** Columns needed for a `ListingSummary`; pictures are reduced to their paths in SQL. */
export const summaryColumns = {
  id: listings.id,
  slug: listings.slug,
  name: listings.name,
  district: listings.district,
  subdistrict: listings.subdistrict,
  lat: listings.lat,
  lng: listings.lng,
  dailyType: listings.dailyType,
  dailyMin: listings.dailyMin,
  dailyMax: listings.dailyMax,
  monthlyType: listings.monthlyType,
  monthlyMin: listings.monthlyMin,
  monthlyMax: listings.monthlyMax,
  coverPicture: listings.coverPicture,
  pictures: sql<string[]>`jsonb_path_query_array(${listings.pictures}, '$[*].path')`,
  roomCount: sql<number>`jsonb_array_length(${listings.rooms})::int`,
  renthubRefreshedAt: listings.renthubRefreshedAt,
  deletedAt: listings.deletedAt,
};

export type SummaryRow = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  subdistrict: string | null;
  lat: number | null;
  lng: number | null;
  dailyType: string;
  dailyMin: number | null;
  dailyMax: number | null;
  monthlyType: string;
  monthlyMin: number | null;
  monthlyMax: number | null;
  coverPicture: string | null;
  pictures: string[] | null;
  roomCount: number | string | null;
  renthubRefreshedAt: Date | string | null;
  deletedAt: Date | string | null;
};

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const finite = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

/** Maps a DB row to the client payload shape. Pure; exported for tests. */
export function toListingSummary(row: SummaryRow): ListingSummary {
  const pictures = Array.isArray(row.pictures)
    ? row.pictures.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const lat = finite(row.lat);
  const lng = finite(row.lng);
  const hasLocation = lat !== null && lng !== null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    district: row.district,
    subdistrict: row.subdistrict,
    lat: hasLocation ? lat : null,
    lng: hasLocation ? lng : null,
    daily: { type: row.dailyType, min: row.dailyMin, max: row.dailyMax },
    monthly: { type: row.monthlyType, min: row.monthlyMin, max: row.monthlyMax },
    cover: row.coverPicture ?? pictures[0] ?? null,
    pictures,
    roomCount: Number(row.roomCount ?? 0),
    refreshedAt: toIso(row.renthubRefreshedAt),
    deleted: row.deletedAt !== null,
  };
}

/**
 * Every active (non-deleted) listing plus the time of the last successful full scrape.
 * Cached (`"use cache"`, tag `listings`, `days` profile: revalidates in the background after
 * 24 h) and invalidated on demand by `POST /api/revalidate` after each scrape.
 */
export async function getListingsPayload(): Promise<ListingsPayload> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");

  const db = getDb();
  const [rows, lastScrapeAt] = await Promise.all([
    db
      .select(summaryColumns)
      .from(listings)
      .where(isNull(listings.deletedAt))
      .orderBy(asc(listings.id)),
    queryLastScrapeAt(db),
  ]);

  return { listings: rows.map(toListingSummary), lastScrapeAt };
}

/** ISO `finished_at` of the latest successful, non-partial scrape run (uncached). */
export async function queryLastScrapeAt(db: Db): Promise<string | null> {
  const [lastRun] = await db
    .select({ finishedAt: max(scrapeRuns.finishedAt) })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.status, "success"), eq(scrapeRuns.partial, false)));
  return toIso(lastRun?.finishedAt);
}
