#!/usr/bin/env node
/* Captures /media on the test stack, once per PR A state, at 1440x900 and 390x844, and prints the numeric checks as one
 * JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/media-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml) and Playwright >= 1.45 (page.clock), which is not a dependency of this
 * repo; run it where one is installed. /api/media/library, /api/media/title and /api/media/scan are answered from
 * scripts/fixtures/media/fixtures.mjs (placeholders only), except live-normal, which reads the real fixture worker.
 * The clock is pinned to the fixtures' NOW and the zone to Australia/Sydney.
 *
 * Checks (shape brief section 8): C1 clipped text, C2 answer lines, C3 tap targets, C4 hash round trip and ids, C5 reduced
 * motion, C6 page errors and foreign requests, C7 calm paint, C9 row counts, C10 no host or raw error, C11 sticky pane,
 * C12 columns, C13 wrapping, C14 fetches, C16 scale, C18 writes in stale and worker-down, C20 live.
 * Captures: loading, unconfigured, token-rejected, worker-down, first-scan, scanning-with-data, scan-failed, empty, normal,
 * title-open-movie, title-open-show, file-row-verdicts, stale, nothing-to-compress, filter-save, detail-failed,
 * worker-down-with-data, long-values, scale-130, live-normal.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, NOW, OPEN } from "./fixtures/media/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
// [capture name, fixture, chip label (null: not checked), strip to open (null: none)]
const STATES = [
  ["loading", "loading", "Checking", null],
  ["unconfigured", "unconfigured", "Not connected", null],
  ["token-rejected", "tokenRejected", "Token rejected", null],
  ["worker-down", "workerDown", "Worker down", null],
  ["first-scan", "firstScan", "Scanning", null],
  ["scanning-with-data", "scanning", null, null],
  ["scan-failed", "scanFailed", null, null],
  ["empty", "empty", null, null],
  ["normal", "normal", null, null],
  ["title-open-movie", "normal", null, OPEN.movie],
  ["title-open-show", "normal", null, OPEN.show],
  ["file-row-verdicts", "normal", null, OPEN.verdicts],
  ["nothing-to-compress", "nothingToCompress", null, null],
  ["detail-failed", "detailFailed", null, OPEN.movie],
  ["long-values", "longValues", null, OPEN.long],
  ["scale-130", "scale130", null, null],
];
const WRITE_STATES = new Set(["stale", "worker-down", "worker-down-with-data"]);

const results = {};
const diag = {};
const pageErrors = [];
const foreignRequests = [];
const record = (key, where, value) => ((results[key] ??= {})[where] = value);
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function watch(page, name) {
  page.consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && page.consoleErrors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreignRequests.push(`${name}: ${new URL(u).origin}`);
  });
}

/** Opens /media with the fixture's answers; `live` skips the mocks. Returns the page and the request counters. */
async function visit(s, key, { hash = "", live = false, reduced = false } = {}) {
  const fx = FIXTURES[key];
  const page = await (reduced ? s.reducedContext : s.context).newPage();
  const count = { library: 0, title: 0 };
  watch(page, s.name);
  if (!live) {
    await page.route("**/api/media/library", (route) => {
      count.library++;
      return fx.library === "hang" ? undefined : json(route, fx.library);
    });
    await page.route("**/api/media/title**", (route) => {
      count.title++;
      const id = new URL(route.request().url()).searchParams.get("id");
      const d = fx.titles?.[id];
      return d ? json(route, d) : json(route, { error: "This title is gone since the last scan." }, id === OPEN.missing ? 404 : 502);
    });
    await page.route("**/api/media/scan", (route) => json(route, { ok: true }, 202));
  }
  await page.clock.install({ time: NOW });
  try {
    await page.goto(`${BASE_URL}/media${hash}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
    await page.waitForTimeout(500);
  } catch (e) {
    await diagnose(page, key, s.name);
    throw e;
  }
  return { page, count };
}

async function diagnose(page, label, width) {
  const d = { url: page.url(), consoleErrors: page.consoleErrors.slice(0, 10) };
  d.body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch((e) => `unreadable: ${e.message}`);
  await page.screenshot({ path: join(OUT_DIR, `${label.replace(/[^A-Za-z0-9]+/g, "-")}-FAIL-${width}.png`), fullPage: true }).catch(() => {});
  diag[`${label}@${width}`] = d;
}

/** The strip whose name matches; ids are slug-hash, so open by visible name. */
const stripByName = (page, name) => page.locator("[data-row-id]").filter({ hasText: name }).first();
const openByName = async (page, name) => {
  const row = stripByName(page, name);
  if ((await row.getAttribute("data-on")) === null) await row.locator("button").first().click();
  await page.waitForTimeout(300);
  return row;
};
const nameOf = (id) => id.split("/").pop();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** C3: buttons and links in main with a box under 44 px; an inline link in prose is exempt. */
const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main button, main a[href]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.disabled || getComputedStyle(el).visibility === "hidden") return false;
        if (el.tagName === "A" && el.parentElement?.tagName === "P") return false;
        return r.height < 43.5 || r.width < 43.5;
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)),
  );

/** C1 clipped text, C2 answer lines, C7 bad or warn paint, C10 leaks, C4 duplicate and malformed ids. */
const audit = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.trim().slice(i, i + 2), 16));
    const targets = [rgbOf(root.getPropertyValue("--color-warn")), rgbOf(root.getPropertyValue("--color-bad"))];
    const parse = (s) => {
      const m = s.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      const c = s.match(/^color\(srgb ([^)]+)\)$/);
      if (c) { const p = c[1].split(/[ /]+/).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return null;
    };
    const isDanger = (s) => { const v = parse(s); return Boolean(v) && v[3] > 0 && targets.some((t) => t.every((x, i) => Math.abs(x - v[i]) <= 1.5)); };
    const painted = [];
    const clipped = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(isDanger)) painted.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      const r = el.getBoundingClientRect();
      const byDesign = el.closest(".st-state") || cs.textOverflow === "ellipsis" || el.dataset.feature === "answer" || el.hasAttribute("title") || el.classList.contains("sr-only");
      if (r.width > 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && !byDesign) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
    }
    const ids = [...document.querySelectorAll("[data-row-id]")].map((e) => e.dataset.rowId);
    const a = document.querySelector("[data-feature=answer]");
    const lines = a ? Math.round(a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight)) : 0;
    return {
      dup: ids.length - new Set(ids).size, badId: ids.filter((i) => !/^[a-z0-9-]+$/.test(i)).length,
      painted: painted.length, paintedSample: painted.slice(0, 3), clipped: clipped.length, clippedSample: clipped.slice(0, 3), lines,
    };
  });

const LEAK = /\b\d{1,3}(\.\d{1,3}){3}\b|\/mnt\/|:\d{4,5}\b|https?:\/\/|ffmpeg|Error:|EACCES/;

/** The per-state checks every captured state gets. */
async function perState(page, name, vp) {
  // S2: a crashed page must never pass a check vacuously.
  if (await page.getByText("Something went wrong").isVisible().catch(() => false)) {
    record("S2 page not crashed", `${name}@${vp}`, "crashed");
    diag[`crashed:${name}@${vp}`] = page.consoleErrors.slice(0, 10);
    return { clipped: 1, clippedSample: ["crashed"], lines: 0, dup: 0, badId: 0 };
  }
  const a = await audit(page);
  record("C1 clipped text", `${name}@${vp}`, a.clipped ? { n: a.clipped, sample: a.clippedSample } : 0);
  if (vp === "390") record("C2 answer lines", name, a.lines <= 2 ? a.lines : `${a.lines} lines`);
  record("C4 duplicate or malformed strip id", `${name}@${vp}`, a.dup + a.badId);
  record("C10 no host, path or raw error", `${name}@${vp}`, LEAK.test(await page.locator("main").innerText()) ? "leak" : 0);
  record("C0 no horizontal scroll", `${name}@${vp}`, (await overflow(page)) <= 0);
  if (vp === "390") record("C3 tap targets under 44 px", name, await small(page));
  if (WRITE_STATES.has(name)) record("C18 enabled writes", `${name}@${vp}`, await page.locator("main button:not([disabled])").filter({ hasText: /Rescan/ }).count());
  return a;
}

const shot = (page, name, vp) => page.screenshot({ path: join(OUT_DIR, `${name}-${vp}.png`), fullPage: false });

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const sessions = [];
  for (const v of VIEWPORTS) {
    const opts = { viewport: v.viewport, hasTouch: v.hasTouch, isMobile: v.isMobile, timezoneId: "Australia/Sydney", locale: "en-AU" };
    const context = await browser.newContext(opts);
    const reducedContext = await browser.newContext({ ...opts, reducedMotion: "reduce" });
    for (const c of [context, reducedContext]) await c.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    sessions.push({ name: v.name, context, reducedContext });
  }
  const fail = (name, e) => (diag[`error@${name}`] = String(e).slice(0, 400));
  const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));

  // Captured states, with the per-state checks.
  await each(async (s) => {
    for (const [name, key, chip, open] of STATES) {
      const { page } = await visit(s, key);
      if (open) await openByName(page, nameOf(open));
      if (chip) record("C8 chip", `${name}@${s.name}`, (await page.locator("[data-feature=chip]").innerText()).trim() === chip ? "ok" : "wrong");
      await perState(page, name, s.name);
      await shot(page, name, s.name);
      await page.close();
    }
  });

  // Worker-down-with-data is the last good answer under a dead worker; stale is the same under a failing one. Writes stay off in both.
  const chipIs = (page, label) =>
    page.waitForFunction((l) => document.querySelector("[data-feature=chip]")?.textContent.trim() === l, label, { timeout: 10_000 });
  await each(async (s) => {
    for (const [name, label, answer] of [
      ["worker-down-with-data", "Worker down", (route) => json(route, { worker: "unreachable" })],
      ["stale", "Stale", (route) => json(route, { error: "bad gateway" }, 502)],
    ]) {
      const { page } = await visit(s, "normal");
      await page.route("**/api/media/library", answer);
      await page.waitForTimeout(2300); // SWR dedupes revalidation for 2 s; wait it out so the focus really refetches
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      try {
        await chipIs(page, label);
        await perState(page, name, s.name);
        await shot(page, name, s.name);
      } catch (e) {
        record("C18 state reached", `${name}@${s.name}`, `chip never read ${label}`);
        await diagnose(page, name, s.name);
      }
      await page.close();
    }
  });

  // C9 filters, C7 calm paint, C14 fetches, C4 hash round trip.
  await each(async (s) => {
    const { page, count } = await visit(s, "normal");
    const rows = () => page.locator("[data-row-id]").count();
    const counts = { all: await rows() };
    for (const [label, key] of [["Movies", "movies"], ["Shows", "shows"], ["Could save space", "save"]]) {
      await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
      counts[key] = await rows();
      if (key === "save") await shot(page, "filter-save", s.name);
    }
    record("C9 row counts (12/9/3/7)", s.name, counts);
    await page.getByRole("button", { name: /^All/ }).click();
    for (const id of [OPEN.movie, OPEN.verdicts, OPEN.show]) {
      await openByName(page, nameOf(id));
      const a = await audit(page);
      record("C7 calm paint", `${nameOf(id)}@${s.name}`, a.painted ? { n: a.painted, sample: a.paintedSample } : 0);
    }
    const files = await page.locator("[data-feature=file-row]").count();
    record("C9 big show file rows (24)", s.name, files >= 24 ? files : `${files}`);
    // C14: the first open fetched once per title; reopening and a later poll fetch nothing more.
    const before = count.title;
    const row = stripByName(page, nameOf(OPEN.movie));
    await row.locator("button").first().click();
    await row.locator("button").first().click();
    await page.clock.fastForward(35_000);
    record("C14 refetch on reopen or poll", s.name, count.title - before);
    await page.close();
  });

  // C4: titles that need escaping round trip through the hash.
  await each(async (s) => {
    const { page } = await visit(s, "normal");
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-row-id]")].map((e) => [e.dataset.rowId, e.textContent]));
    let ok = 0;
    for (const n of ["Tom & Jerry (1992)", "It's #1", "A  B"]) {
      const hit = ids.find(([, t]) => (t ?? "").replace(/\s+/g, " ").includes(n.replace(/\s+/g, " ")));
      if (!hit) continue;
      const p2 = (await visit(s, "normal", { hash: `#${hit[0]}` })).page;
      if ((await p2.locator(`[data-row-id="${hit[0]}"]`).getAttribute("data-on")) !== null) ok++;
      await p2.close();
    }
    record("C4 hash round trip (3/3)", s.name, ok);
    await page.close();
  });

  // C5 reduced motion.
  await each(async (s) => {
    const { page } = await visit(s, "normal", { reduced: true });
    const dur = await page.locator(".st-chev").first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    record("C5 reduced-motion transition on .st-chev", s.name, dur);
    await page.close();
  });

  // C11 sticky pane and C12 columns at 1440; C13 wrapping at 390.
  await each(async (s) => {
    if (s.name !== "1440") return;
    // C11 on the 130-strip fixture: open a title with a long file list, scroll well past the pane's natural top, then measure.
    const big = await visit(s, "scale130");
    await openByName(big.page, "Show 130");
    await big.page.evaluate(() => window.scrollTo(0, 0));
    await big.page.evaluate(() => window.scrollTo(0, Math.min(2500, document.documentElement.scrollHeight - innerHeight)));
    await big.page.waitForTimeout(400);
    const box = await big.page.locator(".st-pane").first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scrolled: window.scrollY };
    });
    record("C11 sticky pane top and bottom", s.name, { ...box, ok: box.scrolled > 1000 && box.top >= 0 && box.top <= 24 && box.bottom <= 900 });
    await big.page.close();
    const { page } = await visit(s, "normal");
    await openByName(page, nameOf(OPEN.show));
    const cols = await page.locator("[data-feature=file-row]").evaluateAll((els) =>
      els.map((el) => ["md-name", "md-size", "md-res", "md-codec", "md-rate", "md-word"].map((c) => el.querySelector(`.${c}`)?.getBoundingClientRect().left ?? -1)),
    );
    const increasing = cols.every((r) => r.every((x, i) => i === 0 || x > r[i - 1]));
    const spread = cols[0]?.map((_, i) => Math.max(...cols.map((r) => r[i])) - Math.min(...cols.map((r) => r[i]))) ?? [];
    record("C12 columns increasing, spread at most 1 px", s.name, { increasing, spread: spread.map((x) => Number(x.toFixed(1))), ok: increasing && spread.every((x) => x <= 1) });
    await page.close();
  });
  await each(async (s) => {
    if (s.name !== "390") return;
    const { page } = await visit(s, "longValues");
    await openByName(page, nameOf(OPEN.long));
    const lines = await page.evaluate(() => {
      const n = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      return {
        names: Math.max(0, ...[...document.querySelectorAll(".st-name")].map(n)),
        states: Math.max(0, ...[...document.querySelectorAll("[data-row-id] .st-state")].map(n)),
        files: Math.max(0, ...[...document.querySelectorAll(".md-name")].map(n)),
      };
    });
    record("C13 wrapping (name at most 2, state 1, file at most 2)", s.name, { ...lines, ok: lines.names <= 2 && lines.states <= 1 && lines.files <= 2 });
    await page.close();
  });

  // C16 scale.
  await each(async (s) => {
    const { page } = await visit(s, "scale130");
    record("C16 DOM elements before any strip opens (at most 4000)", s.name, await page.evaluate(() => document.querySelectorAll("*").length));
    await page.close();
    if (s.name !== "390") return;
    const big = await visit(s, "hugeShow");
    await big.page.evaluate(() => {
      window.__long = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__long = Math.max(window.__long, e.duration)))).observe({ entryTypes: ["longtask"] });
    });
    await big.page.locator("[data-row-id] button").first().click();
    await big.page.waitForTimeout(1500);
    record("C16 longest task opening the 300-file show (under 250 ms)", s.name, await big.page.evaluate(() => Math.round(window.__long)));
    await big.page.close();
  });

  // C20 live: the real fixture worker. The test stack needs a login (done per context) and has no worker set, so connect it first.
  // Clips (make-fixtures.sh): 9 movie folders (Broken (2000) is listed, with a probeError) plus tv/Test Show = 10 strips; music/Decoy is never listed.
  const LIVE_STRIPS = 10;
  await each(async (s) => {
    const key = "C20 live: " + LIVE_STRIPS + " strips, no Decoy";
    const api = s.context.request;
    const set = await api.post(`${BASE_URL}/api/settings/integrations`, { data: { media: { workerUrl: "http://media-worker:8091", workerToken: "test-media-worker-token-not-secret-000000" } } });
    if (set.status() === 401 || set.status() === 403) return record(key, s.name, "C20 live: login missing");
    const scan = await api.post(`${BASE_URL}/api/media/scan`);
    if (scan.status() === 401 || scan.status() === 403) return record(key, s.name, "C20 live: login missing");
    let done = false;
    for (const end = Date.now() + 90_000; Date.now() < end && !done; ) {
      const lib = await (await api.get(`${BASE_URL}/api/media/library`)).json().catch(() => ({}));
      done = lib.worker === "ok" && lib.data?.scan?.state !== "running" && Boolean(lib.data?.scannedAt);
      if (!done) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!done) return record(key, s.name, "scan did not finish in 90 s");
    const { page } = await visit(s, "liveNormal", { live: true });
    const rows = await page.locator("[data-row-id]").count();
    const text = await page.locator("main").innerText();
    record(key, s.name, { rows, decoy: /Decoy/.test(text), ok: rows === LIVE_STRIPS && !/Decoy/.test(text) });
    await shot(page, "live-normal", s.name);
    await page.close();
  });

  await browser.close();
  finish();
}

function finish() {
  const out = { ...results, "C6 page errors": pageErrors.slice(0, 10), "C6 foreign requests": [...new Set(foreignRequests)].slice(0, 10), diag };
  console.log(JSON.stringify(out));
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (finish(), process.exit(1)));
main().catch((e) => {
  diag.fatal = String(e).slice(0, 400);
  finish();
  process.exit(1);
});
