#!/usr/bin/env node
/* Captures the Orchestra page and settings card on the test stack (13 states, 1440x900 and 390x844)
 * and prints the numeric checks as one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/orchestra-shots.mjs
 *
 * Needs: the test stack with the orchestra-mock service up (docker-compose.test.yml), a FRESH stack
 * (shot 1 needs Orchestra unconfigured, and a token cannot be cleared from the UI), and Playwright,
 * which is not a dependency of this repo; run it where one is installed. The stack is a dev build with
 * no password hash, so the login page accepts any password and issues a real session cookie.
 * Both viewports run side by side, step by step, because the Orchestra settings are server state.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const MOCK_URL = process.env.MOCK_URL ?? "http://orchestra-mock:7420";
const UNREACHABLE_URL = "http://orchestra.invalid:7420";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000; // dev-server cold compile plus 2 x 10 s polls

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  sessions.push({ name, opts, context, page });
}

async function signIn({ page }) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill("x");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: SLOW }), page.locator('button[type="submit"]').click()]);
}

// Same-origin fetch from a page on BASE_URL, so the CSRF guard sees a normal browser write.
const setCfg = (page, body) =>
  page.evaluate(async (b) => (await fetch("/api/settings/system", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, body);

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const texts = (page, sel) => page.locator(sel).allTextContents().then((a) => a.map((t) => t.trim()));
const live = (page) => texts(page, "main [role=status]");
const leaks = (page) => page.evaluate(() => /mock-(mixed|empty|slow)|\bcost\b/i.test(document.body.innerText));
const small = (page) =>
  page.evaluate(() => [...document.querySelectorAll("main button, main a, main [role=button]")].filter((e) => e.getBoundingClientRect().height < 43.5).length);

async function goto(page, path, ready) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  if (ready) await ready(page).catch((e) => { throw new Error(`${path}: ${e.message}`); });
}
const text = (t) => (page) => page.getByText(t).first().waitFor({ timeout: SLOW });
const badges = (n) => (page) => page.locator("[data-state-badge]").nth(n - 1).waitFor({ timeout: SLOW });

// view + crop + page; 390 touch pages are never fullPage-shot (the resize drops touch emulation):
// the viewport is grown to the page height instead and pointer:coarse is re-checked afterwards.
async function shoot(s, key, crop) {
  const { page, name, opts } = s;
  const base = join(OUT_DIR, `orchestra-${key}-${name}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${base}-view.png` });
  if (crop) await page.locator(crop).first().screenshot({ path: `${base}-crop.png` });
  if (name === "390") {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 390, height: Math.min(h, 6000) });
    await page.waitForTimeout(250);
    record("pointerCoarseAfterResize", `${key}@390`, await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
    await page.screenshot({ path: `${base}-page.png` });
    await page.setViewportSize(opts.viewport);
  } else {
    await page.screenshot({ path: `${base}-page.png`, fullPage: true });
  }
  record("overflowPx", `${key}@${name}`, await overflow(page));
}

const each = (fn) => Promise.all(sessions.map(fn));

try {
  for (const s of sessions) await signIn(s);

  // 1 unconfigured (fresh stack)
  await each(async (s) => { await goto(s.page, "/orchestrators", text("Orchestra is not connected")); await shoot(s, "01-unconfigured"); });
  // 2 settings card unset
  await each(async (s) => { await goto(s.page, "/settings#access", text("Service URL")); await shoot(s, "02-settings-unset", "text=Service URL >> xpath=ancestor::div[contains(@class,'panel')]"); });

  // 3 save URL + mock-slow through the card, then catch the loading skeleton
  const first = sessions[0].page;
  await first.getByLabel("Service URL").fill(MOCK_URL);
  await first.getByLabel("Service token").fill("mock-slow");
  await first.locator(".panel", { has: first.getByLabel("Service URL") }).getByRole("button", { name: "Save" }).click();
  await first.getByText("saved").first().waitFor({ timeout: SLOW });
  await each(async (s) => {
    await s.page.goto(`${BASE_URL}/orchestrators`, { waitUntil: "commit" });
    await s.page.locator("[aria-busy=true]").first().waitFor({ timeout: SLOW });
    await shoot(s, "03-loading");
    await s.page.getByText("Connected.").first().waitFor({ timeout: SLOW });
  });
  // 4 settings card set
  await each(async (s) => { await goto(s.page, "/settings#access", text("Service URL")); await shoot(s, "04-settings-set", "text=Service URL >> xpath=ancestor::div[contains(@class,'panel')]"); });

  // 5 ok-mixed, collapsed (odip auto-expanded)
  await setCfg(first, { orchestraToken: "mock-mixed" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", badges(4));
    await shoot(s, "05-ok-mixed", "main");
    record("badgesMixed", s.name, await texts(s.page, "[data-state-badge]"));
    record("liveMixed", s.name, await live(s.page));
    record("noTokenOrCostText", `05@${s.name}`, !(await leaks(s.page)));
    if (s.name === "390") record("smallTargets390", "05", await small(s.page));
  });
  // 6 odip detail with the 300-char checkpoint
  await each(async (s) => {
    const cp = s.page.locator("[data-checkpoint]").first();
    await cp.waitFor({ timeout: SLOW });
    await shoot(s, "06-odip-detail", "article:has-text('odip')");
    record("checkpointLength", s.name, (await cp.textContent()).length);
    if (s.name === "390") record("smallTargets390", "06", await small(s.page));
  });
  // 6b no session cookie: fresh context
  await each(async (s) => {
    const ctx = await browser.newContext(s.opts);
    const p = await ctx.newPage();
    await p.goto(`${BASE_URL}/orchestrators`, { waitUntil: "domcontentloaded" });
    await p.getByText("This page needs a full sign-in", { exact: false }).first().waitFor({ timeout: SLOW }).catch(() => {});
    const t = await p.locator("body").innerText();
    record("loadFailed403", s.name, { url: p.url(), has403Sentence: t.includes("This page needs a full sign-in. The kiosk PIN does not open it.") });
    const keep = { ...s, page: p };
    await shoot(keep, "06b-load-failed");
    await ctx.close();
  });
  // 7 night-watch-orchestr expanded -> detail error
  await each(async (s) => {
    await goto(s.page, "/orchestrators", badges(4));
    await s.page.locator("article:has-text('night-watch-orchestr')").getByRole("button", { name: "Details" }).click();
    await s.page.getByText("no longer in the registry").first().waitFor({ timeout: SLOW });
    await shoot(s, "07-detail-error", "article:has-text('night-watch-orchestr')");
    if (s.name === "390") record("smallTargets390", "07", await small(s.page));
  });
  // 8 mock-empty
  await setCfg(first, { orchestraToken: "mock-empty" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", text("No orchestrators registered"));
    await shoot(s, "08-empty", "main");
    record("liveEmpty", s.name, await live(s.page));
  });
  // 9 wrong token
  await setCfg(first, { orchestraToken: "wrong" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", text("rejected the token"));
    await shoot(s, "09-unauthorized", "main");
    record("liveUnauthorized", s.name, await live(s.page));
    if (s.name === "390") record("smallTargets390", "09", await small(s.page));
  });
  // 10 stale: ok first, then the URL stops resolving, same tab
  await setCfg(first, { orchestraToken: "mock-mixed", orchestraUrl: MOCK_URL });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", badges(4));
    await s.page.waitForTimeout(11_000);
  });
  await setCfg(first, { orchestraUrl: UNREACHABLE_URL });
  await each(async (s) => {
    await s.page.getByText("is not answering").first().waitFor({ timeout: SLOW });
    await shoot(s, "10-unreachable-stale", "main");
    record("badgesStale", s.name, await texts(s.page, "[data-state-badge]"));
    record("liveStale", s.name, await live(s.page));
  });
  // 11 reload -> unreachable with nothing last-known
  await each(async (s) => {
    await s.page.reload({ waitUntil: "domcontentloaded" });
    await s.page.getByText("is not answering").first().waitFor({ timeout: SLOW });
    await shoot(s, "11-unreachable-cold", "main");
    record("cardsAfterReload", s.name, await s.page.locator("[data-state-badge]").count());
    record("liveCold", s.name, await live(s.page));
  });
  // 12 sidebar with Orchestra active (1440), 13 More sheet (390)
  {
    const d = sessions[0];
    await goto(d.page, "/orchestrators", text("is not answering"));
    await d.page.locator("aside").screenshot({ path: join(OUT_DIR, "orchestra-12-sidebar-1440-crop.png") });
    record("sidebarOrchestraActive", "1440", await d.page.locator("aside a[href='/orchestrators']").count());
    const m = sessions[1];
    await goto(m.page, "/orchestrators", text("is not answering"));
    const cell = m.page.locator("button[aria-haspopup=dialog]");
    record("moreCellText", "390", (await cell.textContent()).trim());
    await cell.click();
    await m.page.getByRole("dialog", { name: "More navigation" }).waitFor();
    await shoot(m, "13-more-sheet");
  }
} finally {
  for (const s of sessions) await s.context.close().catch(() => {});
  await browser.close();
}
console.log(JSON.stringify(checks));
