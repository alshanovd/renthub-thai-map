/**
 * zod schemas for the renthub fields we use. `z.object` strips unknown keys, so `__typename`,
 * `contactInformation` and everything else we don't model never make it past parsing
 * (`fee` and `amenities` are kept as loose records and cleaned in `map.ts`).
 */
import { z } from "zod";

const optionalText = z.string().nullish();
const optionalNumber = z.number().nullish();

export const PriceRangeSchema = z.object({
  type: z.string(),
  minPrice: optionalNumber,
  maxPrice: optionalNumber,
});
export type RawPriceRange = z.infer<typeof PriceRangeSchema>;

export const PriceSchema = z.object({
  daily: PriceRangeSchema,
  monthly: PriceRangeSchema,
});

export const SearchListingSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  price: PriceSchema,
  province: optionalText,
  district: optionalText,
  subdistrict: optionalText,
  coverPicture: optionalText,
  refreshedAt: optionalText,
});
export type SearchListing = z.infer<typeof SearchListingSchema>;

export const SearchPageSchema = z.object({
  listings: z.array(SearchListingSchema),
  pagination: z.object({
    page: z.number(),
    perPage: z.number(),
    totalCount: z.number(),
    totalPages: z.number(),
  }),
});
export type SearchPageData = z.infer<typeof SearchPageSchema>;

export const RoomSchema = z.object({
  roomName: optionalText,
  roomType: optionalText,
  minSize: optionalNumber,
  maxSize: optionalNumber,
  price: PriceSchema.nullish(),
  availability: z.boolean().nullish(),
});

export const PictureSchema = z.object({
  pictureUrl: z.string(),
  caption: optionalText,
  position: optionalNumber,
});

export const NearbyZoneSchema = z.object({
  name: z.string(),
  zoneType: optionalText,
  distance: optionalNumber,
});

export const ListingDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  slugPerLocale: z.object({ en: optionalText, th: optionalText }).nullish(),
  name: z.string(),
  title: optionalText,
  description: optionalText,

  province: optionalText,
  district: optionalText,
  subdistrict: optionalText,
  road: optionalText,
  street: optionalText,
  houseNumber: optionalText,

  location: z.object({ lat: z.number().nullable(), lng: z.number().nullable() }).nullable(),

  price: PriceSchema,
  rooms: z.array(RoomSchema).nullish(),
  pictures: z.array(PictureSchema).nullish(),
  coverPicture: optionalText,

  amenities: z.record(z.string(), z.unknown()).nullish(),
  fee: z.unknown(),
  nearbyZones: z.array(NearbyZoneSchema).nullish(),
  review: z.object({ totalCount: optionalNumber, score: optionalNumber }).nullish(),

  sponsorPackage: optionalText,
  displayStatus: optionalText,
  totalView: optionalNumber,
  updatedAt: optionalText,
  refreshedAt: optionalText,
});
export type ListingDetail = z.infer<typeof ListingDetailSchema>;

/** `pageProps` of a listing detail page. */
export const ListingPagePropsSchema = z.object({ listing: ListingDetailSchema });

/** One line per zod issue: `listing.price.daily.type: Invalid input: expected string`. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Validates a detail page's `pageProps`; never throws. */
export function parseListingPageProps(pageProps: unknown): ParseResult<ListingDetail> {
  const result = ListingPagePropsSchema.safeParse(pageProps);
  return result.success
    ? { ok: true, data: result.data.listing }
    : { ok: false, error: formatIssues(result.error) };
}
