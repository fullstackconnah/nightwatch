#!/usr/bin/env node
/* Motion PR captures and numeric checks. Prints one JSON object (key -> viewport -> value) on the last line; opens no
 * images itself. Shoots first, measures after; one bad step is recorded under FAIL and the next one runs.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/motion-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml, a dev build that accepts any password) and Playwright, which is not a
 * dependency of this repo; run it where one is installed. Every /api call the pages make is answered from the script
 * (scripts/fixtures/motion/fixtures.mjs, real response shapes, placeholder names): a path with no fixture answers 503,
 * and every write (POST/PUT/DELETE...) answers a mocked 200 and is counted in `writesMocked`. The only real request
 * besides page loads is POST /api/auth/login on the test stack. No real host, PIN or secret appears here.
 *
 * A target that is missing is recorded as { missing: "<selector>" } and makes the last line's `ok` false: a check that
 * found nothing proves nothing.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { read, WRITE_OK } from "./fixtures/motion/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1280", viewport: { width: 1280, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 30_000;

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
let ok = true;
let writesMocked = 0;
const record = (key, vp, value) => {
  if (JSON.stringify(value).includes('"missing"')) ok = false;
  ((checks[key] ??= {})[vp] = value);
};
const missing = (selector) => ({ missing: selector });
const pageErrors = [];
let stage = "";
const fail = (vp, e) => { ok = false; record("FAIL", vp, String(e?.message ?? e).split(/\r?\n/)[0]); };
const guarded = (label, fn) => { stage = label; return fn().catch((e) => fail(stage, e)); };

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) sessions.push({ name, opts, context: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney" }) });
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(`${stage}@${s.name}`, e))));

/** Answers every /api call from the fixtures: reads by path, writes with a counted mocked 200. */
async function mockApi(page) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() !== "GET") { writesMocked++; return json(200, WRITE_OK); }
    const body = read(new URL(req.url()).pathname);
    return body === undefined ? json(503, { error: "not mocked" }) : json(200, body);
  });
}

/** A fresh page; reduced motion emulated before goto when asked. */
async function visit(s, path, { reduced = false } = {}) {
  const page = await s.context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${s.name}: ${e.message}`));
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: SLOW });
  await page.waitForTimeout(1_200);
  return page;
}
const shoot = async (page, s, name) => {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, `motion-${name}-${s.name}.png`) });
};
/** True when the locator shows up within 8 s (attached, not visible: the pills and badges rest at opacity 0). */
const present = (loc) => loc.first().waitFor({ state: "attached", timeout: 8_000 }).then(() => true, () => false);

/** The spec's recorder: propertyName of every transitionrun on .nw-confirm / .nw-pop, collected across one click. */
async function runsAfterClick(page, clickable) {
  await page.evaluate(() => {
    window.__runs = new Set();
    document.addEventListener("transitionrun", (e) => {
      if (e.target instanceof Element && e.target.matches(".nw-confirm, .nw-pop")) window.__runs.add(e.propertyName);
    });
  });
  await clickable.click();
  await page.waitForTimeout(50);
  return (await page.evaluate(() => [...window.__runs])).sort();
}

const HOME_TRIGGER = '[data-feature="widget-actions"] button';

try {
  for (const s of sessions) {
    const login = await s.context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }

  // #1/#3 entrances: normal reads {opacity, transform}; reduced {opacity}; empty means the node was reused.
  await guarded("entrances", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const mode = `${s.name}-${reduced ? "reduced" : "normal"}`;
        const dock = await visit(s, "/docker", { reduced });
        const prune = dock.locator('[data-feature^="prune-"]:not([disabled])');
        if (await present(prune)) {
          const runs = await runsAfterClick(dock, prune.first());
          record("confirmRuns-docker", mode, runs);
          if (!reduced) await shoot(dock, s, "docker-prune-confirm");
        } else record("confirmRuns-docker", mode, missing('[data-feature^="prune-"]'));
        await dock.close();

        const home = await visit(s, "/", { reduced });
        const trigger = home.locator(HOME_TRIGGER);
        if (await present(trigger)) {
          record("popRuns-home", mode, await runsAfterClick(home, trigger.first()));
          if (!reduced) await shoot(home, s, "home-menu");
          const item = home.getByRole("menuitem");
          if (await present(item)) record("confirmRuns-home", mode, await runsAfterClick(home, item.first()));
          else record("confirmRuns-home", mode, missing("[role=menuitem]"));
        } else record("popRuns-home", mode, missing(HOME_TRIGGER));
        await home.close();
      }
    }),
  );

  // #2 the pills: flipping the attribute moves nothing (0 px) and hidden reads opacity 0.
  await guarded("pills", () =>
    each(async (s) => {
      const probe = (page, sel, attr, on) =>
        page.evaluate(({ sel, attr, on }) => {
          const el = document.querySelector(sel);
          if (!el) return { missing: sel };
          const row = el.parentElement;
          const box = () => ({ pill: el.getBoundingClientRect().toJSON(), row: row.getBoundingClientRect().toJSON(), next: row.nextElementSibling?.getBoundingClientRect().top ?? null });
          const set = (v) => (attr === "data-on" ? (v ? el.setAttribute("data-on", "") : el.removeAttribute("data-on")) : el.setAttribute("data-visible", v ? "1" : "0"));
          set(false);
          const a = box();
          const hiddenOpacity = getComputedStyle(el).opacity;
          set(true);
          const b = box();
          set(on);
          const d = (x, y) => Math.max(Math.abs(x.top - y.top), Math.abs(x.left - y.left), Math.abs(x.width - y.width), Math.abs(x.height - y.height));
          return { pillPx: d(a.pill, b.pill), rowPx: d(a.row, b.row), nextPx: a.next == null ? null : Math.abs(a.next - b.next), hiddenOpacity };
        }, { sel, attr, on });
      const home = await visit(s, "/");
      await present(home.locator(".hm-pill"));
      record("pill-home", s.name, await probe(home, ".hm-pill", "data-on", false));
      await home.close();
      // The Docker pill lives in an open clean-up strip: open the first one that has members.
      const dock = await visit(s, "/docker");
      const disclose = dock.locator(".dk-disclose");
      if (await present(disclose)) {
        await disclose.first().click();
        await present(dock.locator(".dk-new"));
        record("pill-docker", s.name, await probe(dock, ".dk-new", "data-visible", false));
      } else record("pill-docker", s.name, missing(".dk-disclose"));
      await dock.close();
      const mc = await visit(s, "/minecraft");
      const players = mc.locator('[data-k="open-players"]');
      if (await present(players)) {
        await players.first().click();
        await present(mc.locator(".st-pill"));
        record("pill-minecraft", s.name, await probe(mc, ".st-pill", "data-on", false));
      } else record("pill-minecraft", s.name, missing('[data-k="open-players"]'));
      await mc.close();
    }),
  );

  // #4 the "saved" badges on /settings: toggling them moves the header, title and Save by 0 px.
  await guarded("saved", () =>
    each(async (s) => {
      const page = await visit(s, "/settings");
      if (!(await present(page.locator(".nw-fade")))) {
        record("saved", s.name, missing(".nw-fade"));
        await page.close();
        return;
      }
      const m = () =>
        page.evaluate(() => {
          const badges = [...document.querySelectorAll(".nw-fade")];
          return badges.map((b) => {
            const card = b.closest(".panel, [class*=card]") ?? b.parentElement;
            const head = b.parentElement;
            const title = head.firstElementChild?.getBoundingClientRect();
            const save = [...card.querySelectorAll("button")].find((x) => /^\s*Save/.test(x.textContent ?? ""))?.getBoundingClientRect();
            return { headH: head.getBoundingClientRect().height, titleTop: title?.top ?? null, saveTop: save?.top ?? null, saveLeft: save?.left ?? null, wrapped: head.getBoundingClientRect().height > 44 + 40 };
          });
        });
      const off = await m();
      await page.evaluate(() => document.querySelectorAll(".nw-fade").forEach((b) => b.setAttribute("data-on", "")));
      await page.waitForTimeout(300);
      await shoot(page, s, "settings-saved");
      const on = await m();
      const diff = (k) => Math.max(0, ...off.map((o, i) => (o[k] == null || on[i][k] == null ? 0 : Math.abs(o[k] - on[i][k]))));
      record("saved", s.name, { badges: off.length, headerPx: diff("headH"), titlePx: diff("titleTop"), savePx: Math.max(diff("saveTop"), diff("saveLeft")), restHeaders: off.map((o) => Math.round(o.headH)), wrapped: off.filter((o) => o.wrapped).length });
      await page.close();
    }),
  );

  // #5/F7 press: scale after 250 ms of holding, normal 0.98, reduced 1 or none. The control is scrolled into view first:
  // a mouse press below the fold (the 390 px layout) lands on nothing and reads the resting scale.
  await guarded("press", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const page = await visit(s, "/docker", { reduced });
        const out = {};
        for (const [name, sel] of [["segment", ".dk-segs button[aria-pressed]"], ["button", "main button:not([aria-pressed]):not([disabled])"]]) {
          const loc = page.locator(sel).first();
          if (!(await present(loc))) { out[name] = missing(sel); continue; }
          await loc.scrollIntoViewIfNeeded();
          const box = await loc.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(250);
          out[name] = await loc.evaluate((e) => getComputedStyle(e).scale);
          await page.mouse.move(0, 0); // release off the control: no click
          await page.mouse.up();
        }
        record("press", `${s.name}-${reduced ? "reduced" : "normal"}`, out);
        await page.close();
      }
    }),
  );

  // F2: /resources Meter fill, transition-property. The Gauge ring renders on no route today (VitalsStrip is unused, kiosk
  // vitals are always compact), so there is no ring to measure; the Meter sits in an opened watchlist row.
  await guarded("meters", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const page = await visit(s, "/resources", { reduced });
        await page.locator(".wl-rowbtn").first().click({ timeout: 8_000 });
        await present(page.locator(".wl-detail .origin-left.rounded-full"));
        const out = await page.evaluate(() => {
          const fill = document.querySelector(".wl-detail .origin-left.rounded-full");
          return fill ? getComputedStyle(fill).transitionProperty : { missing: ".wl-detail .origin-left.rounded-full" };
        });
        record("meters", `${s.name}-${reduced ? "reduced" : "normal"}`, { fill: out });
        if (!reduced) await shoot(page, s, "resources");
        await page.close();
      }
    }),
  );
} finally {
  await browser.close();
}

record("pageErrors", "all", pageErrors.slice(0, 5).length ? pageErrors.slice(0, 5) : 0);
console.log(JSON.stringify({ ...checks, writesMocked, ok }));
