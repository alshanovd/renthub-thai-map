/**
 * Client side of the data API (`/api/pins`, `/api/listings`, `/api/listings/no-location`).
 * Client-safe: no DB imports. Every fetch takes an `AbortSignal` (TanStack Query's).
 */
import type { Search } from "@/lib/listings/filter";
import { bboxToParam, MAX_CARD_IDS, searchToParams } from "@/lib/listings/api-params";
import type {
  ListingCard,
  ListingCardsResponse,
  NoLocationResponse,
  Pin,
  PinsData,
  PinsResponse,
} from "@/lib/listings/types";
import type { Bounds } from "@/lib/store";

/** A non-2xx API response. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`${url} → ${String(status)}`);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson<T>(url: string, signal?: AbortSignal, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new ApiError(response.status, url);
  return (await response.json()) as T;
}

/** The query string of a search plus extra params, e.g. `mode=day&max=800&call=0&sort=…&bbox=…`. */
function searchQuery(search: Search, extra: Record<string, string> = {}): string {
  const params = searchToParams(search);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

/** `/api/pins` URL for an (already snapped) bbox and a search. */
export function pinsUrl(bbox: Bounds, search: Search): string {
  return `/api/pins?${searchQuery(search, { bbox: bboxToParam(bbox) })}`;
}

/** Pins of an (already snapped) bbox, decoded from the compact tuples. */
export async function fetchPins(
  { bbox, search }: { bbox: Bounds; search: Search },
  signal?: AbortSignal,
): Promise<PinsData> {
  const body = await getJson<PinsResponse>(pinsUrl(bbox, search), signal);
  return {
    lastScrapeAt: body.lastScrapeAt,
    total: body.total,
    noLocationTotal: body.noLocationTotal,
    pins: body.pins.map(([id, lat, lng, price, kind]): Pin => ({
      id,
      lat,
      lng,
      price,
      kind: kind === 1 ? "call" : "amount",
    })),
  };
}

/** One page of filtered listings without coordinates (`cursor` null = first page). */
export function fetchNoLocationPage(
  { search, cursor }: { search: Search; cursor: string | null },
  signal?: AbortSignal,
): Promise<NoLocationResponse> {
  const query = searchQuery(search, cursor === null ? {} : { cursor });
  return getJson<NoLocationResponse>(`/api/listings/no-location?${query}`, signal);
}

/** Collects ids for this long before sending one request (lets a whole render's cards batch). */
export const CARD_BATCH_MS = 16;

type Waiter = {
  resolve: (card: ListingCard | null) => void;
  reject: (error: unknown) => void;
};

/** A sent `/api/listings?ids=` request; aborted once none of its ids has a waiter left. */
type Batch = { controller: AbortController; ids: readonly string[] };

/** Per-id state: who waits for it, and the batch it was sent in (null while queued). */
type Entry = { waiters: Set<Waiter>; batch: Batch | null };

export type CardLoader = {
  /** Card data by id (null for an unknown id). Batched, deduped, abortable per caller. */
  loadCard: (id: string, signal?: AbortSignal) => Promise<ListingCard | null>;
};

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

/**
 * A batching card loader. Ids requested within `delayMs` are sent together as
 * `/api/listings?ids=` requests of at most `MAX_CARD_IDS` ids. An id that is already queued or in
 * flight is not requested again. Ids missing from the response resolve to `null`.
 *
 * Each caller may pass an `AbortSignal`: aborting rejects only that caller's promise. A request
 * is aborted when none of its ids is still awaited (e.g. every card of the batch unmounted).
 */
export function createCardLoader({
  fetchImpl = (input, init) => fetch(input, init),
  delayMs = CARD_BATCH_MS,
}: { fetchImpl?: FetchLike; delayMs?: number } = {}): CardLoader {
  const entries = new Map<string, Entry>();
  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const settle = (batch: Batch, id: string, settleWaiter: (waiter: Waiter) => void) => {
    const entry = entries.get(id);
    if (!entry || entry.batch !== batch) return;
    entries.delete(id);
    for (const waiter of entry.waiters) settleWaiter(waiter);
  };

  const send = async (ids: readonly string[]) => {
    const batch: Batch = { controller: new AbortController(), ids };
    for (const id of ids) {
      const entry = entries.get(id);
      if (entry) entry.batch = batch;
    }
    try {
      const body = await getJson<ListingCardsResponse>(
        `/api/listings?ids=${ids.map(encodeURIComponent).join(",")}`,
        batch.controller.signal,
        fetchImpl,
      );
      const byId = new Map(body.listings.map((card) => [card.id, card]));
      for (const id of ids) settle(batch, id, (waiter) => waiter.resolve(byId.get(id) ?? null));
    } catch (error) {
      for (const id of ids) settle(batch, id, (waiter) => waiter.reject(error));
    }
  };

  const flush = () => {
    timer = null;
    const ids = queue.filter((id) => entries.get(id)?.batch === null);
    queue = [];
    for (let start = 0; start < ids.length; start += MAX_CARD_IDS) {
      void send(ids.slice(start, start + MAX_CARD_IDS));
    }
  };

  /** Drops a waiter; cancels the queued id or the whole request when nobody waits anymore. */
  const release = (id: string, waiter: Waiter) => {
    const entry = entries.get(id);
    if (!entry?.waiters.delete(waiter) || entry.waiters.size > 0) return;
    const { batch } = entry;
    if (batch === null) {
      entries.delete(id);
      return;
    }
    const stillAwaited = batch.ids.some((other) => {
      const otherEntry = entries.get(other);
      return otherEntry?.batch === batch && otherEntry.waiters.size > 0;
    });
    if (stillAwaited) return;
    // Nobody needs this request anymore: forget its ids (so new callers re-request) and abort.
    for (const other of batch.ids) if (entries.get(other)?.batch === batch) entries.delete(other);
    batch.controller.abort();
  };

  const loadCard = (id: string, signal?: AbortSignal): Promise<ListingCard | null> => {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (card) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(card);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      function onAbort() {
        release(id, waiter);
        reject(abortReason(signal as AbortSignal));
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      const entry = entries.get(id);
      if (entry) {
        entry.waiters.add(waiter);
        return;
      }
      entries.set(id, { waiters: new Set([waiter]), batch: null });
      queue.push(id);
      timer ??= setTimeout(flush, delayMs);
    });
  };

  return { loadCard };
}

/** The app-wide card loader. */
export const { loadCard } = createCardLoader();
