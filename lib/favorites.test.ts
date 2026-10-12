import { describe, expect, it, vi } from "vitest";

import {
  createFavoritesStore,
  FAVORITES_KEY,
  type KeyValueStorage,
  parseFavorites,
} from "./favorites";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  return { storage, data };
}

function clock(start = 1_000) {
  let t = start;
  return () => (t += 10);
}

describe("parseFavorites", () => {
  it("returns [] for missing, corrupt or non-array JSON", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("{not json")).toEqual([]);
    expect(parseFavorites('{"id":"1"}')).toEqual([]);
    expect(parseFavorites("42")).toEqual([]);
  });

  it("drops malformed entries and duplicates, sorts newest first", () => {
    const raw = JSON.stringify([
      { id: "a", addedAt: 1 },
      { id: "b", addedAt: 3 },
      { id: "a", addedAt: 5 },
      { id: "", addedAt: 2 },
      { id: 7, addedAt: 2 },
      { id: "c" },
      "d",
      null,
      { id: "e", addedAt: 2 },
    ]);
    expect(parseFavorites(raw).map((e) => e.id)).toEqual(["b", "e", "a"]);
  });
});

describe("createFavoritesStore", () => {
  it("toggles favorites on and off, newest first", () => {
    const { storage } = memoryStorage();
    const store = createFavoritesStore(() => storage, clock());
    store.toggle("a");
    store.toggle("b");
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["b", "a"]);
    expect(store.isFavorite("a")).toBe(true);
    store.toggle("a");
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["b"]);
    expect(store.isFavorite("a")).toBe(false);
  });

  it("persists to storage and a new store reads it back", () => {
    const { storage, data } = memoryStorage();
    const first = createFavoritesStore(() => storage, clock());
    first.toggle("10512");
    first.toggle("10576");
    expect(JSON.parse(data.get(FAVORITES_KEY) ?? "[]")).toHaveLength(2);

    const second = createFavoritesStore(() => storage, clock());
    expect(second.getSnapshot().map((e) => e.id)).toEqual(["10576", "10512"]);
  });

  it("recovers from corrupt JSON to an empty list and overwrites it on the next toggle", () => {
    const { storage, data } = memoryStorage({ [FAVORITES_KEY]: "][garbage" });
    const store = createFavoritesStore(() => storage, clock());
    expect(store.getSnapshot()).toEqual([]);
    store.toggle("x");
    expect(parseFavorites(data.get(FAVORITES_KEY) ?? null).map((e) => e.id)).toEqual(["x"]);
  });

  it("falls back to memory when storage throws", () => {
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createFavoritesStore(() => storage, clock());
    expect(store.getSnapshot()).toEqual([]);
    store.toggle("a");
    expect(store.isFavorite("a")).toBe(true);
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["a"]);
  });

  it("works without any storage (server) and keeps a stable snapshot", () => {
    const store = createFavoritesStore(() => null, clock());
    const snapshot = store.getSnapshot();
    expect(store.getSnapshot()).toBe(snapshot);
    expect(store.getServerSnapshot()).toEqual([]);
  });

  it("notifies subscribers on toggle and keeps order for same-millisecond adds", () => {
    const { storage } = memoryStorage();
    const store = createFavoritesStore(
      () => storage,
      () => 5,
    );
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.toggle("a");
    store.toggle("b");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().map((e) => e.id)).toEqual(["b", "a"]);
    unsubscribe();
    store.toggle("c");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
