import { afterEach, describe, expect, it, vi } from "vitest";

import { createLimiter, fetchJson, fetchText, HttpError, parseRetryAfter } from "./http";

const noSleep = vi.fn(async (_ms: number) => {});
const fastLimiter = () => createLimiter({ concurrency: 2, minGapMs: 0, maxGapMs: 0 });

afterEach(() => {
  vi.unstubAllGlobals();
  noSleep.mockClear();
});

const response = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("fetchJson retries", () => {
  it("retries on 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503, "busy"))
      .mockResolvedValueOnce(response(200, '{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchJson("https://x.test/a.json", {
      limiter: fastLimiter(),
      sleep: noSleep,
    });

    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
    const wait = noSleep.mock.calls[0]?.[0] ?? 0;
    expect(wait).toBeGreaterThanOrEqual(2000);
    expect(wait).toBeLessThanOrEqual(3000);
  });

  it("gives up after 3 attempts with an HttpError", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response(503, "x".repeat(1000)));
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchJson("https://x.test/a.json", {
      limiter: fastLimiter(),
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as HttpError).url).toBe("https://x.test/a.json");
    expect((error as HttpError).bodySnippet).toHaveLength(300);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404, "nope"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJson("https://x.test/a.json", { limiter: fastLimiter(), sleep: noSleep }),
    ).rejects.toMatchObject({ name: "HttpError", status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries network errors as status 0", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(response(200, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchText("https://x.test/", { limiter: fastLimiter(), sleep: noSleep });
    expect(res.body).toBe("<html></html>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After on 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, "", { "Retry-After": "7" }))
      .mockResolvedValueOnce(response(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJson("https://x.test/a.json", { limiter: fastLimiter(), sleep: noSleep });
    expect(noSleep).toHaveBeenCalledWith(7000);
  });

  it("sends the expected headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJson("https://x.test/a.json", { limiter: fastLimiter(), sleep: noSleep });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers["Accept-Language"]).toBe("en");
    expect(headers["User-Agent"]).toMatch(/Chrome\//);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
  });
});

describe("createLimiter", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const limiter = createLimiter({ concurrency: 2, minGapMs: 0, maxGapMs: 0 });
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(2);
  });

  it("spaces request starts by the configured gap", async () => {
    const limiter = createLimiter({ concurrency: 5, minGapMs: 30, maxGapMs: 30 });
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 3 }, () => limiter.run(async () => void starts.push(Date.now()))),
    );
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(25);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(25);
  });
});
