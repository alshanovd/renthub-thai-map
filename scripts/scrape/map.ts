/**
 * Pure mapping from a validated renthub listing detail to a `listings` row.
 */
import type {
  ListingAmenities,
  ListingFees,
  ListingPicture,
  ListingRoom,
  NearbyZone,
  NewListing,
  PriceRange,
} from "@/lib/db/schema";

import type { ListingDetail, RawPriceRange } from "./schemas";

/** Thailand's bounding box (generous). Coordinates outside it are treated as missing. */
export const THAILAND_BBOX = { minLat: 5, maxLat: 21, minLng: 97, maxLng: 106 } as const;

export const MAX_NEARBY_ZONES = 5;

export interface MappedListing {
  row: NewListing & { id: string };
  /** True when renthub has no usable coordinates for this listing. */
  noLocation: boolean;
}

/** Recursively removes every `__typename` key. */
export function stripTypename<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripTypename(item)) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== "__typename") out[key] = stripTypename(item);
    }
    return out as T;
  }
  return value;
}

const toInt = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;

/** `min`/`max` are kept only for `AMOUNT` prices with a positive minimum. */
export function normalizePrice(price: RawPriceRange | null | undefined): PriceRange {
  const type = price?.type ?? "UNKNOWN";
  const min = toInt(price?.minPrice);
  if (type !== "AMOUNT" || min === null || min <= 0) return { type, min: null, max: null };
  const max = toInt(price?.maxPrice);
  return { type, min, max: max !== null && max >= min ? max : min };
}

/** Returns `{lat, lng}` only for a real coordinate inside Thailand. */
export function normalizeLocation(
  location: ListingDetail["location"],
): { lat: number; lng: number } | null {
  if (!location) return null;
  const { lat, lng } = location;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { minLat, maxLat, minLng, maxLng } = THAILAND_BBOX;
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return null;
  return { lat, lng };
}

export const REDACTED = "[contact removed]";

const CONTACT_PATTERNS: Array<[RegExp, string]> = [
  // LINE / messenger links.
  [
    /https?:\/\/(?:line\.me|lin\.ee|page\.line\.me|wa\.me|api\.whatsapp\.com)\/[^\s"'<>]*/gi,
    REDACTED,
  ],
  // E-mail addresses (also inside `mailto:` hrefs).
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, REDACTED],
  // Messenger ids after a label: "Line ID: @abc", "LINE: 0812345678", "WeChat: abc", "ไลน์ : abc".
  [
    /((?:\bline|\bwechat|\bwhatsapp|ไลน์|ไอดีไลน์)(?:\s*id)?\s*(?:[:：]|&nbsp;)+\s*)@?[\w.+-]+/gi,
    `$1${REDACTED}`,
  ],
  // ... or without a colon when the id is an @handle: "Line ID @abc".
  [/((?:\bline|ไลน์)(?:\s*id)?(?:\s|&nbsp;)*)@[\w.-]+/gi, `$1${REDACTED}`],
  // Bare LINE official-account handles containing a digit: "@698abcde".
  [/(?<!\.)@(?=[\w.-]*\d)[a-z0-9._-]{4,}/gi, REDACTED],
  // Thai numbers with a country code: "(+66) 53 123 456", "+66 81 234 5678".
  [/\(?\+?66\)?[\s.-]*\d(?:[\s.-]?\d){7,9}(?!\d)/g, REDACTED],
  // Phone numbers: 9-12 digits with optional separators, e.g. 081-234-5678, 053123456.
  [/(?<![\w/=%#&-])\+?\d(?:[\s.+-]?\d){8,11}(?![\w%])/g, REDACTED],
];

/** Removes owners' phone numbers, e-mails and messenger ids from free text. */
export function redactContacts(value: string): string;
export function redactContacts(value: string | null): string | null;
export function redactContacts(value: string | null): string | null {
  if (value === null) return null;
  let out = value;
  for (const [pattern, replacement] of CONTACT_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Trims; empty strings become null. */
const text = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const toDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function mapPictures(pictures: ListingDetail["pictures"]): ListingPicture[] {
  return (pictures ?? [])
    .map((picture, index) => ({ picture, index }))
    .toSorted(
      (a, b) =>
        (a.picture.position ?? Number.MAX_SAFE_INTEGER) -
          (b.picture.position ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .filter(({ picture }) => picture.pictureUrl.trim() !== "")
    .map(({ picture }) => ({
      path: picture.pictureUrl,
      caption: redactContacts(text(picture.caption)),
    }));
}

export function mapRooms(rooms: ListingDetail["rooms"]): ListingRoom[] {
  return (rooms ?? []).map((room) => ({
    name: redactContacts(text(room.roomName)),
    type: text(room.roomType),
    minSize: room.minSize ?? null,
    maxSize: room.maxSize ?? null,
    daily: normalizePrice(room.price?.daily),
    monthly: normalizePrice(room.price?.monthly),
    available: room.availability ?? null,
  }));
}

function mapAmenities(amenities: ListingDetail["amenities"]): ListingAmenities {
  const out: ListingAmenities = {};
  for (const [key, value] of Object.entries(amenities ?? {})) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function mapFees(fee: unknown): ListingFees {
  if (typeof fee !== "object" || fee === null || Array.isArray(fee)) return {};
  return stripTypename(fee as ListingFees);
}

function mapNearbyZones(zones: ListingDetail["nearbyZones"]): NearbyZone[] {
  return (zones ?? []).slice(0, MAX_NEARBY_ZONES).map((zone) => ({
    name: zone.name,
    zoneType: zone.zoneType ?? null,
    distance: zone.distance ?? null,
  }));
}

/**
 * Maps a validated detail to a `listings` row. `now` is the run's start time (used for
 * `last_seen_at`/`first_seen_at`); `detailFetchedAt` defaults to `now`.
 */
export function toListingRow(
  detail: ListingDetail,
  searchKeys: readonly string[],
  now: Date,
  detailFetchedAt: Date = now,
): MappedListing {
  const location = normalizeLocation(detail.location);
  const daily = normalizePrice(detail.price.daily);
  const monthly = normalizePrice(detail.price.monthly);
  const pictures = mapPictures(detail.pictures);
  const reviewCount = toInt(detail.review?.totalCount) ?? 0;

  const row: MappedListing["row"] = {
    id: detail.id,
    slug: detail.slug,
    slugTh: text(detail.slugPerLocale?.th),
    name: redactContacts(detail.name.trim() || detail.slug),
    title: redactContacts(text(detail.title)),

    province: text(detail.province),
    district: text(detail.district),
    subdistrict: text(detail.subdistrict),
    road: text(detail.road),
    street: text(detail.street),
    houseNumber: text(detail.houseNumber),

    lat: location?.lat ?? null,
    lng: location?.lng ?? null,

    dailyType: daily.type,
    dailyMin: daily.min,
    dailyMax: daily.max,
    monthlyType: monthly.type,
    monthlyMin: monthly.min,
    monthlyMax: monthly.max,

    coverPicture: text(detail.coverPicture) ?? pictures[0]?.path ?? null,
    pictures,
    rooms: mapRooms(detail.rooms),
    amenities: mapAmenities(detail.amenities),
    fees: mapFees(detail.fee),
    nearbyZones: mapNearbyZones(detail.nearbyZones),

    description: redactContacts(text(detail.description)),
    sponsorPackage: text(detail.sponsorPackage),
    reviewScore: reviewCount > 0 ? (detail.review?.score ?? null) : null,
    reviewCount,
    totalViews: toInt(detail.totalView),

    sourceSearches: [...searchKeys],

    renthubUpdatedAt: toDate(detail.updatedAt),
    renthubRefreshedAt: toDate(detail.refreshedAt),
    detailFetchedAt,
    firstSeenAt: now,
    lastSeenAt: now,
    deletedAt: null,
  };

  return { row, noLocation: location === null };
}
