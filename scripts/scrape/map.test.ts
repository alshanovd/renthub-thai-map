import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeLocation,
  normalizePrice,
  REDACTED,
  redactContacts,
  stripTypename,
  toListingRow,
} from "./map";
import { ListingDetailSchema, parseListingPageProps, type ListingDetail } from "./schemas";

const rawFixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__", "listing-detail.json"), "utf8"),
) as { pageProps: { listing: Record<string, unknown> } };

const rawListing = () => structuredClone(rawFixture.pageProps.listing);
const parse = (listing: Record<string, unknown>): ListingDetail =>
  ListingDetailSchema.parse(listing);
const NOW = new Date("2026-10-12T00:00:00.000Z");

describe("toListingRow (smith-residence-chiang-mai)", () => {
  const { row, noLocation } = toListingRow(parse(rawListing()), ["daily"], NOW);

  it("maps identity, address and metadata", () => {
    expect(row).toMatchObject({
      id: "63185",
      slug: "smith-residence-chiang-mai",
      slugTh: "สมิทธ์-เรสซิเด้นซ์-เชียงใหม่",
      name: "Smith Residence (Chiang Mai)",
      title: null,
      province: "Chiang Mai",
      district: "Muang Chiang Mai",
      subdistrict: "Hai Ya",
      road: null,
      sponsorPackage: "PREMIUM",
      totalViews: 69085,
      reviewCount: 0,
      reviewScore: null,
      sourceSearches: ["daily"],
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      detailFetchedAt: NOW,
      deletedAt: null,
    });
    expect(row.renthubUpdatedAt).toEqual(new Date("2026-08-13T02:59:49.800Z"));
  });

  it("keeps the location", () => {
    expect(noLocation).toBe(false);
    expect(row.lat).toBeCloseTo(18.779, 3);
    expect(row.lng).toBeCloseTo(98.988, 3);
  });

  it("maps prices and rooms", () => {
    expect(row).toMatchObject({
      dailyType: "AMOUNT",
      dailyMin: 750,
      dailyMax: 950,
      monthlyType: "AMOUNT",
      monthlyMin: 9500,
      monthlyMax: 21000,
    });
    expect(row.rooms?.[0]).toEqual({
      name: "STUDIO",
      type: "STUDIO",
      minSize: 32,
      maxSize: 32,
      daily: { type: "AMOUNT", min: 750, max: 950 },
      monthly: { type: "AMOUNT", min: 9500, max: 9500 },
      available: false,
    });
  });

  it("keeps the first 5 nearby zones", () => {
    expect(row.nearbyZones).toHaveLength(5);
    expect(row.nearbyZones?.[0]).toEqual({
      name: "Robinson Chiangmai",
      zoneType: "SHOPPING",
      distance: 1681,
    });
  });

  it("strips __typename from every JSON column", () => {
    const json = JSON.stringify([
      row.pictures,
      row.rooms,
      row.amenities,
      row.fees,
      row.nearbyZones,
    ]);
    expect(json).not.toContain("__typename");
    expect(row.amenities).toMatchObject({ hasAir: true, hasPool: true });
    expect(row.fees).toMatchObject({ water: { type: "AMOUNT", unitPrice: 30 } });
  });
});

describe("normalizePrice", () => {
  it("keeps AMOUNT prices", () => {
    expect(normalizePrice({ type: "AMOUNT", minPrice: 500, maxPrice: 700 })).toEqual({
      type: "AMOUNT",
      min: 500,
      max: 700,
    });
    expect(normalizePrice({ type: "AMOUNT", minPrice: 500, maxPrice: 0 })).toEqual({
      type: "AMOUNT",
      min: 500,
      max: 500,
    });
  });

  it("nulls CALL / NO_DAILY_RENTAL and zero/null AMOUNT prices", () => {
    expect(normalizePrice({ type: "CALL", minPrice: 0, maxPrice: 0 })).toEqual({
      type: "CALL",
      min: null,
      max: null,
    });
    expect(normalizePrice({ type: "NO_DAILY_RENTAL", minPrice: null, maxPrice: null })).toEqual({
      type: "NO_DAILY_RENTAL",
      min: null,
      max: null,
    });
    expect(normalizePrice({ type: "AMOUNT", minPrice: 0, maxPrice: 900 })).toEqual({
      type: "AMOUNT",
      min: null,
      max: null,
    });
    expect(normalizePrice({ type: "AMOUNT", minPrice: null })).toEqual({
      type: "AMOUNT",
      min: null,
      max: null,
    });
  });

  it("maps a CALL daily price on the whole listing", () => {
    const listing = rawListing();
    (listing.price as { daily: unknown }).daily = { type: "CALL", minPrice: 0, maxPrice: 0 };
    const { row } = toListingRow(parse(listing), ["daily"], NOW);
    expect([row.dailyType, row.dailyMin, row.dailyMax]).toEqual(["CALL", null, null]);
  });
});

describe("location", () => {
  it.each([
    ["null", null],
    ["zero", { lat: 0, lng: 0 }],
    ["outside Thailand", { lat: 48.85, lng: 2.35 }],
    ["swapped lat/lng", { lat: 98.98, lng: 18.78 }],
    ["null coordinates", { lat: null, lng: null }],
  ])("%s becomes no location", (_, location) => {
    expect(normalizeLocation(location)).toBeNull();
    const listing = rawListing();
    listing.location = location;
    const { row, noLocation } = toListingRow(parse(listing), ["daily"], NOW);
    expect(noLocation).toBe(true);
    expect([row.lat, row.lng]).toEqual([null, null]);
  });
});

describe("pictures", () => {
  it("orders by position and falls back to the first picture as cover", () => {
    const listing = rawListing();
    const pictures = listing.pictures as Array<Record<string, unknown>>;
    listing.pictures = [
      { ...pictures[0], position: 3, caption: "third" },
      { ...pictures[1], position: 1, caption: "" },
      { ...pictures[2], position: 2 },
    ];
    listing.coverPicture = null;
    const { row } = toListingRow(parse(listing), ["daily"], NOW);
    expect(row.pictures).toEqual([
      { path: pictures[1]?.pictureUrl, caption: null },
      { path: pictures[2]?.pictureUrl, caption: null },
      { path: pictures[0]?.pictureUrl, caption: "third" },
    ]);
    expect(row.coverPicture).toBe(pictures[1]?.pictureUrl);
  });
});

describe("contact information", () => {
  it("never reaches the row", () => {
    const listing = rawListing();
    listing.contactInformation = {
      __typename: "ContactInformationType",
      name: "Owner Name",
      phone: "0812345678",
      email: "owner@example.com",
      lineId: "ownerline",
    };
    const parsed = parseListingPageProps({ listing });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = JSON.stringify(toListingRow(parsed.data, ["daily"], NOW).row);
    expect(json).not.toContain("contactInformation");
    expect(json).not.toContain("0812345678");
    expect(json).not.toContain("owner@example.com");
    expect(json).not.toContain("lineId");
    expect(json).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe("stripTypename", () => {
  it("removes __typename recursively, including in arrays", () => {
    expect(stripTypename({ __typename: "A", a: [{ __typename: "B", b: 1 }], c: null })).toEqual({
      a: [{ b: 1 }],
      c: null,
    });
  });
});

describe("redactContacts", () => {
  it.each([
    ["Tel. 081-234-5678 (Khun A)", `Tel. ${REDACTED} (Khun A)`],
    ["call 0812345678", `call ${REDACTED}`],
    ["Fax: (+66) 53 123 456", `Fax: ${REDACTED}`],
    ["+66 81 234 5678", REDACTED],
    ["Phone: 02-026-6941", `Phone: ${REDACTED}`],
    ["E-mail: owner.name@gmail.com", `E-mail: ${REDACTED}`],
    ['<a href="mailto:a@b.co">a@b.co</a>', `<a href="mailto:${REDACTED}">${REDACTED}</a>`],
    ["Line ID: @myhotel", `Line ID: ${REDACTED}`],
    ["LINE : some.owner", `LINE : ${REDACTED}`],
    ["Line ID  @ecoroom", `Line ID  ${REDACTED}`],
    ["WeChat : pingping88", `WeChat : ${REDACTED}`],
    ["add @698iudrh", `add ${REDACTED}`],
    ["https://line.me/R/ti/p/@abc", REDACTED],
  ])("redacts %s", (input, expected) => {
    expect(redactContacts(input)).toBe(expected);
  });

  it.each([
    "Price 3,500 - 12,000 baht",
    "Open 09.00-18.00",
    "Online booking, 5 minutes to Maya mall",
    "Stay at Yantarasri @Nimman",
    "Built in 2019, 32 sqm, floor 5",
  ])("keeps %s", (input) => {
    expect(redactContacts(input)).toBe(input);
  });

  it("is applied to the description", () => {
    const listing = rawListing();
    listing.description = "<p>Contact Tel. 089-123-4567 or Line: @owner1</p>";
    const { row } = toListingRow(parse(listing), ["daily"], NOW);
    expect(row.description).toBe(`<p>Contact Tel. ${REDACTED} or Line: ${REDACTED}</p>`);
  });
});
