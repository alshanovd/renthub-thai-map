/**
 * Query-string helpers for the data API (`/api/pins`, `/api/listings`,
 * `/api/listings/no-location`). Shared by the client (building URLs) and the route handlers
 * (parsing), so it must not import the DB.
 */
import { z } from "zod";

import type { Bounds } from "@/lib/store";

import { DEFAULT_SEARCH, type Search } from "./filter";
import { clampMax, PRICE_RANGE, SORT_ORDERS } from "./search-range";

/** Invalid API input; route handlers turn it into `400 { error }`. */
export class ParamError extends Error {
  override name = "ParamError";
}

/** Thailand's bounding box; bboxes are clamped to it. */
export const THAILAND: Readonly<Bounds> = { south: 5.5, west: 97.3, north: 20.6, east: 105.7 };

/** Max ids per `/api/listings?ids=` request. */
export const MAX_CARD_IDS = 100;

/** `/api/listings/no-location` page size. */
export const NO_LOCATION_LIMIT = { min: 1, max: 50, default: 20 } as const;

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

const searchSchema = z.object({
  mode: z.enum(["day", "month"]).optional(),
  max: z
    .string()
    .regex(/^\d{1,9}$/, "max must be a non-negative integer")
    .transform(Number)
    .optional(),
  call: z.enum(["1", "0", "true", "false"]).optional(),
  sort: z.enum(SORT_ORDERS).optional(),
});

const optionalParam = (params: URLSearchParams, name: string) => params.get(name) ?? undefined;

/**
 * `mode`, `max`, `call`, `sort` → `Search`. Defaults: `day`, no limit, no call-for-price,
 * `price-asc`. `max` is clamped like the page URL (`clampMax`): at or above the top of the
 * mode's range it means no limit. Unknown values throw `ParamError`.
 */
export function searchFromParams(params: URLSearchParams): Search {
  const parsed = searchSchema.safeParse({
    mode: optionalParam(params, "mode"),
    max: optionalParam(params, "max"),
    call: optionalParam(params, "call"),
    sort: optionalParam(params, "sort"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ParamError(`invalid ${issue.path.join(".") || "search"}: ${issue.message}`);
  }
  const { mode = DEFAULT_SEARCH.mode, max, call, sort = DEFAULT_SEARCH.sort } = parsed.data;
  return {
    mode,
    max: max === undefined ? Number.POSITIVE_INFINITY : clampMax(max, mode),
    call: call === undefined ? DEFAULT_SEARCH.call : call === "1" || call === "true",
    sort,
  };
}

/**
 * `Search` → `mode`, `max`, `call`, `sort`, always all four and in this order, so equal
 * searches give equal URLs (cache keys). No limit is written as the top of the range.
 */
export function searchToParams(search: Search): URLSearchParams {
  const max = clampMax(search.max, search.mode);
  return new URLSearchParams({
    mode: search.mode,
    max: String(max === Number.POSITIVE_INFINITY ? PRICE_RANGE[search.mode].max : max),
    call: search.call ? "1" : "0",
    sort: search.sort,
  });
}

/** `south,west,north,east` with 5 decimals. */
export function bboxToParam(bounds: Bounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => round5(value).toFixed(5))
    .join(",");
}

/**
 * Parses `south,west,north,east`, rounds to 5 decimals and clamps to Thailand. Throws
 * `ParamError` for malformed numbers, south ≥ north, west > east (antimeridian) or a box that
 * doesn't overlap Thailand.
 */
export function bboxFromParam(value: string | null): Bounds {
  if (value === null || value.trim() === "") throw new ParamError("bbox is required");
  const parts = value.split(",");
  if (parts.length !== 4) throw new ParamError("bbox must be south,west,north,east");
  const numbers = parts.map((part) => (part.trim() === "" ? Number.NaN : Number(part)));
  if (!numbers.every(Number.isFinite)) throw new ParamError("bbox values must be finite numbers");
  const [south, west, north, east] = numbers.map(round5);
  if (south >= north) throw new ParamError("bbox south must be less than north");
  if (west > east) throw new ParamError("bbox crossing the antimeridian is not supported");
  const clamped = {
    south: Math.max(south, THAILAND.south),
    west: Math.max(west, THAILAND.west),
    north: Math.min(north, THAILAND.north),
    east: Math.min(east, THAILAND.east),
  };
  if (clamped.south >= clamped.north || clamped.west >= clamped.east) {
    throw new ParamError("bbox is outside Thailand");
  }
  return clamped;
}

/** Grid step (degrees) for `snapBounds`: 0.005° at zoom 14, doubling per zoom level out. */
export function snapStep(zoom: number): number {
  const level = Math.min(16, Math.max(8, Math.floor(Number.isFinite(zoom) ? zoom : 8)));
  return 0.005 * 2 ** (14 - level);
}

/**
 * Expands the visible bounds by 25% on each side, snaps them outwards to a zoom-dependent grid
 * and clamps them to Thailand, so nearby pans give the same bbox (and cache key). Returns null
 * when the bounds don't overlap Thailand or cross the antimeridian.
 */
export function snapBounds(bounds: Bounds, zoom: number): Bounds | null {
  if (bounds.west > bounds.east || bounds.south > bounds.north) return null;
  const step = snapStep(zoom);
  const latPad = (bounds.north - bounds.south) * 0.25;
  const lngPad = (bounds.east - bounds.west) * 0.25;
  // `- 1e-9`/`+ 1e-9` keep values that are already on the grid from moving a whole step.
  const down = (value: number) => round5(Math.floor(value / step + 1e-9) * step);
  const up = (value: number) => round5(Math.ceil(value / step - 1e-9) * step);
  const snapped = {
    south: Math.max(THAILAND.south, down(bounds.south - latPad)),
    west: Math.max(THAILAND.west, down(bounds.west - lngPad)),
    north: Math.min(THAILAND.north, up(bounds.north + latPad)),
    east: Math.min(THAILAND.east, up(bounds.east + lngPad)),
  };
  if (snapped.south >= snapped.north || snapped.west >= snapped.east) return null;
  return snapped;
}

const idSchema = z.string().regex(/^[\w-]{1,64}$/);

/** `a,b,c` → unique ids (1–`max`, each `[\w-]{1,64}`), in first-seen order. */
export function idsFromParam(value: string | null, max = MAX_CARD_IDS): string[] {
  const ids = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0 || ids.length > max) {
    throw new ParamError(`ids must be 1–${String(max)} comma-separated listing ids`);
  }
  if (!ids.every((id) => idSchema.safeParse(id).success)) {
    throw new ParamError("ids must match [A-Za-z0-9_-]{1,64}");
  }
  return ids;
}

/** Opaque paging cursor: base64url of the offset. */
export function encodeCursor(offset: number): string {
  const bytes = new TextEncoder().encode(String(offset));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Inverse of `encodeCursor`; null/empty means offset 0. Throws `ParamError` when malformed. */
export function decodeCursor(cursor: string | null): number {
  if (cursor === null || cursor === "") return 0;
  if (!/^[\w-]{1,16}$/.test(cursor)) throw new ParamError("invalid cursor");
  let text: string;
  try {
    text = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw new ParamError("invalid cursor");
  }
  if (!/^\d{1,6}$/.test(text)) throw new ParamError("invalid cursor");
  return Number(text);
}

/** `limit` for the no-location page: 1–50, default 20. */
export function limitFromParam(value: string | null): number {
  if (value === null || value === "") return NO_LOCATION_LIMIT.default;
  if (!/^\d{1,3}$/.test(value)) throw new ParamError("limit must be an integer");
  const limit = Number(value);
  if (limit < NO_LOCATION_LIMIT.min || limit > NO_LOCATION_LIMIT.max) {
    throw new ParamError(
      `limit must be ${String(NO_LOCATION_LIMIT.min)}–${String(NO_LOCATION_LIMIT.max)}`,
    );
  }
  return limit;
}
