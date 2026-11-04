#!/usr/bin/env node
/* Motion PR captures and numeric checks. Prints one JSON object (key -> viewport -> value) on the last line; opens no
 * images itself. Shoots first, measures after; one bad step is recorded under FAIL and the next one runs.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/motion-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml, a dev build that accepts any password) and Playwright, which is not a
 * dependency of this repo; run it where one is installed. It reads the stack's own data: a check whose element the stack
 * does not have (nothing to prune, no widget with actions, nobody online) is recorded as { absent: true }, not a pass.
 * Only /api/auth/login is called besides the pages' own reads. No real host, PIN or secret appears here.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1280", viewport: { width: 1280, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 30_000;

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
let stage = "";
const guarded = (label, fn) => { stage = label; return fn().catch((e) => record("FAIL", stage, String(e?.message ?? e).split(/\r?\n/)[0])); };

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) sessions.push({ name, opts, context: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney" }) });
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => record("FAIL", `${stage}@${s.name}`, String(e?.message ?? e).split(/\r?\n/)[0]))));

/** A fresh page; reduced motion emulated before goto when asked. */
async function visit(s, path, { reduced = false } = {}) {
  const page = await s.context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${s.name}: ${e.message}`));
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
const present = (loc) => loc.count().then((n) => n > 0);

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

/** Opens the Home widget menu (and returns its trigger) or null when no tile on this stack has widget actions. */
async function homeMenu(page) {
  const trigger = page.locator('[data-feature="widget-actions"] button').first();
  return (await present(trigger)) ? trigger : null;
}

try {
  for (const s of sessions) {
    const login = await s.context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }

  // #1/#3 entrances: normal reads {opacity, transform}; reduced {opacity}; empty means the node was reused.
  await guarded("entrances", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const mode = reduced ? "reduced" : "normal";
        const dock = await visit(s, "/docker", { reduced });
        const prune = dock.locator('[data-feature^="prune-"]:not([disabled])').first();
        if (await present(prune)) {
          const runs = await runsAfterClick(dock, prune);
          record("confirmRuns-docker", `${s.name}-${mode}`, runs);
          if (!reduced) await shoot(dock, s, "docker-prune-confirm");
        } else record("confirmRuns-docker", `${s.name}-${mode}`, { absent: true });
        await dock.close();

        const home = await visit(s, "/", { reduced });
        const trigger = await homeMenu(home);
        if (trigger) {
          const open = await runsAfterClick(home, trigger);
          record("popRuns-home", `${s.name}-${mode}`, open);
          if (!reduced) await shoot(home, s, "home-menu");
          const item = home.getByRole("menuitem").first();
          if (await present(item)) record("confirmRuns-home", `${s.name}-${mode}`, await runsAfterClick(home, item));
        } else record("popRuns-home", `${s.name}-${mode}`, { absent: true });
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
          if (!el) return { absent: true };
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
      record("pill-home", s.name, await probe(home, ".hm-pill", "data-on", false));
      await home.close();
      const dock = await visit(s, "/docker?find=containers");
      record("pill-docker", s.name, await probe(dock, ".dk-new", "data-visible", false));
      await dock.close();
      const mc = await visit(s, "/minecraft");
      const players = mc.locator('[data-k="open-players"]');
      if (await present(players)) await players.click();
      record("pill-minecraft", s.name, await probe(mc, ".st-pill", "data-on", false));
      await mc.close();
    }),
  );

  // #4 the "saved" badges on /settings: toggling them moves the header, title and Save by 0 px.
  await guarded("saved", () =>
    each(async (s) => {
      const page = await visit(s, "/settings");
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

  // #5/F7 press: scale after 200 ms of holding, normal 0.98, reduced 1 or none.
  await guarded("press", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const page = await visit(s, "/docker", { reduced });
        const out = {};
        for (const [name, loc] of [["segment", page.locator("button[aria-pressed]").first()], ["button", page.locator("main button:not([aria-pressed]):not([disabled])").first()]]) {
          if (!(await present(loc))) { out[name] = { absent: true }; continue; }
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

  // F2: /resources Meter fill and Gauge ring, transition-property.
  await guarded("meters", () =>
    each(async (s) => {
      for (const reduced of [false, true]) {
        const page = await visit(s, "/resources", { reduced });
        const out = await page.evaluate(() => {
          const fill = document.querySelector("main .origin-left.rounded-full");
          const ring = document.querySelector("main svg circle[stroke-dashoffset]");
          return { fill: fill ? getComputedStyle(fill).transitionProperty : null, ring: ring ? getComputedStyle(ring).transitionProperty : null };
        });
        record("meters", `${s.name}-${reduced ? "reduced" : "normal"}`, out);
        await page.close();
      }
    }),
  );
} finally {
  await browser.close();
}

record("pageErrors", "all", pageErrors.slice(0, 5).length ? pageErrors.slice(0, 5) : 0);
console.log(JSON.stringify(checks));
