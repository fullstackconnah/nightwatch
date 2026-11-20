#!/usr/bin/env node
/* Captures /networks on the test stack for branch fix/networks-polish (honest docker-read states) at 1440 and 390 and prints
 * the numeric checks as one JSON object on the last line (FAIL lines before it). Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/networks-shots.mjs
 *   SHOTS_ONLY=normal | nets-failed | nets-loading | containers-failed   (one state alone; nets-failed also reads the normal row heights first)
 *
 * Needs the test stack and Playwright, which is not a dependency of this repo; run it where one is installed.
 * Fails (rather than passing on zero rows) when the stack shows no bridge rows.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const STATES = ["normal", "nets-failed", "nets-loading", "containers-failed"];
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY;
const SLOW = 40_000;
const results = {};
const pageErrors = [];
let failed = 0;
const record = (key, where, value) => ((results[key] ??= {})[where] = value);
const check = (key, where, ok, value) => {
  record(key, where, ok ? value : `FAIL: ${JSON.stringify(value)}`);
  if (!ok) {
    failed++;
    console.log(`FAIL ${key} @ ${where}: ${JSON.stringify(value)}`);
  }
};
mkdirSync(OUT_DIR, { recursive: true });

const docOverflow = () => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(browser, vp, state, setup) {
  const context = await browser.newContext(vp);
  // The test stack's admin gate: same login as scripts/media-shots.mjs.
  await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${vp.name} ${state}: ${e.message}`));
  await setup?.(page);
  await page.goto(`${BASE_URL}/networks`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return { context, page };
}

// Padded crop (16 px, clamped to the page) of one element; fails when fixed or sticky chrome overlaps the crop rect.
// firstRows (narrow viewports): crop only the heading plus the first N "div.grid" rows, with the top parked under the sticky header.
const TOP_GAP = 96; // park the section top this far down: clears the 390 sticky header, plus the 16 px pad
const cropElement = async (page, loc, state, vpName, firstRows = 0) => {
  await loc.evaluate((el, { fr, gap }) => {
    el.scrollIntoView({ block: fr ? "start" : "center", behavior: "instant" });
    if (fr) scrollBy(0, -gap);
  }, { fr: firstRows, gap: TOP_GAP });
  const r = await loc.evaluate((el, fr) => {
    const t = el.getBoundingClientRect();
    const last = fr ? el.querySelectorAll("div.grid")[fr - 1] : null; // a panel with fewer rows (the empty footprint) is cropped whole
    const b = { left: t.left, top: t.top, width: t.width, height: last ? last.getBoundingClientRect().bottom - t.top : t.height };
    const pad = 16;
    const x = Math.max(0, b.left - pad), y = b.top - pad, w = Math.min(b.width + 2 * pad, innerWidth - x), h = b.height + 2 * pad;
    const over = [...document.querySelectorAll("body *")].filter((e) => {
      if (e.contains(el) || el.contains(e)) return false;
      const cs = getComputedStyle(e);
      if (cs.position !== "fixed" && cs.position !== "sticky") return false;
      const q = e.getBoundingClientRect();
      return q.width > 0 && q.height > 0 && q.left < x + w && q.right > x && q.top < y + h && q.bottom > y;
    }).map((e) => e.tagName.toLowerCase() + "." + String(e.className).slice(0, 30));
    return { clip: { x, y: Math.max(0, y + scrollY), width: w, height: h }, over, h };
  }, firstRows);
  check("crop not covered by fixed or sticky chrome", `${state}@${vpName}`, r.over.length === 0, r.over);
  if (firstRows) console.log(`crop ${state}@${vpName}: heading + ${firstRows} rows, ${Math.round(r.h)} px`);
  await page.screenshot({ path: join(OUT_DIR, `networks-${state}-${vpName}.png`), fullPage: true, clip: r.clip });
};

// The bridge list is the <section> whose heading line says "busiest first"; its rows are the grid divs.
const bridgeSection = (page) => page.locator("section", { has: page.getByText("busiest first", { exact: false }) }).last();
const bridgeRows = (page) => bridgeSection(page).locator("div.grid");
const footprint = (page) => page.locator(".panel", { has: page.getByText("Container footprint", { exact: true }) }).last();

async function readRows(page, where) {
  await bridgeSection(page).waitFor({ timeout: SLOW });
  const rows = bridgeRows(page);
  const n = await rows.count();
  // Zero rows would make every "none of the rows" check pass vacuously.
  check("bridge rows present", where, n > 0, { n });
  if (n === 0) throw new Error("no bridge rows on this stack; the checks cannot hold");
  return rows.evaluateAll((els) => els.map((e) => ({ text: e.innerText, h: e.getBoundingClientRect().height })));
}

// 390 only: below md the text block spans the full row, so line 3 (subnet + count) must not ellipse, and a name of
// 31 characters or fewer (homelab-dashboard-test_internal) must not either; longer names may truncate and keep their title.
async function clipChecks(page, where) {
  if (!where.endsWith("@390")) return;
  const r = await bridgeRows(page).evaluateAll((rows) => {
    const clipped = (el) => el.scrollWidth > el.clientWidth;
    const line3 = [];
    const names = [];
    for (const row of rows) {
      const block = row.firstElementChild;
      const l3 = block.querySelectorAll(":scope > div.truncate")[1];
      if (l3 && clipped(l3)) line3.push(l3.textContent.trim());
      const nm = block.querySelector("span.truncate");
      if (nm && clipped(nm)) names.push(nm.textContent.trim());
    }
    return { line3, names };
  });
  check("line 3 not clipped at 390", where, r.line3.length === 0, { clipped: r.line3.length, first: r.line3[0] ?? null });
  const short = r.names.filter((t) => t.length <= 31);
  check("name line not clipped at 390 (names of 31 characters or fewer)", where, short.length === 0, {
    clipped: r.names.length,
    clippedShort: short.length,
    first: short[0] ?? r.names[0] ?? null,
  });
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const run = async (state, fn, setup, crop, full) => {
      if (ONLY && ONLY !== state) return;
      const where = `${state}@${vp.name}`;
      let ctx;
      try {
        ctx = await open(browser, vp, state, setup);
        await fn(ctx.page, where);
        if (full) await ctx.page.screenshot({ path: join(OUT_DIR, `networks-${state}-${vp.name}-full.png`), fullPage: true });
        await cropElement(ctx.page, crop(ctx.page), state, vp.name, vp.name === "390" ? 4 : 0);
        const o = await ctx.page.evaluate(docOverflow);
        check("document overflow", where, o.scroll <= o.client, o);
      } catch (e) {
        check("state reached", where, false, String(e).slice(0, 200));
        await ctx?.page.screenshot({ path: join(OUT_DIR, `networks-${state}-FAIL-${vp.name}.png`), fullPage: true }).catch(() => {});
      } finally {
        await ctx?.context.close();
      }
    };

    // Row heights of the unmocked page; the failed state is compared against them row by row.
    let normalHeights = null;
    if (!ONLY || ONLY === "normal") {
      await run("normal", async (page, where) => {
        // The docker read answers after the section renders; the check below must not run on the loading rows.
        await bridgeSection(page).waitFor({ timeout: SLOW });
        await page.waitForFunction(
          () => ![...document.querySelectorAll("div.grid")].some((e) => e.innerText.includes("reading networks…")),
          null,
          { timeout: SLOW },
        );
        const info = await readRows(page, where);
        normalHeights = info.map((i) => i.h);
        const bad = info.filter((i) => /docker unavailable|reading networks…/.test(i.text)).length;
        check("no bridge row shows a docker-read placeholder", where, bad === 0, { bad, rows: info.length });
        await clipChecks(page, where);
      }, undefined, (page) => bridgeSection(page), true);
    } else if (ONLY === "nets-failed") {
      const ctx = await open(browser, vp, "normal-heights");
      try {
        normalHeights = (await readRows(ctx.page, `normal-heights@${vp.name}`)).map((i) => i.h);
      } catch (e) {
        check("state reached", `normal-heights@${vp.name}`, false, String(e).slice(0, 200));
      } finally {
        await ctx.context.close();
      }
    }

    await run("nets-failed", async (page, where) => {
      const info = await readRows(page, where);
      const missing = info.filter((i) => !i.text.includes("docker unavailable")).length;
      check("every bridge row says docker unavailable", where, missing === 0, { rows: info.length, missing });
      const stale = info.filter((i) => /not a docker network|subnet unknown/.test(i.text)).length;
      check("no bridge row claims not a docker network or subnet unknown", where, stale === 0, { stale });
      const diffs = info.map((i, k) => Math.abs(i.h - (normalHeights?.[k] ?? NaN)));
      const same = normalHeights !== null && normalHeights.length === info.length && diffs.every((d) => d <= 1);
      check("row height equals the normal state within 1 px", where, same, { maxDiff: Math.max(...diffs), rows: info.length, normalRows: normalHeights?.length ?? null });
      await clipChecks(page, where);
    }, (page) => page.route(/\/api\/docker\/networks(\?|$)/, (route) => json(route, { error: "unreachable" }, 502)), (page) => bridgeSection(page));

    // The route is held: never fulfilled, never continued, so the read stays loading for the whole capture.
    await run("nets-loading", async (page, where) => {
      const info = await readRows(page, where);
      const missing = info.filter((i) => !i.text.includes("reading networks…")).length;
      check("every bridge row says reading networks…", where, missing === 0, { rows: info.length, missing });
      const stale = info.filter((i) => i.text.includes("not a docker network")).length;
      check("no bridge row claims not a docker network", where, stale === 0, { stale });
      await clipChecks(page, where);
    }, (page) => page.route(/\/api\/docker\/networks(\?|$)/, () => new Promise(() => {})), (page) => bridgeSection(page));

    await run("containers-failed", async (page, where) => {
      const panel = footprint(page);
      await panel.waitFor({ timeout: SLOW });
      // The text depends on the first telemetry tick: wait until the panel stops saying it is waiting.
      await page.waitForFunction(() => !/Waiting for the first telemetry tick/.test(document.body.innerText), null, { timeout: SLOW });
      const text = await panel.innerText();
      check("footprint says it could not read the container list", where, text.includes("Could not read the container list"), text.slice(0, 120));
      check("footprint does not say no container traffic", where, !text.includes("No container traffic"), text.slice(0, 120));
    }, (page) => page.route(/\/api\/docker\/containers(\?|$)/, (route) => json(route, { error: "unreachable" }, 502)), (page) => footprint(page));
  }
} finally {
  await browser.close();
}
check("page errors", "all", pageErrors.length === 0, pageErrors.slice(0, 10));
// A mistyped SHOTS_ONLY would otherwise run the default sections and look green.
check("SHOTS_ONLY names a known state", "all", !ONLY || STATES.includes(ONLY), ONLY);
console.log(JSON.stringify({ failed, results }));
process.exit(failed ? 1 : 0);
