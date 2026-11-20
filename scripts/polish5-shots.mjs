// nw-polish5 captures: Home heading with a partly unreadable change log (home-partial, home-full) and the kiosk 10-minute timeout line (kiosk-timeout, text-pretty).
// Never run on the PC: the lead runs it on the test stack. Run: BASE_URL=http://localhost:3006 OUT_DIR=shots node --experimental-strip-types scripts/polish5-shots.mjs
// ONLY (or SHOTS_ONLY) = home-partial | home-full | kiosk-timeout; empty runs all. Playwright >= 1.45. BASE_URL must be a secure context (localhost) for the kiosk mic.
// Clock and theme pinned as the source scripts do: Home on WK_NOW (a Thursday, Australia/Sydney, en-AU); kiosk on PINNED_ISO, theme=sunroom, wx=off.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PINNED_ISO, QUIET, ROUTES, ZONE } from "./fixtures/kiosk/fixtures.mjs";
import { backupOk, build, buildWeek, CONTAINERS, WIDGETS } from "./fixtures/home/fixtures.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY || "";
const COPY = "Hermes has not answered after 10 minutes. Stopped waiting; it may still be working.";
const CAP_MS = 10 * 60 * 1000;
const STEP_MS = 10_000;
const PAD = 16;
const WEEK_MS = 7 * 86_400_000;
const WK_NOW = Date.parse("2026-11-12T09:00:00+11:00");
const RUNNING = { ok: true, job: { state: "running", kind: "ask", startedAt: null, finishedAt: null, result: null, error: null } };
const HEADING = "Last 7 days · log partly unreadable";

mkdirSync(OUT_DIR, { recursive: true });
const results = { failed: 0, checks: [] };
const rec = (key, ok, value) => {
  results.checks.push({ key, ok, value });
  if (!ok) results.failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${key}: ${JSON.stringify(value)}`);
};
let curPage = null;
async function step(name, fn) {
  try {
    return await fn();
  } catch (e) {
    const slug = name.replace(/[^a-z0-9]+/gi, "-");
    if (curPage) await curPage.screenshot({ path: join(OUT_DIR, `polish5-FAILED-${slug}.png`), fullPage: true }).catch(() => {});
    const msg = String(e?.message ?? e).split(/\r?\n/)[0];
    console.log(`STEP FAILED ${name}: ${msg}`);
    throw new Error(`step "${name}": ${msg}`);
  }
}

/** Padded clip of a box; fixed or sticky chrome that only overlaps the padding trims the clip, chrome over the box itself fails the check (same as ask-deadline-shots.mjs). */
async function paddedCrop(page, locator, file, viewport) {
  await locator.scrollIntoViewIfNeeded();
  const bb = await locator.boundingBox();
  if (!bb) throw new Error("crop target has no box");
  const x = Math.max(0, bb.x - PAD), y = Math.max(0, bb.y - PAD);
  const clip = { x, y, width: Math.min(viewport.width - x, bb.width + PAD * 2), height: Math.min(viewport.height - y, bb.height + PAD * 2) };
  const chrome = await locator.evaluate((el, c) => {
    const hits = [];
    const round = (v) => Math.round(v * 10) / 10;
    for (const n of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(n);
      const pos = cs.position;
      // shortcut: pointer-events:none layers (the kiosk sky and light-leak backdrops) are decoration behind the content, not chrome; revisit if one ever paints over it
      if ((pos !== "fixed" && pos !== "sticky") || n.contains(el) || cs.pointerEvents === "none") continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height && r.left < c.x + c.width && r.right > c.x && r.top < c.y + c.height && r.bottom > c.y) {
        hits.push({ el: n.tagName + "." + String(n.className).slice(0, 40), left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom) });
      }
    }
    return hits;
  }, clip);
  let covered = false;
  for (const r of chrome) {
    if (r.left < bb.x + bb.width && r.right > bb.x && r.top < bb.y + bb.height && r.bottom > bb.y) { covered = true; continue; }
    if (r.bottom <= bb.y) { const ny = Math.max(clip.y, r.bottom); clip.height -= ny - clip.y; clip.y = ny; }
    else if (r.top >= bb.y + bb.height) clip.height = Math.min(clip.height, r.top - clip.y);
    else if (r.right <= bb.x) { const nx = Math.max(clip.x, r.right); clip.width -= nx - clip.x; clip.x = nx; }
    else clip.width = Math.min(clip.width, r.left - clip.x);
  }
  rec(`${file}: crop not covered by fixed or sticky chrome`, !covered, { box: bb, clip, chrome });
  await page.screenshot({ path: join(OUT_DIR, file), clip });
}

/** Home with the 7-day range answered by the weekCovered fixture cut to three events; partial adds `changes.partial: true`. */
async function homeState(name, partial, widths) {
  const browser = await chromium.launch({ headless: true });
  try {
    const fixW = buildWeek(WK_NOW).weekCovered;
    // weekCovered is a whole report: loggedFrom older than since, four events; cut to three.
    const week = { ...fixW, changes: { ...fixW.changes, events: fixW.changes.events.slice(0, 3), ...(partial ? { partial: true } : {}) } };
    for (const vp of widths) {
      const viewport = { width: vp, height: vp === 390 ? 844 : 900 };
      const context = await browser.newContext({ viewport, timezoneId: ZONE, locale: "en-AU", ...(vp === 390 ? { hasTouch: true, isMobile: true } : {}) });
      const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
      if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
      await context.addInitScript((t) => { try { window.localStorage.setItem("home-last-looked", String(t)); } catch {} }, WK_NOW - 8 * 3600_000);
      const page = await context.newPage();
      curPage = page;
      page.setDefaultTimeout(30_000);
      const attReqs = [];
      page.on("request", (r) => { if (r.url().includes("/api/attention")) attReqs.push(r.url()); });
      await page.clock.setFixedTime(WK_NOW);
      await page.route("**/api/attention*", (route) => {
        const since = Number(new URL(route.request().url()).searchParams.get("since"));
        return route.fulfill({ json: Math.abs(since - (WK_NOW - WEEK_MS)) < 60_000 ? week : build(WK_NOW).quiet });
      });
      await page.route("**/api/docker/containers", (route) => route.fulfill({ json: CONTAINERS }));
      await page.route("**/api/backup", (route) => route.fulfill({ json: backupOk(WK_NOW) }));
      await page.route("**/api/widgets", (route) => route.fulfill({ json: WIDGETS }));
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.locator(".hm-answer").waitFor({ timeout: 30_000 });
      const h2 = page.locator('[data-feature="changes"] h2');
      // A click before hydration is a no-op and the heading stays "Since you last looked": wait for its time (last look read), click, then wait for the 7-day heading.
      await step(`${name}@${vp}: pick 7 days`, async () => {
        await page.waitForFunction(() => /^Since you last looked · [0-9]/.test(document.querySelector('[data-feature="changes"] h2')?.textContent ?? ""), null, { timeout: 15_000 });
        await page.getByRole("button", { name: "Last 7 days" }).click();
        await page.waitForFunction(() => /^Last 7 days/.test(document.querySelector('[data-feature="changes"] h2')?.textContent ?? ""), null, { timeout: 15_000 })
          .catch(async (e) => { throw new Error(`heading "${await h2.textContent()}", /api/attention requests: ${attReqs.join(" | ")}; ${e.message}`); });
      });
      const m = await h2.evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
        return { text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / lh) };
      });
      const tag = `${name}@${vp}`;
      rec(`${tag}: heading text`, m.text === (partial ? HEADING : "Last 7 days"), m.text);
      rec(`${tag}: heading does not overflow (scrollWidth <= clientWidth)`, m.sw <= m.cw, { scrollWidth: m.sw, clientWidth: m.cw });
      if (partial) rec(`${tag}: heading lines`, vp === 390 ? m.lines <= 2 : m.lines === 1, m.lines);
      await paddedCrop(page, page.locator('[data-feature="changes"]'), `polish5-${name}-${vp}.png`, viewport);
      await page.screenshot({ path: join(OUT_DIR, `polish5-${name}-full-${vp}.png`), fullPage: true });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function kioskTimeout() {
  const VIEWPORT = { width: 1024, height: 768 };
  const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["microphone"], timezoneId: ZONE });
    await context.clock.install({ time: new Date(PINNED_ISO) }); // daytime: a night run gets the overlay and the PIN pad never opens
    const page = await context.newPage();
    curPage = page;
    page.setDefaultTimeout(STEP_MS);
    let elevated = false;
    const until = Date.parse(PINNED_ISO) + 3_600_000;
    await page.route("**/kiosk/api/**", (route) => route.fulfill({ json: ROUTES[new URL(route.request().url()).pathname] ?? QUIET }));
    await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? ((elevated = true), route.fulfill({ json: { ok: true, expiresAt: until } })) : route.fallback()));
    await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: elevated ? { elevated: true, expiresAt: until } : { elevated: false } }));
    await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/voice/transcribe", (route) => route.fulfill({ json: { status: "ok", text: "Is the backup healthy?" } }));
    await page.route("**/api/hermes-ctl/run", (route) => route.fulfill({ json: { jobId: "job-ask" } }));
    await page.route("**/api/hermes-ctl/jobs/*", (route) => route.fulfill({ json: RUNNING }));
    await page.goto(`${BASE_URL}/kiosk?theme=sunroom&wx=off&layout=standard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.locator('[data-kiosk-theme="sunroom"]').first().waitFor({ state: "attached" });
    await page.waitForTimeout(1200);
    await step("open admin pad", async () => {
      await page.getByRole("button", { name: /^Admin/ }).first().click();
      await page.getByRole("button", { name: "digit 0" }).waitFor();
    });
    await step("type pin", async () => {
      for (const dg of "0000") await page.getByRole("button", { name: `digit ${dg}` }).click();
    });
    await step("wait elevated", () => page.getByText("elevated", { exact: true }).first().waitFor());
    const mic = page.getByRole("button", { name: "Tap to ask Hermes" });
    await step("mic start", async () => {
      await mic.waitFor();
      await mic.click();
      await page.getByRole("button", { name: "Tap to stop" }).waitFor();
    });
    await page.waitForTimeout(800);
    await step("mic stop", () => page.getByRole("button", { name: "Tap to stop" }).click());
    await step("asking under the cap", async () => {
      await page.getByRole("button", { name: "Asking Hermes…" }).waitFor();
      await page.waitForTimeout(2500);
    });
    await page.clock.fastForward(CAP_MS + 1000);
    const err = page.getByText(COPY, { exact: true });
    await step("timeout shown", () => err.waitFor());
    await page.waitForTimeout(500);
    const m = await err.evaluate((el) => {
      const node = el.firstChild;
      const words = [];
      const re = /\S+/g;
      let w;
      while ((w = re.exec(node.textContent))) {
        const r = document.createRange();
        r.setStart(node, w.index);
        r.setEnd(node, w.index + w[0].length);
        const b = r.getBoundingClientRect();
        words.push({ top: Math.round(b.top), left: b.left, right: b.right });
      }
      const lastTop = Math.max(...words.map((x) => x.top));
      const last = words.filter((x) => Math.abs(x.top - lastTop) <= 2);
      const lineTops = new Set(words.map((x) => x.top)).size;
      const lastWidth = Math.max(...last.map((x) => x.right)) - Math.min(...last.map((x) => x.left));
      return { text: el.textContent, lineTops, lastWords: last.length, lastWidth, pw: el.clientWidth, textWrap: getComputedStyle(el).textWrap };
    });
    rec("kiosk-timeout: exact copy", m.text === COPY, m.text);
    rec("kiosk-timeout: text-wrap is pretty", m.textWrap === "pretty", m.textWrap);
    rec("kiosk-timeout: last line holds more than one word", m.lastWords > 1 || m.lastWidth >= 0.2 * m.pw, { lines: m.lineTops, lastWords: m.lastWords, lastWidth: Math.round(m.lastWidth), paragraphWidth: m.pw });
    const panel = page.locator("span.microlabel", { hasText: /^voice$/ }).first().locator("xpath=..");
    await paddedCrop(page, panel, "polish5-kiosk-timeout-1024x768.png", VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, "polish5-kiosk-timeout-full-1024x768.png"), fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
}

const want = (n) => !ONLY || ONLY.split(",").includes(n);
try {
  if (want("home-partial")) await homeState("home-partial", true, [390, 1280]);
  if (want("home-full")) await homeState("home-full", false, [390]);
  if (want("kiosk-timeout")) await kioskTimeout();
} catch (e) {
  rec("script", false, String(e?.message ?? e));
}
console.log(JSON.stringify({ failed: results.failed, checks: results.checks }));
process.exit(results.failed ? 1 : 0);
