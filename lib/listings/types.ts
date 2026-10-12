import type { PriceRange } from "@/lib/db/schema";

export type { PriceRange };

/** Which price the UI is searching/sorting by: `day` (daily) or `month` (monthly). */
export type PriceMode = "day" | "month";

/** One listing as sent to the client. Keep it lean: it is shipped for every listing. */
export type ListingSummary = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  subdistrict: string | null;
  /** Null lat/lng means renthub has no location for this listing. */
  lat: number | null;
  lng: number | null;
  daily: PriceRange;
  monthly: PriceRange;
  /** CDN path (see `thumbUrl` / `fullUrl` in `@/lib/images`). */
  cover: string | null;
  /** CDN paths, ordered by renthub's position. */
  pictures: string[];
  roomCount: number;
  /** ISO timestamp of renthub's `refreshedAt`. */
  refreshedAt: string | null;
  /** True when the listing is soft-deleted (no longer in any search). */
  deleted: boolean;
};

/** Card data served by `/api/listings?ids=` (same shape as `ListingSummary`). */
export type ListingCard = ListingSummary;

/** Price kind of a pin: 0 = `AMOUNT`, 1 = `CALL`. */
export type PinKind = 0 | 1;

/**
 * A pin on the wire: `[id, lat, lng, priceMin | null, kind]`; `priceMin` is the active mode's min
 * (null for CALL). Decoded into `Pin` once, by `fetchPins`.
 */
export type PinTuple = [
  id: string,
  lat: number,
  lng: number,
  priceMin: number | null,
  kind: PinKind,
];

/** A decoded map pin. `price` is the active mode's minimum (null for call-for-price). */
export type Pin = {
  id: string;
  lat: number;
  lng: number;
  price: number | null;
  kind: "amount" | "call";
  /** Set on favorite pins built from a soft-deleted card (drawn greyed out). */
  deleted?: boolean;
};

/** `GET /api/pins?bbox=…&mode=&max=&call=&sort=` */
export type PinsResponse = {
  /** ISO `finished_at` of the latest successful, non-partial scrape run. */
  lastScrapeAt: string | null;
  /** Filtered listings with coordinates in the whole DB (not just the bbox): the "total". */
  total: number;
  /** Filtered listings without coordinates: the No location tab count. */
  noLocationTotal: number;
  /** Filtered pins inside the bbox, in the requested sort order. */
  pins: PinTuple[];
};

/** `PinsResponse` with its pins decoded (what the client works with). */
export type PinsData = Omit<PinsResponse, "pins"> & { pins: Pin[] };

/** `GET /api/listings?ids=…` (unknown ids are omitted; soft-deleted ones included). */
export type ListingCardsResponse = { listings: ListingCard[] };

/** `GET /api/listings/no-location?…&cursor=&limit=` */
export type NoLocationResponse = { listings: ListingCard[]; nextCursor: string | null };
