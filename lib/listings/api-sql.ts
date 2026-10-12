/**
 * SQL fragments for the data API: the search filter and sort orders, mirroring
 * `matchesSearch` / `applySearch` in `./filter`. Pure (no DB client), so tests can run them
 * on an in-memory Postgres.
 */
import { and, between, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";

import { listings } from "@/lib/db/schema";
import type { Bounds } from "@/lib/store";

import type { Search } from "./filter";
import type { PriceMode } from "./types";

function modeColumns(mode: PriceMode) {
  return mode === "month"
    ? { type: listings.monthlyType, min: listings.monthlyMin, max: listings.monthlyMax }
    : { type: listings.dailyType, min: listings.dailyMin, max: listings.dailyMax };
}

/** The active mode's price type column (`AMOUNT`, `CALL`, …). */
export const priceTypeSql = (mode: PriceMode) => modeColumns(mode).type;

/** The active mode's minimum `AMOUNT` price (min, falling back to max); null otherwise. */
export function priceMinSql(mode: PriceMode): SQL<number | null> {
  const c = modeColumns(mode);
  return sql<number | null>`(case when ${c.type} = 'AMOUNT' then coalesce(${c.min}, ${c.max}) end)`;
}

/** Not soft-deleted. */
export const activeSql = isNull(listings.deletedAt);

/** Has coordinates (the map can draw it). */
export const hasLocationSql = and(isNotNull(listings.lat), isNotNull(listings.lng)) as SQL;

/** No coordinates (the No location tab). */
export const noLocationSql = or(isNull(listings.lat), isNull(listings.lng)) as SQL;

/** Same rule as `matchesSearch`: CALL only with `call`, otherwise an AMOUNT min ≤ `max`. */
export function searchFilterSql(search: Pick<Search, "mode" | "max" | "call">): SQL {
  const price = priceMinSql(search.mode);
  const amount = Number.isFinite(search.max)
    ? sql`${price} <= ${search.max}`
    : sql`${price} is not null`;
  if (!search.call) return amount;
  return sql`(${priceTypeSql(search.mode)} = 'CALL' or ${amount})`;
}

/** Inside a (non antimeridian-crossing) bbox. */
export function bboxSql(bbox: Bounds): SQL {
  return and(
    between(listings.lat, bbox.south, bbox.north),
    between(listings.lng, bbox.west, bbox.east),
  ) as SQL;
}

/**
 * Same order as `applySearch`: price sorts put call-for-price (null price) last in both
 * directions; `updated` is newest `renthub_refreshed_at` first, nulls last; ties by id
 * (byte order, like JS string comparison of ASCII ids).
 */
export function searchOrderSql(sort: Search["sort"], mode: PriceMode): SQL[] {
  const byId = sql`${listings.id} collate "C" asc`;
  if (sort === "updated") return [sql`${listings.renthubRefreshedAt} desc nulls last`, byId];
  const price = priceMinSql(mode);
  return [
    sql`(${price} is null) asc`,
    sort === "price-desc" ? sql`${price} desc` : sql`${price} asc`,
    byId,
  ];
}
