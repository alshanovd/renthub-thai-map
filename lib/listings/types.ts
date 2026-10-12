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

export type ListingsPayload = {
  listings: ListingSummary[];
  /** ISO `finished_at` of the latest successful, non-partial scrape run. */
  lastScrapeAt: string | null;
};
