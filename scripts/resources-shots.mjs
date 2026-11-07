#!/usr/bin/env node
/* Captures /resources on the test stack for PR #73 (polish/resources-1) at 390x844 and 1440x900 and prints the numeric
 * checks as one JSON object on the last line (FAIL lines before it). Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/resources-shots.mjs
 *
 * Needs the test stack and Playwright, which is not a dependency of this repo; run it where one is installed.
 * States: cpu, mem (both widths: 2-decimal CPU values, muted-label contrast >= 4.5), all-other (390: the "other" name is
 * not clipped), legend-nodata (a compare with no samples; skip when the stack has none), all-filter (poll keeps focus and
 * the group count). scan-lost and growth-more (mocked APIs, hunt 12: the poll stops with the lost line; 5 series plus the
 * "+2 more mounts" note). Every state: no pageerror, no document overflow.
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

// In-page colour helpers, copied from the earlier out-of-repo shots script.
const COLOUR = `(() => {
  const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  window.__rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  window.__over = (f, bg) => [0, 1, 2].map((i) => f[i] * f[3] + bg[i] * (1 - f[3]));
  window.__bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(window.__rgba(getComputedStyle(e).backgroundColor)); let acc = [0, 0, 0]; for (let i = chain.length - 1; i >= 0; i--) acc = window.__over(chain[i], acc); return acc; };
  const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  window.__contrast = (fg, bg) => { const a = lum(fg), c = lum(bg); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); };
  window.__textContrast = (el) => { const bg = window.__bgOf(el); const fg = window.__over(window.__rgba(getComputedStyle(el).color), bg); return +window.__contrast(fg, bg).toFixed(2); };
})()`;

const docOverflow = () => {
  const r = document.documentElement;
  return { scroll: r.scrollWidth, client: r.clientWidth };
};
// Muted labels of the watchlist panel: smallest computed text contrast (colour only; an ancestor opacity is not applied).
const mutedContrast = () => {
  const sel = "section.wl-panel .microlabel, section.wl-panel .text-ink-faint, section.wl-panel .text-ink-dim";
  const els = [...document.querySelectorAll(sel)].filter(
    (e) => e.textContent.trim() && e.getBoundingClientRect().width && getComputedStyle(e).visibility !== "hidden",
  );
  const v = els.map((e) => window.__textContrast(e));
  return { n: els.length, min: v.length ? Math.min(...v) : null };
};
const cpuValues = () =>
  [...document.querySelectorAll("section.wl-panel .wl-val, section.wl-panel .wl-dval")]
    .map((e) => e.textContent.trim())
    .filter((t) => /^[\d.]+%$/.test(t));

async function open(browser, vp, query, setup) {
  const context = await browser.newContext(vp);
  // The test stack's admin gate: same login as scripts/media-shots.mjs.
  await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${vp.name} ${query}: ${e.message}`));
  await setup?.(page);
  await page.goto(`${BASE_URL}/resources?${query}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(COLOUR);
  return { context, page };
}
// Padded crop (16 px, clamped to the page) of one element; fails when fixed or sticky chrome overlaps the crop rect.
const cropElement = async (page, loc, state, vpName) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const r = await loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const pad = 16;
    const x = Math.max(0, b.left - pad), y = b.top - pad, w = Math.min(b.width + 2 * pad, innerWidth - x), h = b.height + 2 * pad;
    const over = [...document.querySelectorAll("body *")].filter((e) => {
      if (e.contains(el) || el.contains(e)) return false;
      const cs = getComputedStyle(e);
      if (cs.position !== "fixed" && cs.position !== "sticky") return false;
      const q = e.getBoundingClientRect();
      return q.width > 0 && q.height > 0 && q.left < x + w && q.right > x && q.top < y + h && q.bottom > y;
    }).map((e) => e.tagName.toLowerCase() + "." + String(e.className).slice(0, 30));
    return { clip: { x, y: Math.max(0, y + scrollY), width: w, height: h }, over };
  });
  check("crop not covered by fixed or sticky chrome", `${state}@${vpName}`, r.over.length === 0, r.over);
  await page.screenshot({ path: join(OUT_DIR, `resources-${state}-${vpName}.png`), fullPage: true, clip: r.clip });
};
const finish = async (page, state, vpName, crop) => {
  await page.screenshot({ path: join(OUT_DIR, `resources-${state}-${vpName}${crop ? "-full" : ""}.png`), fullPage: true });
  if (crop) await cropElement(page, crop(page), state, vpName);
  const o = await page.evaluate(docOverflow);
  check("document overflow", `${state}@${vpName}`, o.scroll <= o.client, o);
};

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
// Answers /api/resources with the real snapshot, but one fake host disk that carries `mounts` (placeholders only).
const withDisk = (mounts) => async (page) => {
  await page.route(/\/api\/resources(\?|$)/, async (route) => {
    const body = await route.fetch().then((r) => r.json()).catch(() => ({}));
    json(route, { ...body, hostDisks: [{ mount: mounts[0], total: 1e12, used: 5e11, percent: 50, mounts }] });
  });
};
const DISK_SCAN = { label: "/mnt/test", scannedAt: Date.now(), durationMs: 900, entries: [{ name: "media", bytes: 5e11, kind: "dir", path: "/mnt/test/media" }], otherBytes: 0, path: "/mnt/test", unaccountedBytes: 0, unreadableBytes: 0, deniedCount: 0, readablePct: 100, usedBytes: 5e11, totalBytes: 1e12, partial: false, error: null };
const GROWTH_MOUNTS = ["/", "/mnt/a", "/mnt/b", "/mnt/c", "/mnt/d", "/mnt/e", "/mnt/f"];

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    // Each state fails on its own: one FAIL line plus a capture, and the loop goes on.
    const run = async (state, query, fn, setup, crop) => {
      let ctx;
      try {
        ctx = await open(browser, vp, query, setup);
        await fn(ctx.page);
        await finish(ctx.page, state, vp.name, crop);
      } catch (e) {
        check("state reached", `${state}@${vp.name}`, false, String(e).slice(0, 200));
        await ctx?.page.screenshot({ path: join(OUT_DIR, `resources-${state}-FAIL-${vp.name}.png`), fullPage: true }).catch(() => {});
      } finally {
        await ctx?.context.close();
      }
    };

    for (const metric of ["cpu", "mem"]) {
      await run(metric, `metric=${metric}`, async (page) => {
        await page.locator("section.wl-panel .wl-item").first().waitFor({ timeout: SLOW });
        await page.waitForTimeout(1500);
        if (metric === "cpu") {
          const vals = await page.evaluate(cpuValues);
          const bad = vals.filter((t) => !/^\d+\.\d{2}%$/.test(t));
          check("cpu values 2 decimals", `${metric}@${vp.name}`, vals.length > 0 && !bad.length, { n: vals.length, bad: bad.slice(0, 5) });
        }
        const c = await page.evaluate(mutedContrast);
        check("muted label contrast >= 4.5", `${metric}@${vp.name}`, c.n > 0 && c.min >= 4.5, c);
      });
    }

    if (vp.name === "390") {
      await run("all-other", "metric=all&q=other", async (page) => {
        const name = page.locator(".pt-grow > .pt-name", { hasText: "other" }).first();
        await name.waitFor({ timeout: SLOW });
        const m = await name.evaluate((el) => {
          // Lines = distinct text-rect tops; a Range over the text works whatever line-height resolves to (incl. `normal`).
          const range = document.createRange();
          range.selectNodeContents(el);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          return {
            clipped: el.scrollWidth > el.clientWidth + 1,
            lines: tops.size,
            rowH: Math.round(el.closest(".pt-grow").getBoundingClientRect().height),
          };
        });
        check("other name not clipped, <= 2 lines", "all-other@390", !m.clipped && m.lines <= 2, m);
      });
    }

    // Legend: compare a row that has no samples, if the stack has one (rows marked wl-hatch).
    await run("legend-nodata", "metric=cpu", async (page) => {
      await page.locator("section.wl-panel .wl-item").first().waitFor({ timeout: SLOW });
      const empty = page.locator("section.wl-panel .wl-item", { has: page.locator(".wl-hatch") }).first();
      if (!(await empty.count())) {
        record("legend no-data", `legend-nodata@${vp.name}`, "skip: no watchlist row without samples on this stack, so no empty compare can be picked");
        return;
      }
      await empty.locator(".wl-rowbtn").click();
      await empty.locator(".wl-compare").click();
      await page.waitForTimeout(1500);
      const legend = await page.evaluate(() => [...document.querySelectorAll("div.flex-wrap > div > .microlabel")].map((e) => e.textContent.trim()));
      check("legend shows no data", `legend-nodata@${vp.name}`, legend.includes("no data"), legend);
    });

    // Hunt 12: a scan GET that answers 404 shows the lost line, keeps the button and stops polling.
    const scanGets = [];
    await run("scan-lost", "metric=disk", async (page) => {
      await page.route(/\/api\/resources\/disk-usage/, (route) => json(route, DISK_SCAN));
      await page.route(/\/api\/resources\/scan\/largest-files/, (route) => {
        if (route.request().method() === "POST") return json(route, { id: "j1", kind: "largest-files", root: "/mnt/test", state: "running", progress: { entriesScanned: 0 }, result: null, error: null, startedAt: Date.now(), finishedAt: null });
        scanGets.push(Date.now());
        return json(route, { error: "no job found" }, 404);
      });
      await page.locator('button[aria-controls="disk-contents-/mnt/test"]').click({ timeout: SLOW });
      const find = page.getByRole("button", { name: /Find largest files/ });
      await find.click({ timeout: SLOW });
      const line = page.getByText("Scan status lost. Run the scan again.");
      await line.waitFor({ timeout: SLOW });
      await page.waitForTimeout(300);
      const before = scanGets.length;
      await page.waitForTimeout(3000);
      check("scan-lost line and button visible", `scan-lost@${vp.name}`, (await line.isVisible()) && (await find.isVisible()), null);
      check("scan-lost poll stopped (GETs in 3 s)", `scan-lost@${vp.name}`, scanGets.length === before, { extra: scanGets.length - before });
    }, withDisk(["/mnt/test"]), (page) => page.locator("div.space-y-2", { has: page.getByText("LARGEST FILES", { exact: true }) }).last());

    // Hunt 12: 7 mounts with real growth: 5 series drawn, the rest named in a note, the fastest-growing line shown.
    await run("growth-more", "metric=disk", async (page) => {
      const growth = page.locator(".panel", { has: page.getByText("DISK GROWTH", { exact: true }) }).last();
      await growth.getByText("+2 more mounts not shown").waitFor({ timeout: SLOW });
      await growth.getByText(/fastest growing/).waitFor({ timeout: SLOW });
      const series = await growth.locator('svg[viewBox="0 0 600 140"] path').count();
      check("growth chart draws 5 series", `growth-more@${vp.name}`, series === 5, { series });
    }, async (page) => {
      await withDisk(GROWTH_MOUNTS)(page);
      await page.route(/\/api\/resources\/growth/, (route) => {
        const now = Date.now();
        const asked = new URL(route.request().url()).searchParams.get("mounts");
        const only = asked ? asked.split(",") : GROWTH_MOUNTS;
        const mounts = Object.fromEntries(GROWTH_MOUNTS.filter((m) => only.includes(m)).map((m, i) => [m, Array.from({ length: 24 }, (_, k) => ({ t: now - (23 - k) * 3_600_000, usedBytes: (i + 1) * 1e10 + k * (i + 1) * 1e8 }))]));
        return json(route, { recordingSince: now - 3 * 86_400_000, mounts });
      });
    }, (page) => page.locator(".panel", { has: page.getByText("DISK GROWTH", { exact: true }) }).last());

    await run("all-filter", "metric=all", async (page) => {
      const items = page.locator(".pt-item");
      await items.first().waitFor({ timeout: SLOW });
      const input = page.locator(".pt-input");
      await input.click();
      await input.pressSequentially("a", { delay: 80 });
      await page.waitForTimeout(500);
      const before = await items.count();
      await page.waitForTimeout(2500); // one poll
      const after = await items.count();
      const focused = await input.evaluate((el) => el === document.activeElement);
      check("filter keeps focus over a poll", `all-filter@${vp.name}`, focused, { focused });
      record("filter group count", `all-filter@${vp.name}`, { before, after });
    });
  }
} finally {
  await browser.close();
}
check("page errors", "all", pageErrors.length === 0, pageErrors.slice(0, 10));
console.log(JSON.stringify({ failed, results }));
process.exit(failed ? 1 : 0);
