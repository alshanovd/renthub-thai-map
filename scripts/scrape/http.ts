/**
 * Polite HTTP layer for renthub: a global limiter (concurrency + jittered gap between request
 * starts) and retries on network errors, 408, 429 and 5xx.
 */

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const MAX_WAIT_MS = 60_000;

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodySnippet: string;

  constructor(status: number, url: string, bodySnippet: string, cause?: unknown) {
    super(
      `HTTP ${status === 0 ? "network error" : status} for ${url}${bodySnippet ? `: ${bodySnippet}` : ""}`,
      {
        cause,
      },
    );
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export interface LimiterOptions {
  concurrency?: number;
  /** Random gap between consecutive request starts, in ms. */
  minGapMs?: number;
  maxGapMs?: number;
  sleep?: Sleep;
  random?: () => number;
}

/** At most `concurrency` tasks at once, with a random gap between task starts. */
export function createLimiter(options: LimiterOptions = {}): Limiter {
  const {
    concurrency = 2,
    minGapMs = 250,
    maxGapMs = 450,
    sleep = defaultSleep,
    random = Math.random,
  } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`concurrency must be a positive integer, got ${concurrency}`);
  }

  let active = 0;
  const waiting: Array<() => void> = [];
  let nextStartAt = 0;
  let gate: Promise<void> = Promise.resolve();

  const acquire = async () => {
    if (active < concurrency) {
      active++;
    } else {
      // The releasing task hands its slot over directly (active stays the same).
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    // Serialize starts so consecutive requests are spaced by a random gap.
    const myTurn = gate.then(async () => {
      const wait = nextStartAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextStartAt = Date.now() + minGapMs + random() * (maxGapMs - minGapMs);
    });
    gate = myTurn;
    await myTurn;
  };

  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

export interface FetchOptions {
  limiter?: Limiter;
  /** Total attempts, including the first one. */
  maxAttempts?: number;
  sleep?: Sleep;
  random?: () => number;
  headers?: Record<string, string>;
}

export interface FetchResult<T> {
  status: number;
  /** Final URL after redirects. */
  url: string;
  body: T;
}

const isRetryable = (status: number) =>
  status === 0 || status === 408 || status === 429 || status >= 500;

/** Parses `Retry-After` (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

const defaultLimiter = createLimiter();

async function request(
  url: string,
  accept: string,
  options: FetchOptions,
): Promise<FetchResult<string>> {
  const {
    limiter = defaultLimiter,
    maxAttempts = 3,
    sleep = defaultSleep,
    random = Math.random,
    headers = {},
  } = options;

  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let body = "";
    let retryAfterMs: number | undefined;
    let cause: unknown;
    try {
      const { res, text } = await limiter.run(async () => {
        const response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "en",
            Accept: accept,
            ...headers,
          },
        });
        return { res: response, text: await response.text() };
      });
      status = res.status;
      body = text;
      if (res.ok) return { status, url: res.url || url, body };
      if (status === 429) retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    } catch (error) {
      status = 0;
      cause = error;
    }

    if (!isRetryable(status) || attempt >= maxAttempts) {
      throw new HttpError(status, url, body.slice(0, 300), cause);
    }
    const backoff = retryAfterMs ?? 2000 * attempt + random() * 1000;
    await sleep(Math.min(backoff, MAX_WAIT_MS));
  }
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<string>> {
  return request(url, "text/html", options);
}

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const res = await request(url, "application/json", options);
  try {
    return { ...res, body: JSON.parse(res.body) as T };
  } catch (error) {
    throw new HttpError(res.status, url, `invalid JSON: ${res.body.slice(0, 280)}`, error);
  }
}
