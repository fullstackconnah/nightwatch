#!/usr/bin/env node
/* Captures /smarthome on the test stack, once per state of the strips pattern, at 1440x900 and 390x844, and prints the
 * numeric checks as one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/smarthome-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml) and Playwright >= 1.45 (page.clock), which is not a dependency of this
 * repo; run it where one is installed. Nothing real is touched: /api/ha/states, /api/ha/action and the kiosk auto-off
 * read are answered from scripts/fixtures/smarthome/fixtures.mjs (placeholder addresses only). Time is driven by
 * page.clock (installed before goto, pinned to the fixtures' NOW); the context time zone is pinned.
 *
 * Checks: C10 duplicate ids, C11 honest chip and answer, C12 reduced motion, C13 every feature visible, C14 page errors
 * and foreign requests, C15 calm paint, C16 answer at most 2 lines at 390, C17 clipped content, CL lock rules, then
 * C18-C29 (scroll, raw text, strip opens, tap targets, lock question, stale).
 * Captures, per width: calm, ac-on-autooff, problem-jammed, device-unavailable, ac-off, stale, write-failed,
 * lock-confirm, unconfigured, unreachable, unauthorized, loading (plus empty, lowBattery, noAutoOff).
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, NOW } from "./fixtures/smarthome/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
// [fixture, chip, a phrase the answer must contain, the strip that must be open by itself (null: none named)]
const STATES = [
  ["loading", "Checking", "Connecting to Home Assistant", null],
  ["unconfigured", "Not connected", "isn’t connected yet", null],
  ["tokenRejected", "Token rejected", "rejected the access token", null],
  ["unreachable", "Not answering", "isn’t answering", null],
  ["empty", "Connected", "shares no devices", null],
  ["calm", "Connected", "Front door locked. 1 of 4 ACs on, turning off at 23:00.", null],
  ["acOff", "Connected", "Front door locked. 0 of 4 ACs on.", null],
  ["jammed", "Lock jammed", "The front door lock is jammed.", "lock"],
  ["deviceDown", "Partial", "Lounge isn’t answering.", "lights"],
  ["lowBattery", "Connected", "Door sensor battery is at 14%.", null],
  ["noAutoOff", "Connected", "Front door locked. 1 of 4 ACs on.", null],
];
// Capture names from the design note's state line; anything not listed keeps its fixture name.
const SHOT = { tokenRejected: "unauthorized", jammed: "problem-jammed", deviceDown: "device-unavailable", acOff: "ac-off" };

// C13: the 20 features of today's five panels, each looked up after opening its strip (report, feature list).
const detail = (p) => p.locator(".st-pane, .st-body");
const FEATURES = [
  ["chip", null, (p) => p.locator("[data-feature=chip]")],
  ["answer", null, (p) => p.locator("[data-feature=answer]")],
  ["evidence", null, (p) => p.locator("[data-feature=evidence]")],
  ["strip-state-lines", null, (p) => p.locator("[data-row-id] .st-state")],
  ["light-name", "lights", (p) => detail(p).getByText("Hallway", { exact: true })],
  ["light-status", "lights", (p) => detail(p).getByText("60%", { exact: true })],
  ["light-toggle", "lights", (p) => detail(p).getByRole("button", { name: "Toggle Hallway" })],
  ["switch-name", "switches", (p) => detail(p).getByText("Desk fan", { exact: true })],
  ["switch-toggle", "switches", (p) => detail(p).getByRole("button", { name: "Toggle Desk fan" })],
  ["climate-current", "climate", (p) => detail(p).getByText("Current", { exact: true }).first()],
  ["climate-target", "climate", (p) => detail(p).getByText("Target", { exact: true }).first()],
  ["climate-minus", "climate", (p) => detail(p).getByRole("button", { name: /^Lower target temperature/ }).first()],
  ["climate-plus", "climate", (p) => detail(p).getByRole("button", { name: /^Raise target temperature/ }).first()],
  ["climate-mode", "climate", (p) => detail(p).getByRole("button", { name: / mode$/ }).first()],
  ["lock-button", "lock", (p) => p.locator('[data-row-id="lock"] .st-slot').getByRole("button", { name: /^Lock Front door$/ })],
  ["unlock-button", "lock", (p) => p.locator('[data-row-id="lock"] .st-slot').getByRole("button", { name: /^Unlock Front door$/ })],
  ["lock-state", "lock", (p) => detail(p).getByText(/^locked$/i).first()],
  ["sensor-temperature", "sensors", (p) => detail(p).getByText("Lounge temperature", { exact: true })],
  ["sensor-humidity", "sensors", (p) => detail(p).getByText("Lounge humidity", { exact: true })],
  ["sensor-battery", "sensors", (p) => detail(p).getByText("Door sensor battery", { exact: true })],
];

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];
// diag.<stage>@<width>: what a failed page showed (screenshot, url, body text, console errors), so a hidden crash is visible.
const diag = {};

// One bad state must not hide the rest: a throw (a failed waitFor included) is recorded as a FAIL and the next step runs.
let stage = "";
const fail = (vp, e) => record("FAIL", `${stage}@${vp}`, String(e?.message ?? e).split(/\r?\n/)[0]);
const guarded = (label, fn) => { stage = label; return fn().catch((e) => fail("all", e)); };

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) {
  sessions.push({
    name,
    context: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney" }),
    reducedContext: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney", reducedMotion: "reduce" }),
  });
}
// The test stack's dev login takes any password; each context keeps its own cookie (as minecraft-shots does).
for (const s of sessions) {
  for (const ctx of [s.context, s.reducedContext]) {
    const login = await ctx.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }
}
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));

/** C14: page errors, and any request that leaves the page's own origin. */
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

// action: "ok" | "fail" | "hold" (the write stays unanswered, for the in-flight check)
async function visit(s, key, { hash = "", action = "ok", reduced = false } = {}) {
  const fx = FIXTURES[key];
  const page = await (reduced ? s.reducedContext : s.context).newPage();
  const mock = { fx, action, posts: [] };
  watch(page, s.name);
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/ha/states", (route) => (fx.ha === "hang" ? undefined : json(route, fx.ha)));
  await page.route("**/kiosk/api/climate-auto-off", (route) => (fx.autoOff === "fail" ? json(route, { error: "x" }, 500) : json(route, fx.autoOff)));
  await page.route("**/api/ha/action", (route) => {
    mock.posts.push(route.request().postDataJSON());
    if (mock.action === "hold") return new Promise(() => {});
    return mock.action === "fail" ? json(route, { error: "upstream said 10.0.0.5 refused" }, 502) : json(route, { ok: true });
  });
  await page.clock.install({ time: NOW });
  try {
    await page.goto(`${BASE_URL}/smarthome${hash}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
    await page.waitForTimeout(500);
  } catch (e) {
    await diagnose(page, `${stage}:${key}`, s.name);
    throw e;
  }
  return { page, mock };
}

/** Screenshot, url, first 600 chars of the body and the console errors of a page that failed to reach its state. */
async function diagnose(page, label, width) {
  const d = { url: page.url(), consoleErrors: page.consoleErrors.slice(0, 10) };
  d.body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch((e) => `unreadable: ${e.message}`);
  await page.screenshot({ path: join(OUT_DIR, `${label.replace(/[^A-Za-z0-9]+/g, "-")}-FAIL-${width}.png`), fullPage: true }).catch((e) => (d.screenshot = `failed: ${e.message}`));
  diag[`${label}@${width}`] = d;
}

const text = (page, sel) => page.locator(sel).first().innerText();
const headBox = async (page) => (await page.locator("[data-feature=head]").boundingBox())?.height ?? 0;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const openStrip = async (page, id) => {
  const t = page.locator(`[data-k="open-${id}"]`);
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  await page.waitForTimeout(150);
};

/** C21: buttons and links in main with a box under 44 px in either direction; an inline link inside prose is exempt. */
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

/** C10 duplicate ids, C15 bad or warn paint, C16 answer lines, C17 clipped content: computed-style probes, no pixels. */
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
    const painted = [...document.querySelectorAll("main [data-tone=bad], main [data-tone=warn]")].map((el) => `${el.tagName.toLowerCase()}[${el.dataset.tone}]`);
    const clipped = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(isDanger)) painted.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      const r = el.getBoundingClientRect();
      const byDesign = cs.textOverflow === "ellipsis" || el.dataset.feature === "answer" || el.tagName === "INPUT" || el.tagName === "SELECT";
      if (r.width > 0 && cs.overflowX === "hidden" && el.scrollWidth > el.clientWidth + 1 && !byDesign) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
    }
    const ids = [...document.querySelectorAll("[data-row-id]")].map((e) => e.dataset.rowId);
    const a = document.querySelector("[data-feature=answer]");
    const lines = a ? Math.round(a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight)) : 0;
    return { dup: ids.length - new Set(ids).size, painted: painted.length, paintedSample: painted.slice(0, 3), clipped: clipped.length, clippedSample: clipped.slice(0, 3), lines };
  });

/** The per-state checks every captured state gets (name is the state's capture name). */
async function perState(page, name, vp) {
  const a = await audit(page);
  record("C10 duplicate data-row-id", `${name}@${vp}`, a.dup);
  if (vp === "390") record("C16 answer at most 2 lines", name, a.lines <= 2 ? a.lines : `${a.lines} lines`);
  record("C17 clipped content", `${name}@${vp}`, a.clipped ? { n: a.clipped, sample: a.clippedSample } : 0);
  record("C18 no horizontal scroll", `${name}@${vp}`, (await overflow(page)) <= 0);
  record("C19 no host or raw error", `${name}@${vp}`, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED|401 from/.test(await page.locator("body").innerText()));
  return a;
}
const shot = (page, s, name) => page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}.png`), fullPage: s.name === "390" });

for (const [key, chip, phrase, open] of STATES) {
  stage = key;
  const name = SHOT[key] ?? key;
  await each(async (s) => {
    const { page } = await visit(s, key);
    const answer = await text(page, "[data-feature=answer]");
    record("C11 honest chip and answer", `${name}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === chip && answer.includes(phrase));
    const a = await perState(page, name, s.name);
    if (key === "calm") record("C15 calm paint (no bad or warn)", s.name, a.painted ? { n: a.painted, sample: a.paintedSample } : 0);
    if (open) record("C20 answer strip opens by itself", `${name}@${s.name}`, (await page.locator(`[data-row-id=${open}] [aria-expanded=true]`).count()) > 0 || (await page.locator("#st-pane h2").innerText()).toLowerCase() === open);
    if (s.name === "390") record("C21 tap targets", name, (await small(page)).join("|") || "ok");
    await shot(page, s, name);
    if (key === "calm") {
      // The same fixture with its Climate strip open: the AC-on, auto-off look.
      await openStrip(page, "climate");
      await shot(page, s, "ac-on-autooff");
      record("C21 tap targets", "ac-on-autooff", (await small(page)).join("|") || "ok");
      await perState(page, "ac-on-autooff", s.name);
    }
    await page.close();
  });
}

// Lock: the question cancels itself at 4 s; Yes writes once; a failed write shows plain words only.
stage = "lock";
await each(async (s) => {
  const { page, mock } = await visit(s, "calm", { hash: "#lock" });
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  record("C22 unlock asks first", s.name, await page.getByText("Unlock the front door?").isVisible());
  await perState(page, "lock-confirm", s.name);
  await shot(page, s, "lock-confirm");
  await page.clock.runFor(4_200);
  record("C23 the question cancels itself at 4 s", s.name, !(await page.getByText("Unlock the front door?").isVisible()) && mock.posts.length === 0);
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  await page.getByRole("button", { name: "Yes, unlock" }).click();
  await page.waitForTimeout(400);
  record("C24 one unlock write", s.name, mock.posts.filter((p) => p.action === "unlock").length === 1);
  await page.close();
});
await each(async (s) => {
  const { page } = await visit(s, "calm", { hash: "#lock", action: "fail" });
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  await page.getByRole("button", { name: "Yes, unlock" }).click();
  await page.waitForTimeout(600);
  record("C25 failed write has no raw text", s.name, !/10\.0\.0\.5|refused/.test(await page.locator("body").innerText()));
  await perState(page, "write-failed", s.name);
  await shot(page, s, "write-failed");
  await page.close();
});

// CL: Unlock is off when the lock is unavailable, and Lock and Unlock are both off while a lock write is in flight.
await guarded("CL", () =>
  each(async (s) => {
    const down = await visit(s, "lockDown", { hash: "#lock" });
    const unlock = down.page.getByRole("button", { name: "Unlock Front door" });
    record("CL lock unavailable: Unlock is off", s.name, { present: await unlock.count(), enabled: await down.page.locator('button:enabled[aria-label="Unlock Front door"]').count() });
    await down.page.close();
    const { page } = await visit(s, "calm", { hash: "#lock", action: "hold" });
    await page.getByRole("button", { name: "Unlock Front door" }).click();
    await page.getByRole("button", { name: "Yes, unlock" }).click();
    await page.waitForTimeout(500);
    const enabled = await page.evaluate(() => [...document.querySelectorAll("button:enabled")].filter((b) => /^(Lock|Unlock) /.test(b.getAttribute("aria-label") ?? "")).length);
    record("CL lock write in flight: Lock and Unlock are off", s.name, enabled === 0 ? "ok" : `${enabled} enabled`);
    await page.close();
  }),
);

// Stale: the poll starts failing after the first answer; every write goes off and the head keeps its height.
stage = "stale";
await each(async (s) => {
  const { page } = await visit(s, "calm", { hash: "#climate" });
  const before = await headBox(page);
  await page.unroute("**/api/ha/states");
  await page.route("**/api/ha/states", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.clock.runFor(6_500);
  await page.waitForTimeout(500);
  record("C26 stale chip", s.name, (await text(page, "[data-feature=chip]")).trim() === "Stale");
  record("C27 head height holds", s.name, Math.abs((await headBox(page)) - before) <= 24);
  record("C28 stale: every write is off", s.name, (await page.locator("button:enabled:text-matches('^(Lock|Unlock|−|\\\\+)$')").count()) === 0);
  await perState(page, "stale", s.name);
  await shot(page, s, "stale");
  await page.close();
});

// C12: under reduced motion nothing in main has a transition duration.
await guarded("C12", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { reduced: true });
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("main *")].filter((e) => getComputedStyle(e).transitionDuration.split(",").some((d) => parseFloat(d) > 0)).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`),
    );
    record("C12 reduced motion: transitions with a duration", s.name, moving.length ? { n: moving.length, sample: moving.slice(0, 3) } : 0);
    await page.close();
  }),
);

// C13: open every strip in turn on calm and look up every feature; expect n/n.
await guarded("C13", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    const found = {};
    for (const id of ["climate", "lock", "lights", "switches", "sensors"]) {
      await openStrip(page, id);
      for (const [name, strip, locate] of FEATURES) {
        if (strip === id || (strip === null && id === "climate")) found[name] = (await locate(page).first().isVisible().catch(() => false)) || found[name] === true;
      }
    }
    const n = Object.values(found).filter(Boolean).length;
    record("C13 every feature visible", s.name, { found: n, of: FEATURES.length, missing: FEATURES.map((f) => f[0]).filter((f) => !found[f]) });
    await page.close();
  }),
);

// The final records print even after failures, and on a runner kill.
function finish() {
  record("C14 page errors", "all", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none");
  record("C14 foreign requests", "all", foreignRequests.length ? [...new Set(foreignRequests)].join(" | ") : "none");
  console.log(JSON.stringify({ ...checks, diag }));
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (finish(), process.exit(1)));
await browser.close().catch(() => {});
finish();
