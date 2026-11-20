// Hunt 99 H99-2: a Hermes ask that stays "running" for 10 minutes stops being waited for. Never run on the PC: the lead runs it on the test stack.
// Run: ONLY=kiosk-ask-timeout BASE_URL=http://localhost:3006 OUT_DIR=shots node scripts/ask-deadline-shots.mjs  (SHOTS_ONLY works too; empty runs all)
// ONLY values: kiosk-ask-timeout, hermes-ask-timeout-1280, hermes-ask-timeout-390. Playwright >= 1.45 (page.clock). BASE_URL must be a secure context
// (localhost), or the kiosk shows the text fallback instead of the mic and the kiosk state fails with a clear message.
// Path: the run POST returns a jobId, every job GET returns "running" (the identical body each time), a question goes in (kiosk: the fake microphone, as
// voice-shots.mjs, because on a secure origin the kiosk shows the mic and no text box; Hermes page: the Ask textbox), then page.clock moves past 10 minutes.
// No cropElement helper exists in this repo (voice-shots.mjs says the same), so the crop is a padded clip plus an explicit fixed/sticky chrome check.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PINNED_ISO, QUIET, ROUTES, ZONE } from "./fixtures/kiosk/fixtures.mjs";
import { FIXTURES, NOW } from "./fixtures/hermes/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY || "";
const COPY = "Hermes has not answered after 10 minutes. Stopped waiting; it may still be working.";
const CAP_MS = 10 * 60 * 1000;
const STEP_MS = 10_000;
const PAD = 16;
const RUNNING = { ok: true, job: { state: "running", kind: "ask", startedAt: null, finishedAt: null, result: null, error: null } };

mkdirSync(OUT_DIR, { recursive: true });
const results = { checks: {}, failed: [] };
const rec = (key, ok, value) => {
  results.checks[key] = { ok, value };
  if (!ok) results.failed.push(key);
  console.log(`${ok ? "ok  " : "FAIL"} ${key}: ${JSON.stringify(value)}`);
};
let curPage = null;
async function step(name, fn) {
  try {
    return await fn();
  } catch (e) {
    const slug = name.replace(/[^a-z0-9]+/gi, "-");
    if (curPage) await curPage.screenshot({ path: join(OUT_DIR, `ask-deadline-FAILED-${slug}.png`), fullPage: true }).catch(() => {});
    const msg = String(e?.message ?? e).split(/\r?\n/)[0];
    console.log(`STEP FAILED ${name}: ${msg}`);
    throw new Error(`step "${name}": ${msg}`);
  }
}

/** Counts job GETs and answers every one with the same running body. */
function stubJobs(page, counter) {
  return page.route("**/api/hermes-ctl/jobs/*", (route) => {
    counter.n += 1;
    return route.fulfill({ json: RUNNING });
  });
}

/** Padded clip of a box, with the fixed/sticky chrome check: any visible fixed or sticky element (not an ancestor of the box) overlapping the clip fails. */
async function paddedCrop(page, locator, file, viewport) {
  await locator.scrollIntoViewIfNeeded();
  const bb = await locator.boundingBox();
  if (!bb) throw new Error("crop target has no box");
  const x = Math.max(0, bb.x - PAD), y = Math.max(0, bb.y - PAD);
  const clip = { x, y, width: Math.min(viewport.width - x, bb.width + PAD * 2), height: Math.min(viewport.height - y, bb.height + PAD * 2) };
  const covering = await locator.evaluate((el, c) => {
    const hits = [];
    for (const n of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(n).position;
      if ((pos !== "fixed" && pos !== "sticky") || n.contains(el)) continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height && r.left < c.x + c.width && r.right > c.x && r.top < c.y + c.height && r.bottom > c.y) hits.push(n.tagName + "." + String(n.className).slice(0, 40));
    }
    return hits;
  }, clip);
  rec(`${file}: crop not covered by fixed or sticky chrome`, covering.length === 0, covering);
  await page.screenshot({ path: join(OUT_DIR, file), clip });
}

async function kioskAskTimeout() {
  const VIEWPORT = { width: 1024, height: 768 };
  const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["microphone"], timezoneId: ZONE });
    await context.clock.install({ time: new Date(PINNED_ISO) }); // daytime: a night run gets the overlay and the PIN pad never opens
    const page = await context.newPage();
    curPage = page;
    page.setDefaultTimeout(STEP_MS);
    const jobs = { n: 0 };
    let elevated = false;
    const until = Date.parse(PINNED_ISO) + 3_600_000;
    await page.route("**/kiosk/api/**", (route) => route.fulfill({ json: ROUTES[new URL(route.request().url()).pathname] ?? QUIET }));
    await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? ((elevated = true), route.fulfill({ json: { ok: true, expiresAt: until } })) : route.fallback()));
    await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: elevated ? { elevated: true, expiresAt: until } : { elevated: false } }));
    await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/voice/transcribe", (route) => route.fulfill({ json: { status: "ok", text: "Is the backup healthy?" } }));
    await page.route("**/api/hermes-ctl/run", (route) => route.fulfill({ json: { jobId: "job-ask" } }));
    await stubJobs(page, jobs);
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
      await mic.waitFor(); // absent on a non-secure BASE_URL: the text fallback is shown instead and this state cannot be reached
      await mic.click();
      await page.getByRole("button", { name: "Tap to stop" }).waitFor();
    });
    await page.waitForTimeout(800);
    await step("mic stop", () => page.getByRole("button", { name: "Tap to stop" }).click());
    await step("asking under the cap", async () => {
      await page.getByRole("button", { name: "Asking Hermes…" }).waitFor();
      await page.waitForTimeout(2500); // a few 2 s polls, all "running"
    });
    rec("kiosk: polling while under the cap", jobs.n >= 1, jobs.n);
    await page.clock.fastForward(CAP_MS + 1000);
    const err = page.getByText(COPY, { exact: true });
    await step("timeout shown", () => err.waitFor());
    await page.waitForTimeout(500);

    const m = await err.evaluate((el) => ({ text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth }));
    rec("kiosk: exchange shows the exact copy", m.text === COPY, m.text);
    rec("kiosk: error text not clipped (scrollWidth <= clientWidth)", m.sw <= m.cw, { scrollWidth: m.sw, clientWidth: m.cw });
    const micAgain = page.getByRole("button", { name: "Tap to ask Hermes" });
    rec("kiosk: mic enabled, named Tap to ask Hermes", (await micAgain.count()) === 1 && (await micAgain.isEnabled()), null);
    const box = page.getByPlaceholder("Type instead…"); // shown only when the mic is unsupported; on this surface a count of 0 is expected
    rec("kiosk: text input (if shown) enabled", (await box.count()) === 0 || (await box.isEnabled()), await box.count());
    const before = jobs.n;
    await page.clock.runFor(10_000);
    await page.waitForTimeout(500);
    rec("kiosk: no job GET in the 10 s after the timeout", jobs.n === before, { before, after: jobs.n });
    const panel = page.locator("span.microlabel", { hasText: /^voice$/ }).first().locator("xpath=..");
    await paddedCrop(page, panel, "kiosk-ask-timeout-1024x768.png", VIEWPORT);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function hermesAskTimeout(name, viewport, extra) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport, ...extra, timezoneId: "Australia/Sydney" });
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } }); // the test stack's dev login takes any password
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
    const page = await context.newPage();
    curPage = page;
    page.setDefaultTimeout(40_000);
    const fx = FIXTURES.calm;
    const jobs = { n: 0 };
    await page.route("**/api/hermes-ctl/status", (route) => route.fulfill({ json: fx.status }));
    await page.route("**/api/hermes-ctl/activity", (route) => route.fulfill({ json: fx.activity }));
    await page.route("**/api/hermes-ctl/run", (route) => route.fulfill({ json: { jobId: "job-ask" } }));
    await stubJobs(page, jobs);
    await page.clock.install({ time: NOW });
    await page.goto(`${BASE_URL}/hermes`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.locator("[data-feature=chip]").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking");
    const detail = page.locator(".st-pane, .st-body");
    await step(`${name}: open ask`, async () => {
      const t = page.locator('[data-k="open-ask"]');
      if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
      await detail.getByRole("textbox", { name: "Ask Hermes" }).waitFor();
    });
    await detail.getByRole("textbox", { name: "Ask Hermes" }).fill("Is the backup healthy?");
    await detail.getByRole("button", { name: /^Ask$/ }).click();
    await step(`${name}: asking under the cap`, async () => {
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Ask$/.test(b.textContent?.trim() ?? "") && b.disabled));
      await page.waitForTimeout(2500);
    });
    rec(`${name}: polling while under the cap`, jobs.n >= 1, jobs.n);
    await page.clock.fastForward(CAP_MS + 1000);
    const band = page.locator('[role="alert"]', { hasText: "ask failed" });
    await step(`${name}: timeout shown`, () => band.waitFor());
    await page.waitForTimeout(500);

    const m = await band.locator("p").evaluate((el) => ({ text: el.textContent?.trim(), sw: el.scrollWidth, cw: el.clientWidth }));
    rec(`${name}: ask failed band shows the exact copy`, m.text === COPY, m.text);
    rec(`${name}: text not clipped (scrollWidth <= clientWidth)`, m.sw <= m.cw, { scrollWidth: m.sw, clientWidth: m.cw });
    await detail.getByRole("textbox", { name: "Ask Hermes" }).fill("Another question");
    rec(`${name}: Ask enabled once a question is typed`, await detail.getByRole("button", { name: /^Ask$/ }).isEnabled(), null);
    const before = jobs.n;
    await page.clock.runFor(10_000);
    await page.waitForTimeout(500);
    rec(`${name}: no job GET in the 10 s after the timeout`, jobs.n === before, { before, after: jobs.n });
    rec(`${name}: page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), null);

    const area = detail.first();
    await paddedCrop(page, area, `hermes-ask-timeout-${name}-crop.png`, viewport);
    if (name === "390") {
      const nav = await page.locator("nav.md\\:hidden").first().boundingBox();
      const bb = await area.boundingBox();
      rec("390: crop clears the fixed bottom nav", !nav || !bb || bb.y + bb.height + PAD <= nav.y, { crop: bb && bb.y + bb.height + PAD, navTop: nav?.y });
    }
    await page.screenshot({ path: join(OUT_DIR, `hermes-ask-timeout-${name}-full.png`), fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
}

const want = (s) => !ONLY || ONLY === s;
try {
  if (want("kiosk-ask-timeout")) await kioskAskTimeout();
  if (want("hermes-ask-timeout-1280")) await hermesAskTimeout("1280", { width: 1280, height: 800 }, {});
  if (want("hermes-ask-timeout-390")) await hermesAskTimeout("390", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
} catch (e) {
  results.failed.push(String(e?.message ?? e));
}
console.log(JSON.stringify(results));
process.exit(results.failed.length ? 1 : 0);
