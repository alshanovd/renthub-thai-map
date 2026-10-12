import { afterEach, describe, expect, it, vi } from "vitest";

import { preloadImage, preloadIndex, stepIndex } from "./use-photo-stepper";

describe("stepIndex", () => {
  it("steps forward and back inside the range", () => {
    expect(stepIndex(0, 1, 5)).toBe(1);
    expect(stepIndex(3, -1, 5)).toBe(2);
  });

  it("wraps around at both ends", () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(1, -7, 5)).toBe(4);
  });

  it("stays at 0 with one or no picture", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("preloadIndex", () => {
  it("targets the neighbour in the given direction, wrapping", () => {
    expect(preloadIndex(0, 1, 3)).toBe(1);
    expect(preloadIndex(0, -1, 3)).toBe(2);
    expect(preloadIndex(2, 1, 3)).toBe(0);
  });

  it("targets the other picture of two in both directions", () => {
    expect(preloadIndex(0, 1, 2)).toBe(1);
    expect(preloadIndex(0, -1, 2)).toBe(1);
  });

  it("has nothing to preload with fewer than two pictures", () => {
    expect(preloadIndex(0, 1, 1)).toBeNull();
    expect(preloadIndex(0, -1, 0)).toBeNull();
  });
});

describe("preloadImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets src on a detached async-decoding image", () => {
    const created: { decoding?: string; src?: string }[] = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "auto";
        src = "";
        constructor() {
          created.push(this);
        }
      },
    );
    preloadImage("https://cdn.test/a.jpg?class=thumbnail");
    expect(created).toEqual([{ decoding: "async", src: "https://cdn.test/a.jpg?class=thumbnail" }]);
  });
});
