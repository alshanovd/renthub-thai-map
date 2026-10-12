import { describe, expect, it } from "vitest";

import { diffPins, pinView, type PinView } from "./pin-diff";
import type { Pin } from "./types";

function pin(id: string, overrides: Partial<Pin> = {}): Pin {
  return { id, lat: 18.79, lng: 98.98, price: 500, kind: "amount", ...overrides };
}

const NO_FAVORITES = new Set<string>();
const view = (p: Pin, favorites: ReadonlySet<string> = NO_FAVORITES) =>
  pinView(p, "day", favorites);
const byId = (views: PinView[]) => new Map(views.map((v) => [v.id, v]));
const ids = (views: PinView[]) => views.map((v) => v.id);

describe("pinView", () => {
  it("formats the label for the mode", () => {
    expect(pinView(pin("a", { price: 7500 }), "month", NO_FAVORITES).label).toBe("฿7.5k");
    expect(pinView(pin("a", { price: 500 }), "day", NO_FAVORITES).label).toBe("฿500");
    expect(pinView(pin("a", { price: null, kind: "call" }), "day", NO_FAVORITES).label).toBe(
      "Call",
    );
  });

  it("marks favorites, and mutes only deleted favorites", () => {
    const favorites = new Set(["a", "b"]);
    expect(pinView(pin("a"), "day", favorites)).toMatchObject({ favorite: true, muted: false });
    expect(pinView(pin("b", { deleted: true }), "day", favorites)).toMatchObject({
      favorite: true,
      muted: true,
    });
    expect(pinView(pin("c", { deleted: true }), "day", favorites)).toMatchObject({
      favorite: false,
      muted: false,
    });
  });
});

describe("diffPins", () => {
  const a = view(pin("a"));
  const b = view(pin("b"));
  const c = view(pin("c"));

  it("adds everything on the first call", () => {
    expect(diffPins(new Map(), [a, b])).toEqual({ add: [a, b], remove: [], update: [] });
  });

  it("adds new ids, removes gone ids and leaves unchanged ones alone", () => {
    const diff = diffPins(byId([a, b]), [b, c]);
    expect(ids(diff.add)).toEqual(["c"]);
    expect(diff.remove).toEqual(["a"]);
    expect(diff.update).toEqual([]);
  });

  it("updates a kept pin when its label, position, favorite or muted state changes", () => {
    const prev = byId([a, b, c]);
    const next = [
      view(pin("a", { price: 600 })),
      view(pin("b", { lat: 18.8 })),
      view(pin("c"), new Set(["c"])),
    ];
    const diff = diffPins(prev, next);
    expect(ids(diff.update)).toEqual(["a", "b", "c"]);
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([]);
  });

  it("updates every label on a mode change", () => {
    const pricey = [pin("a", { price: 7500 }), pin("b", { price: 9000 })];
    const prev = byId(pricey.map((p) => view(p)));
    const next = pricey.map((p) => pinView(p, "month", NO_FAVORITES));
    expect(ids(diffPins(prev, next).update)).toEqual(["a", "b"]);
  });

  it("removes everything for an empty list", () => {
    expect(diffPins(byId([a, b]), [])).toEqual({ add: [], remove: ["a", "b"], update: [] });
  });

  it("keeps the first of duplicate ids", () => {
    const dup = view(pin("a", { price: 900 }));
    expect(diffPins(new Map(), [a, dup]).add).toEqual([a]);
  });
});
