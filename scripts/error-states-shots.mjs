#!/usr/bin/env node
/* Hunt 13: error states on the container detail page and the Home Digest, every API call mocked.
 * States (each at 1440 and 390, a padded crop of the changed panel plus a -full page):
 *   detail-refresh-error  inspect succeeds once, then 500: the page stays, one "Couldn't refresh" line
 *   detail-stopped        stopped container: no graph, header CPU and Memory read the empty-sample dash
 *   detail-logs-error     logs GET 500: "Couldn't read logs." and never "no output"
 *   home-digest-error     /api/host 500 with no data: every Digest value is a dash
 * The /logs page error (fixed "Couldn't read logs from Docker.") is rendered on the server, so a browser route
 * mock cannot reach it; it is covered by a source test, and here only checked if the test stack happens to show it.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/error-states-shots.mjs
 *
 * Needs Playwright, which is not a dependency of this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ID = "ab12cd34ef56" + "0".repeat(52);
const NAME = "example-app";
const PAD = 16;

const inspect = (running) => ({
  id: ID, name: NAME, image: "example/app", created: "2026-10-01T00:00:00Z",
  state: { status: running ? "running" : "exited", running, startedAt: "2026-10-01T00:00:00Z", exitCode: 0, health: null, restartCount: 0, oomKilled: false },
  restartPolicy: "no", networkMode: "bridge", composeProject: null, composeService: null,
  ports: [], mounts: [], env: [], cmd: "start",
});
const LIST = {
  containers: [{ id: ID, name: NAME, image: "example/app", state: "running", status: "Up", ports: [], composeProject: null, composeService: null, tile: { url: null } }],
  groups: [], counts: { total: 1, running: 1, paused: 0, stopped: 0, restarting: 0, unhealthy: 0 },
};
const STATS = { cpuPercent: 40, memUsage: 2e9, memLimit: 4e9, memPercent: 50, rxBytes: 0, txBytes: 0, blkReadBytes: 0, blkWriteBytes: 0, pids: 20 };
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

/** Docker mock for the detail page. opts: running, inspectFailsAfter (calls), logsFail. */
async function mockDetail(page, { running = true, inspectFailsAfter = Infinity, logsFail = false } = {}) {
  let inspects = 0;
  await page.route("**/api/docker/containers**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/api/docker/containers")) return json(route, 200, LIST);
    if (pathname.endsWith(`/containers/${ID}`)) {
      inspects += 1;
      return inspects > inspectFailsAfter ? json(route, 500, { error: "HTTP 500" }) : json(route, 200, inspect(running));
    }
    if (pathname.endsWith("/stats")) return json(route, 200, { ...STATS, ts: Date.now() });
    if (pathname.endsWith("/logs")) return logsFail ? json(route, 500, { error: "HTTP 500" }) : json(route, 200, { logs: "line one\nline two" });
    return json(route, 200, {});
  });
}

/** Padded crop of the union of the given locators. Fails (returns false) when a fixed or sticky element covers it. */
async function crop(page, locators, file) {
  for (const l of locators) await l.first().scrollIntoViewIfNeeded();
  // Put the crop's top just below the sticky top bar (mobile header), clear of it and of the bottom nav.
  const top = Math.min(...(await Promise.all(locators.map(async (l) => (await l.first().boundingBox()).y))));
  const barH = await page.evaluate(([y, pad]) => {
    let h = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.top <= 1 && r.bottom < innerHeight / 2) h = Math.max(h, r.bottom);
    }
    window.scrollBy({ top: y - h - pad, behavior: "instant" });
    return h;
  }, [top, PAD]);
  const boxes = [];
  for (const l of locators) boxes.push(await l.first().boundingBox());
  const vp = page.viewportSize();
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - PAD);
  const y0 = Math.max(barH, Math.min(...boxes.map((b) => b.y)) - PAD);
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + PAD);
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + PAD);
  const covered = await page.evaluate(([a, b, c, d]) => {
    const hits = [];
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.left < c && r.right > a && r.top < d && r.bottom > b) hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    }
    return hits;
  }, [x0, y0, x1, y1]);
  await page.screenshot({ path: file, clip: { x: x0, y: y0 + 0, width: x1 - x0, height: y1 - y0 } });
  return covered;
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { name: vp, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext({ ...contextOptions, reducedMotion: "reduce" });
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);

    const run = async (state, setup, body) => {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      try {
        await setup(page);
        await body(page, async (locators) => {
          const covered = await crop(page, locators, join(OUT_DIR, `${state}-${vp}.png`));
          check(`${state} ${vp}: no fixed or sticky element covers the crop`, covered.length === 0, covered.join(", "));
        });
        await page.screenshot({ path: join(OUT_DIR, `${state}-${vp}-full.png`), fullPage: true });
        check(`${state} ${vp}: 0 page errors`, errors.length === 0, errors.join("; "));
      } catch (e) {
        check(`${state} ${vp}: state completed`, false, String(e?.message ?? e).split(/\r?\n/)[0]);
      } finally {
        await page.close();
      }
    };

    await run("detail-refresh-error", (p) => mockDetail(p, { inspectFailsAfter: 1 }), async (p, shot) => {
      await p.goto(`${BASE_URL}/containers/${ID}`, { waitUntil: "domcontentloaded" });
      const notice = p.locator("p[role=status]", { hasText: "Couldn't refresh." });
      await notice.waitFor({ timeout: 20_000 });
      check(`detail-refresh-error ${vp}: exact copy`, (await notice.innerText()).trim() === "Couldn't refresh. Showing the last update.");
      check(`detail-refresh-error ${vp}: page kept (name heading, no not-found)`, (await p.locator("h1").innerText()) === NAME && !(await p.getByText("Container not found").count()));
      // The first <header> is the mobile-only bar (hidden at 1440), so crop from the page heading instead.
      await shot([p.locator("h1").first(), notice]);
    });

    await run("detail-stopped", (p) => mockDetail(p, { running: false }), async (p, shot) => {
      await p.goto(`${BASE_URL}/containers/${ID}`, { waitUntil: "domcontentloaded" });
      const grid = p.locator("div.grid").first();
      await grid.waitFor({ timeout: 20_000 });
      await p.waitForTimeout(1500);
      const heads = await grid.locator("span.font-mono").allInnerTexts();
      check(`detail-stopped ${vp}: CPU, Memory and Network headers read the empty dash`, heads.length >= 3 && heads.slice(0, 3).every((t) => t.trim() === "—"), heads.join("|"));
      await shot([grid]);
    });

    await run("detail-logs-error", (p) => mockDetail(p, { logsFail: true }), async (p, shot) => {
      await p.goto(`${BASE_URL}/containers/${ID}`, { waitUntil: "domcontentloaded" });
      const notice = p.locator("p[role=status]", { hasText: "Couldn't read logs." });
      await notice.waitFor({ timeout: 20_000 });
      check(`detail-logs-error ${vp}: exact copy`, (await notice.innerText()).trim() === "Couldn't read logs.");
      check(`detail-logs-error ${vp}: never "no output"`, !(await p.locator(".logbox").innerText()).includes("no output"));
      await shot([notice, p.locator(".logbox")]);
    });

    await run("home-digest-error", async (p) => {
      await p.route("**/api/host", (route) => json(route, 500, { error: "HTTP 500" }));
    }, async (p, shot) => {
      const digest = p.locator('[data-feature="box-digest"]');
      await p.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await digest.waitFor({ timeout: 20_000 });
      await p.waitForTimeout(2500);
      const vals = await digest.locator(".hm-dg-v").allInnerTexts();
      check(`home-digest-error ${vp}: every value is a dash`, vals.length === 6 && vals.every((t) => t.trim() === "—"), vals.join("|"));
      await shot([digest]);
    });

    await context.close();
  }
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.pass).length;
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`${passed}/${checks.length} checks passed`);
// shots-json.sh reads the last line as JSON: a name maps to false when that check failed.
console.log(JSON.stringify(Object.fromEntries(checks.map((c) => [c.name, c.pass]))));
process.exit(passed === checks.length ? 0 : 1);
