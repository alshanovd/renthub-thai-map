import { describe, expect, it } from "vitest";

import { toListingSummary } from "./query";

const base = {
  id: "123",
  slug: "some-place",
  name: "Some Place",
  district: "Muang Chiang Mai",
  subdistrict: "Suthep",
  lat: 18.79,
  lng: 98.98,
  dailyType: "AMOUNT",
  dailyMin: 500,
  dailyMax: 700,
  monthlyType: "NO_MONTHLY_RENTAL",
  monthlyMin: null,
  monthlyMax: null,
  coverPicture: "/listing_picture/a.jpg",
  pictures: ["/listing_picture/a.jpg", "/listing_picture/b.jpg"],
  roomCount: 2,
  renthubRefreshedAt: new Date("2026-10-01T00:00:00Z"),
  deletedAt: null,
};

describe("toListingSummary", () => {
  it("maps a full row", () => {
    expect(toListingSummary(base)).toEqual({
      id: "123",
      slug: "some-place",
      name: "Some Place",
      district: "Muang Chiang Mai",
      subdistrict: "Suthep",
      lat: 18.79,
      lng: 98.98,
      daily: { type: "AMOUNT", min: 500, max: 700 },
      monthly: { type: "NO_MONTHLY_RENTAL", min: null, max: null },
      cover: "/listing_picture/a.jpg",
      pictures: ["/listing_picture/a.jpg", "/listing_picture/b.jpg"],
      roomCount: 2,
      refreshedAt: "2026-10-01T00:00:00.000Z",
      deleted: false,
    });
  });

  it("handles missing location, pictures and cover", () => {
    const summary = toListingSummary({
      ...base,
      lat: null,
      lng: 98.98,
      coverPicture: null,
      pictures: null,
      roomCount: "0",
      renthubRefreshedAt: null,
    });
    expect(summary.lat).toBeNull();
    expect(summary.lng).toBeNull();
    expect(summary.cover).toBeNull();
    expect(summary.pictures).toEqual([]);
    expect(summary.roomCount).toBe(0);
    expect(summary.refreshedAt).toBeNull();
  });

  it("falls back to the first picture as cover and flags deleted rows", () => {
    const summary = toListingSummary({
      ...base,
      coverPicture: null,
      renthubRefreshedAt: "2026-10-01 00:00:00+00",
      deletedAt: "2026-10-05 00:00:00+00",
    });
    expect(summary.cover).toBe("/listing_picture/a.jpg");
    expect(summary.refreshedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(summary.deleted).toBe(true);
  });
});
