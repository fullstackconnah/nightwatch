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
  ["jammed", "Lock jammed", "The front door lock is jammed.", "lock"],
  ["deviceDown", "Partial", "Lounge isn’t answering.", "lights"],
  ["lowBattery", "Connected", "Door sensor battery is at 14%.", null],
  ["noAutoOff", "Connected", "Front door locked. 1 of 4 ACs on.", null],
];

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];
let stage = "";
const fail = (vp, e) => record("FAIL", `${stage}@${vp}`, String(e?.message ?? e).split(/\r?\n/)[0]);

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) sessions.push({ name, context: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney" }) });
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));

function watch(page, name) {
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreignRequests.push(`${name}: ${new URL(u).origin}`);
  });
}

async function visit(s, key, { hash = "", action = "ok" } = {}) {
  const fx = FIXTURES[key];
  const page = await s.context.newPage();
  const mock = { fx, action, posts: [] };
  watch(page, s.name);
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/ha/states", (route) => (fx.ha === "hang" ? undefined : json(route, fx.ha)));
  await page.route("**/kiosk/api/climate-auto-off", (route) => (fx.autoOff === "fail" ? json(route, { error: "x" }, 500) : json(route, fx.autoOff)));
  await page.route("**/api/ha/action", (route) => {
    mock.posts.push(route.request().postDataJSON());
    return mock.action === "fail" ? json(route, { error: "upstream said 10.0.0.5 refused" }, 502) : json(route, { ok: true });
  });
  await page.clock.install({ time: NOW });
  await page.goto(`${BASE_URL}/smarthome${hash}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
  if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
  await page.waitForTimeout(500);
  return { page, mock };
}

const text = (page, sel) => page.locator(sel).first().innerText();
const headBox = async (page) => (await page.locator("[data-feature=head]").boundingBox())?.height ?? 0;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button:not(:disabled), a[href]")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 44 && r.width < 44)
      .map(({ el }) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)),
  );

for (const [key, chip, phrase, open] of STATES) {
  stage = key;
  await each(async (s) => {
    const { page } = await visit(s, key);
    record("C1 chip", `${key}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === chip);
    record("C2 answer", `${key}@${s.name}`, (await text(page, "[data-feature=answer]")).includes(phrase));
    record("C3 no horizontal scroll", `${key}@${s.name}`, (await overflow(page)) <= 0);
    const body = await page.locator("body").innerText();
    record("C5 no host or raw error", `${key}@${s.name}`, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED|401 from/.test(body));
    if (open) record("C6 answer strip opens by itself", `${key}@${s.name}`, (await page.locator(`[data-row-id=${open}] [aria-expanded=true]`).count()) > 0 || (await page.locator("#st-pane h2").innerText()).toLowerCase() === open);
    if (s.name === "390") record("C7 tap targets", key, (await small(page)).join("|") || "ok");
    await page.screenshot({ path: join(OUT_DIR, `${key}-${s.name}.png`), fullPage: s.name === "390" });
    await page.close();
  });
}

// Lock: the question cancels itself at 4 s; Yes writes once; a failed write shows plain words only.
stage = "lock";
await each(async (s) => {
  const { page, mock } = await visit(s, "calm", { hash: "#lock" });
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  record("C8 unlock asks first", s.name, await page.getByText("Unlock the front door?").isVisible());
  await page.clock.runFor(4_200);
  record("C9 the question cancels itself at 4 s", s.name, !(await page.getByText("Unlock the front door?").isVisible()) && mock.posts.length === 0);
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  await page.getByRole("button", { name: "Yes, unlock" }).click();
  await page.waitForTimeout(400);
  record("C10 one unlock write", s.name, mock.posts.filter((p) => p.action === "unlock").length === 1);
  await page.close();
});
await each(async (s) => {
  const { page } = await visit(s, "calm", { hash: "#lock", action: "fail" });
  await page.getByRole("button", { name: "Unlock Front door" }).click();
  await page.getByRole("button", { name: "Yes, unlock" }).click();
  await page.waitForTimeout(600);
  record("C11 failed write has no raw text", s.name, !/10\.0\.0\.5|refused/.test(await page.locator("body").innerText()));
  await page.close();
});

// Stale: the poll starts failing after the first answer; every write goes off and the head keeps its height.
stage = "stale";
await each(async (s) => {
  const { page } = await visit(s, "calm", { hash: "#climate" });
  const before = await headBox(page);
  await page.unroute("**/api/ha/states");
  await page.route("**/api/ha/states", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.clock.runFor(6_500);
  await page.waitForTimeout(500);
  record("C12 stale chip", s.name, (await text(page, "[data-feature=chip]")).trim() === "Stale");
  record("C13 head height holds", s.name, Math.abs((await headBox(page)) - before) <= 24);
  record("C14 stale: every write is off", s.name, (await page.locator("button:enabled:text-matches('^(Lock|Unlock|−|\\\\+)$')").count()) === 0);
  await page.screenshot({ path: join(OUT_DIR, `stale-${s.name}.png`), fullPage: s.name === "390" });
  await page.close();
});

await browser.close();
record("C15 page errors", "all", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none");
record("C16 foreign requests", "all", foreignRequests.length ? [...new Set(foreignRequests)].join(" | ") : "none");
console.log(JSON.stringify(checks));
