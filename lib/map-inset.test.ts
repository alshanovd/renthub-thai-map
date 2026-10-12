import { describe, expect, it } from "vitest";

import { centerAboveInset, inVisibleArea, latDegreesForPixels, usableInset } from "./map-inset";

const bounds = { north: 19, south: 18, east: 99.5, west: 98.5 };

describe("usableInset", () => {
  it("is 0 without an inset or a map", () => {
    expect(usableInset(0, 800, 200)).toBe(0);
    expect(usableInset(120, 0, 200)).toBe(0);
  });
  it("keeps at least minVisible pixels of map", () => {
    expect(usableInset(120, 800, 200)).toBe(120);
    expect(usableInset(700, 800, 200)).toBe(600);
    expect(usableInset(800, 150, 200)).toBe(0);
  });
});

describe("inVisibleArea", () => {
  it("matches plain bounds without an inset", () => {
    expect(inVisibleArea(bounds, { lat: 18.1, lng: 99 }, 0, 800)).toBe(true);
    expect(inVisibleArea(bounds, { lat: 19.1, lng: 99 }, 0, 800)).toBe(false);
    expect(inVisibleArea(bounds, { lat: 18.5, lng: 100 }, 0, 800)).toBe(false);
  });
  it("excludes the strip covered by the inset", () => {
    // Bottom half covered: visible latitudes are 18.5–19.
    expect(inVisibleArea(bounds, { lat: 18.4, lng: 99 }, 400, 800)).toBe(false);
    expect(inVisibleArea(bounds, { lat: 18.6, lng: 99 }, 400, 800)).toBe(true);
  });
  it("handles bounds across the antimeridian", () => {
    const wrap = { north: 1, south: -1, east: -179, west: 179 };
    expect(inVisibleArea(wrap, { lat: 0, lng: 179.5 }, 0, 800)).toBe(true);
    expect(inVisibleArea(wrap, { lat: 0, lng: -179.5 }, 0, 800)).toBe(true);
    expect(inVisibleArea(wrap, { lat: 0, lng: 0 }, 0, 800)).toBe(false);
  });
});

describe("centerAboveInset", () => {
  it("is the target without an inset", () => {
    const target = { lat: 18.79, lng: 98.98 };
    expect(centerAboveInset(target, 0, 13)).toBe(target);
  });
  it("moves the center south by half the inset", () => {
    const target = { lat: 18.79, lng: 98.98 };
    const center = centerAboveInset(target, 400, 13);
    expect(center.lng).toBe(target.lng);
    expect(target.lat - center.lat).toBeCloseTo(latDegreesForPixels(200, 13, 18.79), 10);
    // 200 px at zoom 13 is about 0.0325° of latitude near Chiang Mai.
    expect(target.lat - center.lat).toBeCloseTo(0.0325, 3);
  });
});
