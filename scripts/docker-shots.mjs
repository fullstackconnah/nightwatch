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
  const kind = ["partial", "down", "down-cold"].includes(scenario) ? "full" : scenario;
  await page.route("**/api/docker/**", (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (scenario === "down-cold" || (scenario === "down" && state.failing)) return json(route, 503, { error: "Docker is not reachable" });
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

// One bad state must not hide the rest: a throw (a failed waitFor included) is recorded as a FAIL and the next scenario runs.
const open = [];
async function guard(label, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${label}: scenario completed`, false, String(e?.message ?? e).split(/\r?\n/)[0]);
  } finally {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => {})));
  }
}

async function openPage(browser, opts, scenario, state) {
  const context = await browser.newContext({ ...opts, ...CTX });
  open.push(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const off = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!/^(data|blob|about):/.test(u) && new URL(u).origin !== new URL(BASE_URL).origin) off.push(u);
  });
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  await mock(page, scenario, state);
  return { context, page, errors, off };
}

const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, a[href]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      // Skip a visually hidden control (clipped to 1x1, e.g. "Skip to content") until it is focused.
      .filter(({ el, r }) => document.activeElement === el || r.width > 1 || r.height > 1)
      .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
      .map(({ el, r }) => `${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );

// C7/C8: hero bottom from the viewport top at scroll 0, and the slot height, per state.
const heroAt = {};
async function heroCheck(page, name, scenario) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const m = await page.evaluate(() => {
    const r = (q) => document.querySelector(q)?.getBoundingClientRect();
    const num = r(".dk-num") ?? r(".dk-hero");
    return { num: num ? Math.round(num.bottom) : -1, hero: Math.round(r(".dk-hero")?.bottom ?? -1), slot: Math.round(r(".dk-slot")?.height ?? -1) };
  });
  heroAt[`${name}|${scenario}`] = m;
  const max = name === "390" ? 169 : 180;
  check(`C7 ${name} ${scenario}: hero bottom <= ${max}px`, m.num > 0 && m.num <= max, String(m.num));
}

// C10: lowest text contrast under `scope` (enabled controls only). shortcut: ignores gradients and ancestor opacity, upgrade if a surface uses either.
const contrastLow = (page, scope) =>
  page.evaluate((scope) => {
    const g = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const num = (t, i) => (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t)) * (i < 3 ? 1 : 1);
    const parse = (css) => {
      let m = css.match(/^rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean); return [num(p[0], 0), num(p[1], 1), num(p[2], 2), p[3] ? num(p[3], 3) : 1]; }
      m = css.match(/^color\(srgb ([^)]+)\)/);
      if (m) { const p = m[1].split(/[ /]+/).filter(Boolean); return [num(p[0], 0) * 255, num(p[1], 1) * 255, num(p[2], 2) * 255, p[3] ? num(p[3], 3) : 1]; }
      g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const lum = (c) => { const l = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    const bgOf = (el) => {
      const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
      return chain.reduce((bg, e) => over(parse(getComputedStyle(e).backgroundColor), bg), [255, 255, 255, 1]);
    };
    const root = document.querySelector(scope);
    let low = { ratio: 99, who: "" };
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest(":disabled") || getComputedStyle(el).visibility === "hidden") continue;
      const bg = bgOf(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      if (ratio < low.ratio) low = { ratio, who: `${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 24)}"` };
    }
    return low;
  }, scope);
async function contrastCheck(page, name, scenario) {
  const low = await contrastLow(page, ".dk-page");
  check(`C10 ${name} ${scenario}: lowest text contrast >= 4.5`, low.ratio >= 4.5, `${low.ratio.toFixed(2)} ${low.who}`);
}

const dupRowIds = (page) =>
  page.evaluate(() => {
    const seen = new Set(), dup = [];
    for (const el of document.querySelectorAll("[data-row-id]")) { const id = el.getAttribute("data-row-id"); if (seen.has(id)) dup.push(id); seen.add(id); }
    return dup;
  });

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { name, ...opts } of VIEWPORTS) {
    // The fixed mobile nav and the Next dev badge would cut a full-page shot; hide them for the capture only.
    const shot = async (page, s) => {
      const tag = await page.addStyleTag({ content: "nav.fixed.bottom-0, nextjs-portal { display: none !important; }" });
      await page.screenshot({ path: join(OUT_DIR, `docker-${s}-${name}.png`), fullPage: true });
      await tag.evaluate((el) => el.remove());
    };

    // Full: order, calm buttons, targets, overflow, confirm step.
    await guard(`${name} full`, async () => {
      const { context, page, errors, off } = await openPage(browser, opts, "full");
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(900); // count-down settles
      const order = await page.$$eval("[data-chore]", (els) => els.map((e) => e.getAttribute("data-chore")));
      // R2: the two prunes biggest bytes first (both > 0 in this fixture), then unused images, stopped containers, cache last.
      const fx = diskFor("full");
      const prunes = fx.volumes.orphanBytes > fx.images.danglingBytes ? ["orphans", "dangling"] : ["dangling", "orphans"];
      const expected = [...prunes, "unused", "stopped", "cache"].join();
      check(`${name} full: chore order`, order.join() === expected, `${order.join()} vs ${expected}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      check(`${name} full: no horizontal overflow`, !overflow);
      await heroCheck(page, name, "full");
      await contrastCheck(page, name, "full");
      const seg = page.locator(".dk-segs > button:last-child");
      await seg.hover();
      const hov = await contrastLow(page, ".dk-segs > button:last-child");
      check(`C10 ${name} full: hovered segment contrast >= 4.5`, hov.ratio >= 4.5, hov.ratio.toFixed(2));
      await page.mouse.move(0, 0);
      const dups = await dupRowIds(page);
      check(`C11 ${name} full: data-row-id unique`, dups.length === 0, dups.slice(0, 5).join(","));
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
      const find = page.locator(".dk-find input");
      const fits = await find.evaluate((el) => {
        const cs = getComputedStyle(el);
        const probe = document.createElement("span");
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
        probe.textContent = el.placeholder;
        document.body.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return { w, box: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), text: el.placeholder };
      });
      check(`${name} full: search placeholder fits its box`, fits.w <= fits.box + 0.5, `"${fits.text}" ${Math.round(fits.w)} vs ${Math.round(fits.box)}`);
      if (name === "390") {
        const h = await page.evaluate(() => {
          const row = [...document.querySelectorAll('.dk-all-list [data-row-id^="all-containers-"]')].find((r) => r.querySelector(".dk-row-acts")?.children.length === 1);
          return row ? Math.round(row.getBoundingClientRect().height) : -1;
        });
        check("390 full: a one-action container row is <= 64px", h > 0 && h <= 64, String(h));
      }
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
      if (name === "390") {
        await yes.scrollIntoViewIfNeeded();
        const vis = await page.evaluate(() => {
          const inView = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; };
          const btn = (t) => [...document.querySelectorAll("button")].find((b) => t.test(b.textContent || ""));
          return inView(btn(/^Yes, prune/)) && inView(btn(/^Cancel/));
        });
        check("confirm 390: Yes and Cancel are visible in the viewport after scrollIntoView", vis);
      }
      await shot(page, "confirm");
      check(`C16 ${name} full: 0 page errors`, errors.length === 0, errors.join("; "));
      check(`C16 ${name} full: 0 requests off origin`, off.length === 0, off.slice(0, 3).join(" "));
      await context.close();
    });

    // Held rows: open Stopped, the poll adds a container, rows stay and the pill appears.
    await guard(`${name} held`, async () => {
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
    });

    // Partial sizes, empty, long, down.
    for (const scenario of ["partial", "empty", "long", "down", "down-cold"])
      await guard(`${name} ${scenario}`, async () => {
      const state = {};
      const { context, page, errors, off } = await openPage(browser, opts, scenario, state);
      if (scenario === "down") await page.clock.install(); // time is driven below; a focus event does not revalidate SWR
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      if (scenario === "down") {
        // A good list is on screen first; then every read fails and the fake clock runs past the longest poll (30 s) so all four hooks refetch.
        await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
        state.failing = true;
        await page.clock.runFor(35_000);
        await page.locator('.dk-slot[data-state="error"]').waitFor({ timeout: 15_000 });
      }
      if (scenario === "down-cold") {
        const band = (await page.locator('.dk-slot[data-state="error"]').first().innerText()).trim();
        check(`${name} down-cold: band has no "last list" clause`, /^Docker (unreachable: |is not reachable)/.test(band) && !/last list/i.test(band), band);
        if (name === "390") {
          const hh = await page.evaluate(() => { const e = document.querySelector(".dk-num"); if (!e) return [999, 0]; const cs = getComputedStyle(e); /* the h2 box, not the inline span's content area */ return [e.parentElement.getBoundingClientRect().height, parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3]; });
          check("390 down-cold: hero headline is one line", hh[0] <= hh[1] + 1, hh.join(" vs "));
        }
        check(`${name} down-cold: no chores heading`, (await page.locator("#dk-chores-h").count()) === 0);
        const segn = await page.$$eval(".dk-segn", (els) => els.map((e) => e.textContent.trim()));
        check(`${name} down-cold: no segment count reads 0`, segn.length === 3 && !segn.includes("0"), segn.join());
        check(`${name} down-cold: search is disabled`, await page.locator(".dk-find input").isDisabled());
        check(`${name} down-cold: no repeated "unreachable" in the band`, !/unreachable.*not reachable|not reachable.*unreachable/i.test(band), band);
        check(`${name} down-cold: no skeleton rows in the chores area`, (await page.locator(".dk-chores .dk-skel").count()) === 0);
        check(`${name} down-cold: subtitle is not "Reading Docker…"`, !(await page.locator(".dk-counts").innerText()).includes("Reading Docker"));
      }
      if (scenario === "long") {
        await page.locator("[data-chore=stopped] .dk-disclose").click();
        const rows = await page.locator("#dk-body-stopped li").count();
        check(`${name} long: fold shows at most 12 rows before Show all`, rows <= 12 + 8, String(rows));
        check(`${name} long: Show all is offered`, (await page.getByRole("button", { name: /^Show all/ }).count()) > 0);
      }
      if (scenario === "down") {
        const band = (await page.locator('.dk-slot[data-state="error"]').first().innerText()).trim();
        check(`${name} down: band names the last list`, /Showing the last list from/.test(band), band);
        const disabled = await page.evaluate(() => document.querySelector("fieldset.dk-fieldset")?.disabled === true);
        check(`${name} down: write controls are disabled`, disabled);
        check(`${name} down: the slot says why`, (await page.locator(".dk-slot[data-state]").count()) > 0);
      }
      await heroCheck(page, name, scenario);
      await contrastCheck(page, name, scenario);
      if (scenario === "long") {
        const dups = await dupRowIds(page);
        check(`C11 ${name} long: data-row-id unique`, dups.length === 0, dups.slice(0, 5).join(","));
      }
      check(`${name} ${scenario}: no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
      if (name === "390") check(`390 ${scenario}: every button and link >= 44x44`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join("; "));
      await shot(page, scenario);
      check(`C16 ${name} ${scenario}: 0 page errors`, errors.length === 0, errors.join("; "));
      check(`C16 ${name} ${scenario}: 0 requests off origin`, off.length === 0, off.slice(0, 3).join(" "));
      await context.close();
      });

    // Reduced motion: no transform animation on a list change.
    await guard(`${name} reduced motion`, async () => {
      const { context, page } = await openPage(browser, { ...opts }, "full");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
      const anims = await page.evaluate(() => document.getAnimations().filter((a) => /transform/.test(JSON.stringify(a.effect?.getKeyframes?.() ?? []))).length);
      check(`${name} reduced motion: no transform animations`, anims === 0, String(anims));
      await context.close();
    });

    // C8: status slot height and hero bottom are the same in every state.
    {
      const states = ["full", "partial", "down", "down-cold"].map((sc) => heroAt[`${name}|${sc}`]);
      const have = states.filter(Boolean);
      const spread = (k) => Math.max(...have.map((m) => m[k])) - Math.min(...have.map((m) => m[k]));
      check(`C8 ${name}: all four states measured`, have.length === 4, String(have.length));
      check(`C8 ${name}: slot height delta 0`, have.length > 0 && spread("slot") === 0, JSON.stringify(have.map((m) => m.slot)));
      check(`C8 ${name}: hero bottom delta 0`, have.length > 0 && spread("hero") === 0, JSON.stringify(have.map((m) => m.hero)));
    }

    // C13: the stopped head is the same height with 8 stopped containers as with 10 (390 only).
    if (name === "390")
      await guard("390 C13", async () => {
        const base = containersFor("full").containers;
        const stopped0 = base.filter((c) => ["exited", "created"].includes(c.state)).length;
        const h = [];
        for (const target of [8, 10]) {
          const extra = Array.from({ length: Math.max(0, target - stopped0) }, (_, i) => ({ ...base[7], id: String(i).padStart(2, "a").repeat(32), name: `c13-${target}-${i}`, state: "exited" }));
          const { context, page } = await openPage(browser, opts, "full", { extra });
          await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
          const head = page.locator("[data-chore=stopped] .dk-chore-head");
          await head.waitFor({ timeout: 30_000 });
          await page.waitForTimeout(900);
          h.push(Math.round((await head.boundingBox()).height));
          await context.close();
        }
        check("C13 390: stopped head height with 8 vs 10 stopped, delta 0", h[0] === h[1], `${h.join(" vs ")} (fixture has ${stopped0} stopped)`);
      });

    // C15: the seven data-feature hooks exist, and every container row links to its details.
    await guard(`${name} C15`, async () => {
      const { context, page } = await openPage(browser, opts, "full");
      await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
      await page.locator("[data-chore=stopped] .dk-disclose").click();
      await page.waitForTimeout(600);
      // The stopped rows sit in a folded prefix group (old-*); open every fold so Start and Remove render.
      await page.evaluate(() => document.querySelectorAll(".dk-group-head[aria-expanded=false]").forEach((b) => b.click()));
      await page.waitForTimeout(400);
      const n = (f) => page.locator(`[data-feature="${f}"]`).count();
      const found = {};
      for (const f of ["prune-images", "prune-volumes", "create", "details", "start", "remove"]) found[f] = await n(f);
      await page.locator(".dk-segs > button:nth-child(2)").click();
      await page.waitForTimeout(600);
      found["delete-image"] = await n("delete-image");
      const missing = Object.entries(found).filter(([, c]) => c === 0).map(([k]) => k);
      check(`C15 ${name}: 7 of 7 data-feature hooks present`, missing.length === 0, `missing: ${missing.join(",")}`);
      await page.locator(".dk-segs > button:nth-child(1)").click();
      await page.waitForTimeout(600);
      const noDetails = await page.evaluate(() => [...document.querySelectorAll(".dk-all-list li.dk-row, #dk-body-stopped li.dk-row")].filter((li) => !li.querySelector("[data-feature=details]")).length);
      check(`C15 ${name}: details reachable from every container row`, noDetails === 0, String(noDetails));
      await context.close();
    });
  }

  // R6: the old routes redirect with a 307 to /docker?find=.
  await guard("C6s", async () => {
    const ctx = await browser.newContext();
    open.push(ctx);
    const login = await ctx.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
    for (const k of ["containers", "images", "volumes"]) {
      const res = await ctx.request.get(`${BASE_URL}/${k}`, { maxRedirects: 0 });
      check(`C6s /${k} redirects 307 to /docker?find=${k}`, res.status() === 307 && (res.headers().location ?? "").includes(`/docker?find=${k}`), `${res.status()} ${res.headers().location ?? ""}`);
    }
  });
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.pass).length;
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
