/**
 * On-disk raw response cache. Keys are logical paths (e.g. `search/daily/chiang-mai/page-3`,
 * `listing/<slug>`) and never contain renthub's build ID, so a redeploy keeps the cache valid.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".cache", "renthub");

export interface CacheEntry<T = unknown> {
  url: string;
  cacheKey: string;
  /** ISO timestamp. */
  fetchedAt: string;
  status: number;
  body: T;
}

export interface ResponseCache {
  readonly dir: string;
  /** Returns the entry if it is younger than `maxAgeMs` (use `Infinity` for any age). */
  get<T = unknown>(key: string, maxAgeMs: number): Promise<CacheEntry<T> | undefined>;
  set(key: string, entry: Omit<CacheEntry, "cacheKey"> & { cacheKey?: string }): Promise<void>;
  fileFor(key: string): string;
}

export function cacheFileName(key: string): string {
  return `${createHash("sha1").update(key).digest("hex")}.json`;
}

export function createCache(dir: string = DEFAULT_CACHE_DIR): ResponseCache {
  const fileFor = (key: string) => path.join(dir, cacheFileName(key));

  return {
    dir,
    fileFor,

    async get<T>(key: string, maxAgeMs: number) {
      let raw: string;
      try {
        raw = await readFile(fileFor(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      let entry: CacheEntry<T>;
      try {
        entry = JSON.parse(raw) as CacheEntry<T>;
      } catch {
        return undefined; // corrupt entry: treat as a miss
      }
      if (entry.cacheKey !== key) return undefined;
      const age = Date.now() - Date.parse(entry.fetchedAt);
      if (!(age <= maxAgeMs)) return undefined;
      return entry;
    },

    async set(key, entry) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify({ ...entry, cacheKey: key }));
      await rename(tmp, file); // atomic: an interrupted run never leaves a half-written entry
    },
  };
}
