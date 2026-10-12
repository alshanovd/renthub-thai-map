/**
 * renthub client: Next.js data routes (`/_next/data/<buildId>/...json`) with an on-disk cache,
 * build-ID refresh on 404 and an HTML `__NEXT_DATA__` fallback. Returns raw, unvalidated
 * `pageProps` (zod validation happens in the parsing step).
 */
import { createCache, type ResponseCache } from "./cache";
import {
  createLimiter,
  fetchJson,
  fetchText,
  HttpError,
  type FetchOptions,
  type Limiter,
  type Sleep,
} from "./http";
import type { Search } from "./searches";

export const BASE_URL = "https://www.renthub.in.th";

export type PageProps = Record<string, unknown>;

export interface Fetched {
  pageProps: PageProps;
  fromCache: boolean;
  /** The URL the data came from (data route, HTML page, or the cached entry's URL). */
  url: string;
  /** ISO time the data was fetched from renthub (the cache entry's time for cache hits). */
  fetchedAt?: string;
}

export interface SearchPage extends Fetched {
  page: number;
  listings: Array<{ id: string; slug: string }>;
  totalPages: number;
  totalCount: number;
}

/** No usable data in the cache while running `--offline`. */
export class OfflineCacheMissError extends Error {
  constructor(readonly cacheKey: string) {
    super(`offline: no cached response for ${cacheKey}`);
    this.name = "OfflineCacheMissError";
  }
}

/** A search page that should have listings came back empty. */
export class EmptyResultError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`empty search result at ${url}: ${reason}`);
    this.name = "EmptyResultError";
  }
}

/** renthub redirected instead of returning the page (typically a removed listing). */
export class ListingGoneError extends Error {
  constructor(
    readonly url: string,
    readonly redirect: string,
  ) {
    super(`${url} redirects to ${redirect} (listing removed?)`);
    this.name = "ListingGoneError";
  }
}

const BUILD_ID_RE = /"buildId"\s*:\s*"([^"]+)"/;
const NEXT_DATA_RE = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

export function extractBuildId(html: string): string {
  const match = BUILD_ID_RE.exec(html);
  if (!match?.[1]) throw new Error("buildId not found in renthub HTML");
  return match[1];
}

/** Returns `props.pageProps` from the page's `<script id="__NEXT_DATA__">`. */
export function extractNextDataPageProps(html: string): PageProps {
  const match = NEXT_DATA_RE.exec(html);
  if (!match?.[1]) throw new Error("__NEXT_DATA__ script not found");
  const data = JSON.parse(match[1]) as { props?: { pageProps?: unknown } };
  const pageProps = data.props?.pageProps;
  if (!isRecord(pageProps)) throw new Error("__NEXT_DATA__ has no props.pageProps");
  return pageProps;
}

/** Removes every `contactInformation` key (owners' personal data is never stored). */
export function stripContactInformation<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripContactInformation) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "contactInformation") out[key] = stripContactInformation(child);
  }
  return out as T;
}

export function searchCacheKey(search: Search, page: number): string {
  return `search/${search.key}/${search.zone}/page-${page}`;
}

export function listingCacheKey(slug: string): string {
  return `listing/${slug}`;
}

/** Light structural read of a search page; full validation happens later with zod. */
export function readSearchPage(pageProps: PageProps, url: string) {
  const { listings, pagination } = pageProps;
  if (!Array.isArray(listings)) throw new Error(`${url}: pageProps.listings is not an array`);
  if (!isRecord(pagination)) throw new Error(`${url}: pageProps.pagination is missing`);
  const totalPages = Number(pagination.totalPages);
  const totalCount = Number(pagination.totalCount);
  return {
    listings: listings.map((item: unknown, index) => {
      if (!isRecord(item) || item.id == null || typeof item.slug !== "string") {
        throw new Error(`${url}: listing #${index} has no id/slug`);
      }
      return { id: String(item.id), slug: item.slug };
    }),
    totalPages: Number.isFinite(totalPages) ? totalPages : 0,
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
  };
}

/** Throws unless a search page has listings when it should (never a silent `[]`). */
export function assertSearchPageNotEmpty(page: number, pageProps: PageProps, url: string): void {
  const { listings, totalPages } = readSearchPage(pageProps, url);
  if (listings.length > 0) return;
  if (page === 1) throw new EmptyResultError(url, "page 1 returned 0 listings");
  if (page <= totalPages) {
    throw new EmptyResultError(url, `page ${page} of ${totalPages} returned 0 listings`);
  }
}

export interface RenthubStats {
  networkRequests: number;
  cacheHits: number;
  buildIdRefreshes: number;
  htmlFallbacks: number;
}

export interface RenthubClientOptions {
  cache?: ResponseCache;
  /** Reuse cached responses younger than this. */
  maxAgeMs?: number;
  /** Cache only; never touch the network. */
  offline?: boolean;
  limiter?: Limiter;
  concurrency?: number;
  sleep?: Sleep;
  log?: (line: string) => void;
}

export function createRenthubClient(options: RenthubClientOptions = {}) {
  const {
    cache = createCache(),
    maxAgeMs = 12 * 60 * 60 * 1000,
    offline = false,
    sleep,
    log = () => {},
  } = options;
  const limiter = options.limiter ?? createLimiter({ concurrency: options.concurrency, sleep });
  const fetchOptions: FetchOptions = { limiter, sleep };
  const stats: RenthubStats = {
    networkRequests: 0,
    cacheHits: 0,
    buildIdRefreshes: 0,
    htmlFallbacks: 0,
  };

  const getJson = (url: string) => {
    stats.networkRequests++;
    return fetchJson<unknown>(url, fetchOptions);
  };
  const getText = (url: string) => {
    stats.networkRequests++;
    return fetchText(url, fetchOptions);
  };

  let buildId: Promise<string> | undefined;
  let refreshing: Promise<string> | undefined;

  const loadBuildId = async () => {
    if (offline) throw new Error("offline: cannot fetch the renthub build ID");
    const { body } = await getText(`${BASE_URL}/en`);
    return extractBuildId(body);
  };

  async function getBuildId(): Promise<string> {
    buildId ??= loadBuildId();
    try {
      return await buildId;
    } catch (error) {
      buildId = undefined;
      throw error;
    }
  }

  /** Re-reads the build ID. Concurrent callers holding the same stale ID share one request. */
  async function refreshBuildId(stale?: string): Promise<string> {
    if (stale !== undefined && buildId) {
      const current = await buildId.catch(() => undefined);
      if (current && current !== stale) return current;
    }
    refreshing ??= (async () => {
      stats.buildIdRefreshes++;
      buildId = loadBuildId();
      try {
        const fresh = await buildId;
        log(`[scrape] build id refreshed: ${fresh}`);
        return fresh;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  async function fetchDataRoute(path: string, query: string): Promise<Fetched> {
    const once = async (id: string): Promise<Fetched> => {
      const url = dataUrl(id, path, query);
      const { body } = await getJson(url);
      if (!isRecord(body)) throw new Error(`${url}: response is not an object`);
      if (body.notFound === true) throw new ListingGoneError(url, "notFound");
      const pageProps = body.pageProps;
      if (!isRecord(pageProps)) throw new Error(`${url}: response has no pageProps`);
      const redirect = pageProps["__N_REDIRECT"];
      if (typeof redirect === "string") {
        throw new ListingGoneError(url, redirect);
      }
      return { pageProps, fromCache: false, url };
    };

    const id = await getBuildId();
    try {
      return await once(id);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
      const fresh = await refreshBuildId(id);
      if (fresh === id) throw error;
      return once(fresh);
    }
  }

  async function fetchHtmlPage(path: string, search: string): Promise<Fetched> {
    stats.htmlFallbacks++;
    const url = `${BASE_URL}/en/${path}${search ? `?${search}` : ""}`;
    const res = await getText(url);
    const finalPath = new URL(res.url || url).pathname;
    const wantedPath = new URL(url).pathname;
    if (decodeURIComponent(finalPath) !== decodeURIComponent(wantedPath)) {
      throw new ListingGoneError(url, finalPath);
    }
    return { pageProps: extractNextDataPageProps(res.body), fromCache: false, url };
  }

  async function obtain(
    cacheKey: string,
    path: string,
    dataQuery: string,
    htmlQuery: string,
    validate: (pageProps: PageProps, url: string) => void = () => {},
  ): Promise<Fetched> {
    const cached = await cache.get<PageProps>(cacheKey, offline ? Infinity : maxAgeMs);
    if (cached) {
      stats.cacheHits++;
      return {
        pageProps: cached.body,
        fromCache: true,
        url: cached.url,
        fetchedAt: cached.fetchedAt,
      };
    }
    if (offline) throw new OfflineCacheMissError(cacheKey);

    let fetched: Fetched;
    try {
      fetched = await fetchDataRoute(path, dataQuery);
    } catch (error) {
      if (error instanceof ListingGoneError) throw error;
      log(`[scrape] data route failed for ${cacheKey} (${errorMessage(error)}); trying HTML`);
      fetched = await fetchHtmlPage(path, htmlQuery);
    }

    const pageProps = stripContactInformation(fetched.pageProps);
    validate(pageProps, fetched.url);
    const fetchedAt = new Date().toISOString();
    await cache.set(cacheKey, { url: fetched.url, fetchedAt, status: 200, body: pageProps });
    return { ...fetched, pageProps, fetchedAt };
  }

  async function getSearchPage(search: Search, page: number): Promise<SearchPage> {
    const path = `${search.rentalPath}/${search.zone}`;
    const fetched = await obtain(
      searchCacheKey(search, page),
      path,
      `id=${encodeURIComponent(search.zone)}&page=${page}`,
      `page=${page}`,
      (pageProps, url) => assertSearchPageNotEmpty(page, pageProps, url),
    );
    return { ...fetched, page, ...readSearchPage(fetched.pageProps, fetched.url) };
  }

  async function getListingDetail(slug: string): Promise<Fetched> {
    const encoded = encodeURIComponent(slug);
    return obtain(listingCacheKey(slug), encoded, `id=${encoded}`, "", (pageProps, url) => {
      if (!isRecord(pageProps.listing)) throw new Error(`${url}: pageProps.listing is missing`);
    });
  }

  return { getBuildId, refreshBuildId, getSearchPage, getListingDetail, stats };
}

export type RenthubClient = ReturnType<typeof createRenthubClient>;

const dataUrl = (id: string, path: string, query: string) =>
  `${BASE_URL}/_next/data/${id}/en/${path}.json?${query}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
