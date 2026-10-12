/**
 * Memory measurement harness (`pnpm perf:measure`).
 *
 * Drives the installed Google Chrome (playwright-core, `channel: "chrome"`, nothing downloaded)
 * through a fixed scenario (pan/zoom the map, scroll the list, hover pins, step carousels, use
 * the viewer), forces GC, then reports memory, DOM and network metrics. Prints the median of
 * all runs as a table and as JSON.
 *
 *   pnpm perf:measure [--url http://localhost:3000] [--runs 3] [--json out.json] [--headed]
 *
 * Measure a production build (`pnpm build && pnpm start`) or the deployed site, never `pnpm dev`.
 * Stable DOM hooks: `[data-pin-id]` (pins), `[data-list-scroller]` (list scroll container),
 * `[data-listing-id]` (cards), `[data-viewer-opener]` (card photo), `.gm-style` (Google map).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { type CDPSession, chromium, type Page } from "playwright-core";

const VIEWPORT = { width: 1512, height: 794 };

type Metrics = {
  jsHeapUsedMB: number;
  domNodes: number;
  domElements: number;
  jsEventListeners: number;
  imgElements: number;
  advancedMarkers: number;
  pinElements: number;
  listingCards: number;
  decodedRenthubMB: number;
  decodedOtherMB: number;
  transferApiKB: number;
  transferNextKB: number;
  transferDocumentKB: number;
  transferGoogleKB: number;
  transferRenthubKB: number;
  transferOtherKB: number;
  processRssMB: number;
  processCount: number;
};

type RunResult = Metrics & { notes: string[] };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const round = (value: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Tracks in-flight requests so the scenario can wait for "network idle for N ms". */
function trackNetwork(page: Page) {
  let inflight = 0;
  let lastActivity = Date.now();
  const bump = () => {
    lastActivity = Date.now();
  };
  page.on("request", () => {
    inflight += 1;
    bump();
  });
  const done = () => {
    inflight = Math.max(0, inflight - 1);
    bump();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return async function waitForIdle(quietMs: number, maxMs = 20_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (inflight === 0 && Date.now() - lastActivity >= quietMs) return true;
      await sleep(100);
    }
    return false;
  };
}

type Category = "api" | "next" | "document" | "google" | "renthub" | "other";

function categorize(url: string, origin: string): Category {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  if (parsed.origin === origin) {
    if (parsed.pathname.startsWith("/api/")) return "api";
    if (parsed.pathname.startsWith("/_next/")) return "next";
    return "document";
  }
  const host = parsed.hostname;
  if (host === "bcdn.renthub.in.th") return "renthub";
  if (/(^|\.)(googleapis\.com|gstatic\.com|google\.com|ggpht\.com)$/.test(host)) return "google";
  return "other";
}

/** Sums encoded (on-the-wire) bytes per category from CDP Network events. */
async function trackTransfer(cdp: CDPSession, origin: string) {
  const urls = new Map<string, string>();
  const bytes: Record<Category, number> = {
    api: 0,
    next: 0,
    document: 0,
    google: 0,
    renthub: 0,
    other: 0,
  };
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (event) => {
    urls.set(event.requestId, event.request.url);
  });
  cdp.on("Network.loadingFinished", (event) => {
    const url = urls.get(event.requestId);
    if (url) bytes[categorize(url, origin)] += event.encodedDataLength;
  });
  return bytes;
}

/** RSS (KB) of `rootPid` and all its descendants, via `ps`. */
function processTreeRss(rootPid: number): { rssKB: number; count: number } {
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" });
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const line of out.split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    rss.set(pid, Number.isFinite(kb) ? kb : 0);
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  let total = 0;
  let count = 0;
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    total += rss.get(pid) ?? 0;
    count += 1;
    stack.push(...(children.get(pid) ?? []));
  }
  return { rssKB: total, count };
}

async function mapBox(page: Page) {
  const box = await page.locator(".gm-style").first().boundingBox();
  if (!box) throw new Error("Google map (.gm-style) not found");
  return box;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await sleep(16);
  }
  await page.mouse.up();
}

/** The list's scroll container: `[data-list-scroller]`, else the scrollable ancestor of a card. */
async function scrollList(page: Page, step: number, delayMs: number): Promise<number> {
  const handle = await page.evaluateHandle(() => {
    // No named helpers in here: tsx would wrap them in `__name`, which the page lacks.
    const marked = [...document.querySelectorAll<HTMLElement>("[data-list-scroller]")].find(
      (el) => el.offsetParent !== null,
    );
    if (marked) return marked as HTMLElement;
    let el = document.querySelector("[data-listing-id]")?.parentElement ?? null;
    while (el) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) throw new Error("List scroll container not found");
  let steps = 0;
  for (; steps < 1000; steps += 1) {
    const moved = await el.evaluate((node, by) => {
      const before = node.scrollTop;
      node.scrollTop = before + by;
      return node.scrollTop !== before;
    }, step);
    await sleep(delayMs);
    if (!moved) break;
  }
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await handle.dispose();
  return steps;
}

/** Centers of up to `count` distinct pins that lie fully inside the map's box. */
async function pinTargets(page: Page, count: number) {
  const box = await mapBox(page);
  return page.evaluate(
    ({ area, limit }) => {
      const out: { id: string; x: number; y: number }[] = [];
      const seen = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("[data-pin-id]")) {
        const id = el.dataset.pinId ?? "";
        if (seen.has(id)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const margin = 80;
        if (x < area.x + margin || x > area.x + area.width - margin) continue;
        if (y < area.y + margin || y > area.y + area.height - margin) continue;
        // Skip pins covered by something else (another pin, a cluster, controls).
        const top = document.elementFromPoint(x, y);
        if (!top || !el.contains(top)) continue;
        seen.add(id);
        out.push({ id, x, y });
        if (out.length >= limit) break;
      }
      return out;
    },
    { area: box, limit: count },
  );
}

async function collectMetrics(page: Page, cdp: CDPSession) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  const dom = await page.evaluate(() => {
    let renthub = 0;
    let other = 0;
    for (const img of document.images) {
      if (!img.complete || img.naturalWidth === 0) continue;
      const bytes = img.naturalWidth * img.naturalHeight * 4;
      if (img.currentSrc.includes("bcdn.renthub.in.th")) renthub += bytes;
      else other += bytes;
    }
    return {
      elements: document.querySelectorAll("*").length,
      img: document.images.length,
      markers: document.querySelectorAll("gmp-advanced-marker").length,
      pins: document.querySelectorAll("[data-pin-id]").length,
      cards: document.querySelectorAll("[data-listing-id]").length,
      renthub,
      other,
    };
  });
  return {
    jsHeapUsedMB: metric("JSHeapUsedSize") / 2 ** 20,
    domNodes: metric("Nodes"),
    domElements: dom.elements,
    jsEventListeners: metric("JSEventListeners"),
    imgElements: dom.img,
    advancedMarkers: dom.markers,
    pinElements: dom.pins,
    listingCards: dom.cards,
    decodedRenthubMB: dom.renthub / 2 ** 20,
    decodedOtherMB: dom.other / 2 ** 20,
  };
}

async function runOnce(url: string, headed: boolean, run: number): Promise<RunResult> {
  const notes: string[] = [];
  const server = await chromium.launchServer({ channel: "chrome", headless: !headed });
  const rootPid = server.process().pid;
  if (rootPid === undefined) throw new Error("Chrome did not start");
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const origin = new URL(url).origin;
    const transfer = await trackTransfer(cdp, origin);
    const waitForIdle = trackNetwork(page);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 200));
    });
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
    const log = (message: string) => console.error(`[run ${String(run)}] ${message}`);

    // 1. Load, wait for pins and 2 s of network quiet.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // At least one pin actually drawn (some markers exist but are hidden by clustering).
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-pin-id]")].some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      undefined,
      { timeout: 60_000 },
    );
    if (!(await waitForIdle(2000))) notes.push("load: network never idle for 2 s");
    const render = await page.evaluate(() => ({
      webgl: document.createElement("canvas").getContext("webgl2") !== null,
      canvases: document.querySelectorAll(".gm-style canvas").length,
      tileImgs: document.querySelectorAll(".gm-style img[src*='google']").length,
    }));
    notes.push(
      `map: webgl2=${String(render.webgl)}, ${String(render.canvases)} canvas, ${String(render.tileImgs)} google <img>`,
    );
    log("loaded");

    // 2. Pan 4 times (right, down, left, up), then zoom in twice and out twice.
    const box = await mapBox(page);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (const [dx, dy] of [
      [300, 0],
      [0, 300],
      [-300, 0],
      [0, -300],
    ] as const) {
      await drag(page, { x: center.x - dx / 2, y: center.y - dy / 2 }, dx, dy);
      await waitForIdle(1000, 10_000);
    }
    await page.mouse.move(center.x, center.y);
    for (const deltaY of [-120, -120, 120, 120]) {
      await page.mouse.wheel(0, deltaY);
      await sleep(600);
      await waitForIdle(1000, 10_000);
    }
    log("panned and zoomed");

    // 3. Scroll the list top → bottom in 600 px steps, then back to the top.
    const steps = await scrollList(page, 600, 150);
    await waitForIdle(1000, 10_000);
    log(`scrolled list (${String(steps)} steps)`);

    // 4. Hover 5 pins for 400 ms each.
    const pins = await pinTargets(page, 5);
    if (pins.length < 5) notes.push(`hovered only ${String(pins.length)} pins`);
    for (const pin of pins) {
      await page.mouse.move(pin.x, pin.y, { steps: 4 });
      await sleep(400);
    }
    await page.mouse.move(center.x, box.y + box.height - 10);
    await waitForIdle(1000, 10_000);
    log(`hovered ${String(pins.length)} pins`);

    // 5. Next-photo arrows of 3 cards, twice each.
    const cards = page.locator("[data-listing-id]").filter({
      has: page.locator('button[aria-label="Next photo"]'),
    });
    const cardCount = Math.min(3, await cards.count());
    if (cardCount < 3) notes.push(`only ${String(cardCount)} cards with photo arrows`);
    for (let i = 0; i < cardCount; i += 1) {
      const next = cards.nth(i).locator('button[aria-label="Next photo"]');
      await next.click();
      await sleep(150);
      await next.click();
      await sleep(150);
    }
    await waitForIdle(1000, 10_000);
    log(`stepped ${String(cardCount)} carousels`);

    // 6. Viewer: open from a card, ArrowRight ×5, Escape.
    const opener = page.locator("[data-viewer-opener]").first();
    await opener.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("ArrowRight");
      await sleep(300);
    }
    await page.keyboard.press("Escape");
    log("used the viewer");

    // 7. Settle, force GC, measure.
    await sleep(3000);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(500);

    if (errors.length > 0) notes.push(`console errors: ${errors.join(" | ")}`);
    const dom = await collectMetrics(page, cdp);
    const { rssKB, count } = processTreeRss(rootPid);
    await browser.close();
    return {
      ...dom,
      transferApiKB: transfer.api / 1024,
      transferNextKB: transfer.next / 1024,
      transferDocumentKB: transfer.document / 1024,
      transferGoogleKB: transfer.google / 1024,
      transferRenthubKB: transfer.renthub / 1024,
      transferOtherKB: transfer.other / 1024,
      processRssMB: rssKB / 1024,
      processCount: count,
      notes,
    };
  } finally {
    await server.close();
  }
}

const LABELS: Record<keyof Metrics, string> = {
  jsHeapUsedMB: "JS heap used (MB)",
  domNodes: "DOM nodes (CDP, incl. detached)",
  domElements: "elements in document",
  jsEventListeners: "JS event listeners",
  imgElements: "<img> elements",
  advancedMarkers: "gmp-advanced-marker",
  pinElements: "[data-pin-id] pins",
  listingCards: "listing cards",
  decodedRenthubMB: "decoded renthub imgs (MB)",
  decodedOtherMB: "decoded other imgs (MB)",
  transferApiKB: "transfer: API (KB)",
  transferNextKB: "transfer: _next (KB)",
  transferDocumentKB: "transfer: document (KB)",
  transferGoogleKB: "transfer: Google (KB)",
  transferRenthubKB: "transfer: renthub CDN (KB)",
  transferOtherKB: "transfer: other (KB)",
  processRssMB: "browser process tree RSS (MB)",
  processCount: "browser processes",
};

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:3000" },
      runs: { type: "string", default: "3" },
      json: { type: "string" },
      headed: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(
      "pnpm perf:measure [--url http://localhost:3000] [--runs 3] [--json out.json] [--headed]",
    );
    return;
  }
  const runs = Math.max(1, Number.parseInt(values.runs, 10) || 3);
  const results: RunResult[] = [];
  for (let run = 1; run <= runs; run += 1) {
    results.push(await runOnce(values.url, values.headed, run));
  }

  const keys = Object.keys(LABELS) as (keyof Metrics)[];
  const medianMetrics = Object.fromEntries(
    keys.map((key) => [key, round(median(results.map((r) => r[key])))]),
  ) as Metrics;

  const width = Math.max(...keys.map((k) => LABELS[k].length));
  const lines = [
    `| ${"metric".padEnd(width)} | median | ${results.map((_, i) => `run ${String(i + 1)}`).join(" | ")} |`,
    `|${"-".repeat(width + 2)}|-------:|${results.map(() => "------:").join("|")}|`,
    ...keys.map(
      (key) =>
        `| ${LABELS[key].padEnd(width)} | ${String(medianMetrics[key]).padStart(6)} | ${results
          .map((r) => String(round(r[key])).padStart(6))
          .join(" | ")} |`,
    ),
  ];
  const summary = {
    url: values.url,
    runs,
    headless: !values.headed,
    viewport: { ...VIEWPORT, deviceScaleFactor: 2 },
    measuredAt: new Date().toISOString(),
    median: medianMetrics,
    perRun: results,
  };
  console.log(lines.join("\n"));
  console.log(JSON.stringify(summary, null, 2));
  if (values.json) {
    mkdirSync(dirname(values.json), { recursive: true });
    writeFileSync(values.json, `${JSON.stringify(summary, null, 2)}\n`);
  }
}

await main();
