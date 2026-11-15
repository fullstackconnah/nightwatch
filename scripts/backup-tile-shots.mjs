#!/usr/bin/env node
/* Captures the Home side panel's ODIP backup tile on the test stack, once per fixture
 * state. Run it with the stack's ODIP_BACKUP_STATUS_PATH pointing at one of
 * scripts/fixtures/backup-status/*.json (or at a path that doesn't exist, for
 * STATE=missing); the route reads the file per request, so swapping the file
 * between runs is enough. STATE=loading holds /api/backup open instead, and
 * STATE=fetch-failed answers it with a 500.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots STATE=ok node scripts/backup-tile-shots.mjs
 *
 * Restore drill states (mock data: the real route's answer with `drill` swapped in):
 *   DRILL=all  runs never, today, 1, 90 and 91 days in one run, so the numeric checks can compare them
 *   DRILL=91   one state (use it with STATE=missing for tile-missing-drill-due)
 * Writes tile-<state>-<viewport>.png crops and tile-summary-<STATE>.json with every check; the
 * exit code is 1 when a check fails.
 *
 * Needs Playwright >= 1.45 (page.clock). Playwright is not a dependency of
 * this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const STATE = process.env.STATE ?? "ok";
const DRILL = process.env.DRILL ?? "";
// The fixtures are stamped around this moment. Pinning the browser clock keeps
// every age and the 26 h "check is old" rule the same whatever day this runs.
const FIXED_NOW = process.env.FIXED_NOW ?? "2026-10-15T12:00:00+11:00";
const TODAY = "2026-10-15"; // the display-zone day of FIXED_NOW

const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

// The drill object the route would send, per days since the drill; capture names follow the shape brief.
const dayIso = (daysAgo) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
const DRILLS = {
  none: { label: "never", drill: { testedOn: null, today: TODAY } },
  0: { label: "today", drill: { testedOn: TODAY, today: TODAY } },
  1: { label: "1-day", drill: { testedOn: dayIso(1), today: TODAY } },
  90: { label: "90", drill: { testedOn: dayIso(90), today: TODAY } },
  91: { label: "91", drill: { testedOn: dayIso(91), today: TODAY } },
};
const DRILL_KEYS = DRILL === "all" ? ["none", "0", "1", "90", "91"] : DRILL ? DRILL.split(",") : [];
const stateName = (key) => (STATE === "missing" ? "missing-drill-due" : `${STATE}-${DRILLS[key].label}`);

mkdirSync(OUT_DIR, { recursive: true });

/** Runs in the page: boxes of the two list rows, the drill row's own measures, and text contrast. */
function measure() {
  const tile = document.querySelector('section[aria-labelledby="backup-tile-title"]');
  const t = tile.getBoundingClientRect();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: +(r.x - t.x).toFixed(1), y: +(r.y - t.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = "#000";
    cv.fillStyle = css;
    cv.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  // Composite every ancestor background, root first, over white; the tile has no gradient or image behind its text.
  const backdrop = (el) => {
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.unshift(getComputedStyle(n).backgroundColor);
    return chain.reduce(
      (base, css) => {
        const [r, g, b, a] = rgba(css);
        return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      },
      [255, 255, 255],
    );
  };
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (el) => {
    const bg = backdrop(el);
    const [r, g, b, a] = rgba(getComputedStyle(el).color);
    const fg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  const lis = [...tile.querySelectorAll("ul li")].map(box);
  const label = [...tile.querySelectorAll("span")].find((s) => s.textContent === "Restore drill");
  const out = { lis, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, row: null };
  if (label) {
    const row = label.parentElement;
    const value = label.nextElementSibling;
    const badge = value.nextElementSibling;
    out.row = {
      box: box(row),
      value: value.textContent,
      valueTitle: value.title || null,
      valueFits: value.scrollWidth <= value.clientWidth,
      labelOk: label.scrollWidth <= label.clientWidth || getComputedStyle(label).textOverflow === "ellipsis",
      badge: badge ? badge.textContent : null,
      valueContrast: contrast(value),
      badgeContrast: badge ? contrast(badge) : null,
      dot: row.querySelector(".dot").className,
    };
  }
  return out;
}

const summary = { state: STATE, viewports: {}, checks: [] };
const check = (name, pass, detail) => {
  summary.checks.push({ name, pass, detail });
  console.log(`CHECK ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
  if (!pass) process.exitCode = 1;
};
const same = (a, b) => a.length === b.length && a.every((p, i) => Object.keys(p).every((k) => Math.abs(p[k] - b[i][k]) <= 0.5));

const browser = await chromium.launch({ headless: true });
try {
  for (const { name, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(FIXED_NOW));

    // The test stack is a dev build, which accepts any non-empty password.
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);

    let current = DRILL_KEYS[0];
    if (STATE === "loading") await page.route("**/api/backup", () => {}); // never answered
    else if (STATE === "fetch-failed") await page.route("**/api/backup", (route) => route.fulfill({ status: 500, body: "{}" }));
    else if (DRILL_KEYS.length) {
      await page.route("**/api/backup", async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), drill: DRILLS[current].drill } });
      });
    }

    const open = async () => {
      // Never "networkidle": the dashboard keeps polling.
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      // The dev overlay and the bottom nav sit over the tile in a crop.
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}${name === "390" ? "nav.fixed.bottom-0{display:none!important}" : ""}` });
      const tile = page.getByRole("region", { name: "ODIP backup" });
      await tile.waitFor({ timeout: 30_000 });
      if (STATE !== "loading") await tile.getByText("reading backup status…").waitFor({ state: "detached", timeout: 30_000 });
      await tile.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      return tile;
    };
    const crop = async (tile, file) => {
      const b = await tile.boundingBox();
      const pad = 12;
      await page.screenshot({ path: join(OUT_DIR, file), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad } });
    };

    if (!DRILL_KEYS.length) {
      const tile = await open();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`${STATE} @ ${name}: horizontal overflow ${overflow}px`);
      await page.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-view.png`) });
      await tile.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-tile.png`) });
      await page.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-page.png`), fullPage: true });
      if (STATE === "loading" || STATE === "fetch-failed") await crop(tile, `tile-${STATE}-${name}.png`);
      await context.close();
      continue;
    }

    const results = {};
    for (const key of DRILL_KEYS) {
      current = key;
      const tile = await open();
      results[key] = await page.evaluate(measure);
      await crop(tile, `tile-${stateName(key)}-${name}.png`);
    }
    summary.viewports[name] = results;

    // 1. No layout shift: the two list rows keep their boxes whatever the drill row says.
    const ref = results[DRILL_KEYS[0]].lis;
    check(`1 no layout shift @ ${name}`, DRILL_KEYS.every((k) => same(ref, results[k].lis)) && (STATE === "missing" || ref.length === 2), { ref });
    for (const key of DRILL_KEYS) {
      const r = results[key];
      const tag = `${stateName(key)} @ ${name}`;
      check(`row present ${tag}`, r.row !== null);
      if (!r.row) continue;
      // 2. The drill row is one list row tall (when the file is readable, so the tile has its own rows).
      if (r.lis.length) check(`2 row height ${tag}`, Math.abs(r.row.box.h - r.lis[0].h) <= 1, { drill: r.row.box.h, li: r.lis[0].h });
      // 3. No clipped text and no sideways scroll.
      check(`3 no clipped text ${tag}`, r.row.valueFits && r.row.labelOk && r.overflowX <= 0, { valueFits: r.row.valueFits, labelOk: r.row.labelOk, overflowX: r.overflowX });
      // 5. Contrast of the value text and the Badge, at least 4.5:1.
      check(`5 contrast ${tag}`, r.row.valueContrast >= 4.5 && (r.row.badgeContrast === null || r.row.badgeContrast >= 4.5), { value: r.row.valueContrast, badge: r.row.badgeContrast });
      // 6. Not colour alone: a due drill says DUE.
      const want = key === "91" ? "DUE" : key === "none" ? null : "OK";
      check(`6 badge word ${tag}`, r.row.badge === want, { badge: r.row.badge, value: r.row.value });
    }
    await context.close();
  }
} finally {
  await browser.close();
  if (DRILL_KEYS.length) {
    writeFileSync(join(OUT_DIR, `tile-summary-${STATE}.json`), JSON.stringify({ ...summary, allPass: summary.checks.every((c) => c.pass) }, null, 2));
  }
}
