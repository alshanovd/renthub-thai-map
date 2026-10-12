import "server-only";

import { and, asc, inArray, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { getDb, schema } from "@/lib/db/client";
import type { Bounds } from "@/lib/store";

import {
  activeSql,
  bboxSql,
  hasLocationSql,
  noLocationSql,
  priceMinSql,
  priceTypeSql,
  searchFilterSql,
  searchOrderSql,
} from "./api-sql";
import type { Search } from "./filter";
import { LISTINGS_TAG, queryLastScrapeAt, summaryColumns, toListingSummary } from "./query";
import type { ListingCard, Pin } from "./types";

/**
 * Cached queries behind the data API. Every function is `"use cache"`, keyed by its
 * (already parsed and normalized) arguments, tagged `listings` (so `POST /api/revalidate`
 * invalidates them) with the `days` profile. Route handlers can't hold `"use cache"` themselves.
 */

const { listings } = schema;

/** 6 decimals ≈ 0.1 m: plenty for a pin, and shorter JSON. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** ISO time of the last successful full scrape. */
export async function getLastScrapeAt(): Promise<string | null> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");
  return queryLastScrapeAt(getDb());
}

/** Filtered active listings with coordinates inside `bbox`, sorted by `search.sort`. */
export async function getPins(bbox: Bounds, search: Search): Promise<Pin[]> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");
  const rows = await getDb()
    .select({
      id: listings.id,
      lat: listings.lat,
      lng: listings.lng,
      price: priceMinSql(search.mode),
      type: priceTypeSql(search.mode),
    })
    .from(listings)
    .where(and(activeSql, hasLocationSql, searchFilterSql(search), bboxSql(bbox)))
    .orderBy(...searchOrderSql(search.sort, search.mode));
  return rows.map((row) => [
    row.id,
    round6(row.lat ?? 0),
    round6(row.lng ?? 0),
    row.price === null ? null : Number(row.price),
    row.type === "CALL" ? 1 : 0,
  ]);
}

/** Counts of filtered active listings with and without coordinates (whole DB). */
export async function getSearchTotals(
  search: Search,
): Promise<{ total: number; noLocationTotal: number }> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*) filter (where ${hasLocationSql})::int`,
      noLocationTotal: sql<number>`count(*) filter (where ${noLocationSql})::int`,
    })
    .from(listings)
    .where(and(activeSql, searchFilterSql(search)));
  return { total: Number(row?.total ?? 0), noLocationTotal: Number(row?.noLocationTotal ?? 0) };
}

async function getCardsCached(sortedIds: readonly string[]): Promise<ListingCard[]> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");
  const rows = await getDb()
    .select(summaryColumns)
    .from(listings)
    .where(inArray(listings.id, [...sortedIds]))
    .orderBy(asc(listings.id));
  return rows.map(toListingSummary);
}

/**
 * Card data by id, soft-deleted listings included (`deleted: true`); unknown ids are omitted.
 * Ordered by id; cached per sorted, de-duplicated id list.
 */
export async function getListingCards(ids: readonly string[]): Promise<ListingCard[]> {
  const sorted = [...new Set(ids)].toSorted();
  if (sorted.length === 0) return [];
  return getCardsCached(sorted);
}

/** One page of filtered active listings without coordinates, in sort order. */
export async function getNoLocationPage(
  search: Search,
  offset: number,
  limit: number,
): Promise<{ listings: ListingCard[]; nextOffset: number | null }> {
  "use cache";
  cacheTag(LISTINGS_TAG);
  cacheLife("days");
  const rows = await getDb()
    .select(summaryColumns)
    .from(listings)
    .where(and(activeSql, noLocationSql, searchFilterSql(search)))
    .orderBy(...searchOrderSql(search.sort, search.mode))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  return {
    listings: rows.slice(0, limit).map(toListingSummary),
    nextOffset: hasMore ? offset + limit : null,
  };
}
