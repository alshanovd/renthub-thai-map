import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** renthub price type: `AMOUNT` | `CALL` | `NO_DAILY_RENTAL` | other strings renthub may add. */
export type PriceType = string;

/** A normalized price: `min`/`max` are null unless `type` is `AMOUNT`. */
export type PriceRange = {
  type: PriceType;
  min: number | null;
  max: number | null;
};

/** A photo; `path` is a CDN path (e.g. `/listing_picture/…jpg`), not a full URL. */
export type ListingPicture = {
  path: string;
  caption: string | null;
};

export type ListingRoom = {
  name: string | null;
  type: string | null;
  minSize: number | null;
  maxSize: number | null;
  daily: PriceRange;
  monthly: PriceRange;
  available: boolean | null;
};

export type NearbyZone = {
  name: string;
  zoneType: string | null;
  /** Distance in meters. */
  distance: number | null;
};

/** renthub `fee` object with `__typename` stripped (shape varies per fee kind). */
export type ListingFees = Record<string, unknown>;

/** renthub `amenities` flags (`has*`) with `__typename` stripped. */
export type ListingAmenities = Record<string, boolean>;

export type ScrapeRunStatus = "running" | "success" | "failed";

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    slugTh: text("slug_th"),
    name: text("name").notNull(),
    title: text("title"),

    province: text("province"),
    district: text("district"),
    subdistrict: text("subdistrict"),
    road: text("road"),
    street: text("street"),
    houseNumber: text("house_number"),

    /** Null lat/lng means renthub has no location for this listing. */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    dailyType: text("daily_type").notNull(),
    dailyMin: integer("daily_min"),
    dailyMax: integer("daily_max"),
    monthlyType: text("monthly_type").notNull(),
    monthlyMin: integer("monthly_min"),
    monthlyMax: integer("monthly_max"),

    coverPicture: text("cover_picture"),
    pictures: jsonb("pictures").$type<ListingPicture[]>().notNull().default([]),
    rooms: jsonb("rooms").$type<ListingRoom[]>().notNull().default([]),
    amenities: jsonb("amenities").$type<ListingAmenities>().notNull().default({}),
    fees: jsonb("fees").$type<ListingFees>().notNull().default({}),
    nearbyZones: jsonb("nearby_zones").$type<NearbyZone[]>().notNull().default([]),

    description: text("description"),
    sponsorPackage: text("sponsor_package"),
    reviewScore: real("review_score"),
    reviewCount: integer("review_count").notNull().default(0),
    totalViews: integer("total_views"),

    /**
     * Which searches this listing was seen in: `{daily}` today.
     * Monthly scraping (`/en/apartment/chiang-mai`) will add `monthly` here later.
     */
    sourceSearches: text("source_searches").array().notNull().default([]),

    renthubUpdatedAt: tstz("renthub_updated_at"),
    renthubRefreshedAt: tstz("renthub_refreshed_at"),
    detailFetchedAt: tstz("detail_fetched_at").notNull(),
    firstSeenAt: tstz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    /** Soft delete: set when the listing no longer appears in any scraped search. */
    deletedAt: tstz("deleted_at"),
  },
  (t) => [
    index("listings_deleted_at_idx").on(t.deletedAt),
    index("listings_daily_min_idx").on(t.dailyMin),
  ],
);

export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  startedAt: tstz("started_at").notNull().defaultNow(),
  finishedAt: tstz("finished_at"),
  status: text("status").$type<ScrapeRunStatus>().notNull().default("running"),
  searches: text("searches").array().notNull().default([]),
  /** True when the run used `--limit` (so soft deletes were skipped). */
  partial: boolean("partial").notNull().default(false),
  listCount: integer("list_count").notNull().default(0),
  detailCount: integer("detail_count").notNull().default(0),
  upserted: integer("upserted").notNull().default(0),
  noLocation: integer("no_location").notNull().default(0),
  softDeleted: integer("soft_deleted").notNull().default(0),
  error: text("error"),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
