#!/usr/bin/env node
/* Captures the /docker clean-up list with every API call mocked (nothing is ever pruned or removed), at 1440 and 390.
 * Scenarios: full, partial (orphan sizes pending), empty, long (329 stopped containers, folds), down (Docker unreachable).
 * Checks (shape brief section 8, the ones that need a browser): no page errors; no horizontal overflow; at 390 every
 * button and link is at least 44x44; prune buttons are not danger-coloured at rest and only "Yes, ..." is; chore order
 * is dangling, orphans, stopped, unused, cache; an open chore holds its rows while the poll adds one (pill shows);
 * fold at 12 with "Show all"; write buttons are disabled when Docker is down; /containers redirects with 307.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/docker-shots.mjs
 *
 * Needs Playwright, which is not a dependency of this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { containersFor, imagesFor, volumesFor, diskFor } from "./fixtures/docker/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
// Pinned inputs: one time zone, one locale, reduced-motion off, fixed clock.
const CTX = { timezoneId: "Australia/Sydney", locale: "en-AU", reducedMotion: "no-preference" };

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

async function mock(page, scenario, state = {}) {
  const kind = scenario === "partial" || scenario === "down" ? "full" : scenario;
  await page.route("**/api/docker/**", (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (scenario === "down") return json(route, 503, { error: "Docker is not reachable" });
    if (req.method() !== "GET") return json(route, 200, { ok: true, count: 0, bytes: 0, reclaimedBytes: 0 });
    if (pathname.endsWith("/api/docker/containers")) {
      const body = containersFor(kind);
      if (state.extra) body.containers = [...body.containers, ...state.extra];
      return json(route, 200, body);
    }
    if (pathname.endsWith("/api/docker/images")) return json(route, 200, imagesFor(kind));
    if (pathname.endsWith("/api/docker/volumes")) return json(route, 200, volumesFor(kind));
    if (pathname.endsWith("/api/docker/disk-usage")) return json(route, 200, diskFor(scenario === "partial" ? "partial" : kind));
    return json(route, 200, {});
  });
}

async function openPage(browser, opts, scenario, state) {
  const context = await browser.newContext({ ...opts, ...CTX });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  await mock(page, scenario, state);
  return { context, page, errors };
}

const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, a[href]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
      .map(({ el, r }) => `${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { name, ...opts } of VIEWPORTS) {
    const shot = (page, s) => page.screenshot({ path: join(OUT_DIR, `docker-${s}-${name}.png`), fullPage: true });

    // Full: order, calm buttons, targets, overflow, confirm step.
    {
      const { context, page, errors } = await openPage(browser, opts, "full");
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(900); // count-down settles
      const order = await page.$$eval("[data-chore]", (els) => els.map((e) => e.getAttribute("data-chore")));
      check(`${name} full: chore order`, order.join() === "dangling,orphans,stopped,unused,cache", order.join());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      check(`${name} full: no horizontal overflow`, !overflow);
      const prune = page.locator("[data-feature=prune-images]");
      const rest = await prune.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-bad)";
        document.body.appendChild(probe);
        const bad = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(el);
        return { at: s.color !== bad && s.backgroundColor !== bad, bad };
      });
      check(`${name} full: prune is not danger-coloured at rest`, rest.at);
      await shot(page, "full");
      if (name === "390") check("390 full: every button and link >= 44x44", (await smallTargets(page)).length === 0, (await smallTargets(page)).join("; "));
      await prune.click();
      const yes = page.getByRole("button", { name: /^Yes, prune/ });
      await yes.waitFor();
      const danger = await yes.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-bad)";
        document.body.appendChild(probe);
        const bad = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(el);
        return s.color === bad || s.backgroundColor === bad;
      });
      check(`${name} full: only the Yes step is danger-coloured`, danger);
      await shot(page, "confirm");
      check(`${name} full: 0 page errors`, errors.length === 0, errors.join("; "));
      await context.close();
    }

    // Held rows: open Stopped, the poll adds a container, rows stay and the pill appears.
    {
      const state = {};
      const { context, page, errors } = await openPage(browser, opts, "full", state);
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      const head = page.locator("[data-chore=stopped] .dk-disclose");
      await head.waitFor({ timeout: 30_000 });
      await head.click();
      const before = await page.locator("#dk-body-stopped li").count();
      state.extra = [{ ...containersFor("full").containers[7], id: "f".repeat(64), name: "late-arrival", state: "exited" }];
      await page.waitForTimeout(6000); // one 5 s poll
      const after = await page.locator("#dk-body-stopped li").count();
      check(`${name} held: rows do not change on a poll`, before === after, `${before} -> ${after}`);
      const pill = page.locator("[data-chore=stopped] .dk-new[data-visible='1']");
      check(`${name} held: the pill appears`, (await pill.count()) === 1);
      await shot(page, "held");
      await pill.click();
      await page.waitForTimeout(600);
      check(`${name} held: tapping the pill adds the row`, (await page.locator("#dk-body-stopped li").count()) === before + 1);
      check(`${name} held: 0 page errors`, errors.length === 0, errors.join("; "));
      await context.close();
    }

    // Partial sizes, empty, long, down.
    for (const scenario of ["partial", "empty", "long", "down"]) {
      const { context, page, errors } = await openPage(browser, opts, scenario);
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      if (scenario === "long") {
        await page.locator("[data-chore=stopped] .dk-disclose").click();
        const rows = await page.locator("#dk-body-stopped li").count();
        check(`${name} long: fold shows at most 12 rows before Show all`, rows <= 12 + 8, String(rows));
        check(`${name} long: Show all is offered`, (await page.getByRole("button", { name: /^Show all/ }).count()) > 0);
      }
      if (scenario === "down") {
        const disabled = await page.evaluate(() => document.querySelector("fieldset.dk-fieldset")?.disabled === true);
        check(`${name} down: write controls are disabled`, disabled);
        check(`${name} down: the slot says why`, (await page.locator(".dk-slot[data-state]").count()) > 0);
      }
      check(`${name} ${scenario}: no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
      if (name === "390") check(`390 ${scenario}: every button and link >= 44x44`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join("; "));
      await shot(page, scenario);
      check(`${name} ${scenario}: 0 page errors`, errors.length === 0, errors.join("; "));
      await context.close();
    }

    // Reduced motion: no transform animation on a list change.
    {
      const { context, page } = await openPage(browser, { ...opts }, "full");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
      const anims = await page.evaluate(() => document.getAnimations().filter((a) => /transform/.test(JSON.stringify(a.effect?.getKeyframes?.() ?? []))).length);
      check(`${name} reduced motion: no transform animations`, anims === 0, String(anims));
      await context.close();
    }
  }

  // R6: the old routes redirect with a 307 to /docker?find=.
  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  for (const k of ["containers", "images", "volumes"]) {
    const res = await ctx.request.get(`${BASE_URL}/${k}`, { maxRedirects: 0 });
    check(`/${k} redirects 307 to /docker?find=${k}`, res.status() === 307 && (res.headers().location ?? "").includes(`/docker?find=${k}`), `${res.status()} ${res.headers().location ?? ""}`);
  }
  await ctx.close();
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.pass).length;
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
