#!/usr/bin/env node
/* Captures /resources on the test stack for PR #73 (polish/resources-1) at 390x844 and 1440x900 and prints the numeric
 * checks as one JSON object on the last line (FAIL lines before it). Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/resources-shots.mjs
 *
 * Needs the test stack and Playwright, which is not a dependency of this repo; run it where one is installed.
 * States: cpu, mem (both widths: 2-decimal CPU values, muted-label contrast >= 4.5), all-other (390: the "other" name is
 * not clipped), legend-nodata (a compare with no samples; skip when the stack has none), all-filter (poll keeps focus and
 * the group count). SHOTS_ONLY=load-failed runs only the /api/resources failed-load states (Disk and Net tabs, mocked 500, and
 * the ready SYSTEM=1 / volumes lines; 14 checks per width, R5/R6 the retry line). scan-lost and growth-more (mocked APIs, hunt 12: the poll stops with the lost line; 5 series plus the
 * "+2 more mounts" note). SHOTS_ONLY=scan-root: an unreadable scan root (largest files, duplicates) shows the failed line and a pinned scan with an error shows "error" not "0 B" (13 checks per width; the alert keeps its letter case, a pinned error's reason is visible text; states scan-error-largest, scan-error-duplicates, pinned-error). Every state: no pageerror, no document overflow.
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
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY; // "hint-pages" runs only the transcode-streams failure states (mocked /api/transcodes)
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

// hint-pages (nw-widgets-hint-other-pages): the GPU view's TRANSCODE STREAMS block when /api/transcodes fails.
const TX_STREAM = { id: "s1", title: "Demo Film", user: "demo", client: "Jellyfin Web", device: "Chrome", playMethod: "Transcode", isVideoTranscode: true, isAudioTranscode: false, hardwareAccel: true, hardwareAccelType: "nvenc", videoFrom: "hevc", videoTo: "h264", audioFrom: null, audioTo: null, width: 1920, height: 1080, bitrate: 8e6, fps: 24, completionPct: 40, reasons: [] };
const TX_STALE = "Sessions may be out of date; the last refresh failed.";
const HP_PER_WIDTH = 7; // 3 (B2) + 2 (B3) + 2 (B4)
let hpRan = 0, hpPass = 0;
const hp = (key, where, ok, value) => { hpRan++; if (ok) hpPass++; check(key, where, ok, value); };
const txBlock = (page) => page.locator("div.space-y-2", { has: page.getByText("TRANSCODE STREAMS", { exact: true }) }).last();
const txRoute = (mode) => (page) => page.route(/\/api\/transcodes(\?|$)/, (route) => (mode.fail ? json(route, { error: "unreachable" }, 500) : json(route, { ok: true, streams: [TX_STREAM] })));
async function hintPages(run, w) {
  const b2 = { fail: true };
  await run("hint-b2", "metric=gpu", async (page) => {
    const b = txBlock(page);
    await b.getByText("Transcode telemetry failed").waitFor({ timeout: SLOW });
    const t = await b.innerText();
    hp("B2 headline and fixed detail", `hint-b2@${w}`, t.includes("Transcode telemetry failed") && t.includes("The dashboard didn't answer."), t.slice(0, 160));
    hp("B2 no reading line", `hint-b2@${w}`, !t.includes("reading transcode sessions"), t.slice(0, 160));
    hp("B2 no stale line", `hint-b2@${w}`, !t.includes(TX_STALE), t.slice(0, 160));
  }, txRoute(b2), txBlock);
  const b3 = { fail: false };
  await run("hint-b3", "metric=gpu", async (page) => {
    const b = txBlock(page);
    await b.getByText("Demo Film").first().waitFor({ state: "attached", timeout: SLOW });
    b3.fail = true; // refresh now fails: SWR keeps the list
    await page.waitForTimeout(5300);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await b.getByText(TX_STALE).waitFor({ timeout: SLOW });
    hp("B3 exactly one stale line", `hint-b3@${w}`, (await b.getByText(TX_STALE).count()) === 1, null);
    hp("B3 kept list still shown", `hint-b3@${w}`, (await b.getByText("Demo Film").count()) > 0, null);
  }, txRoute(b3), txBlock);
  const b4 = { fail: false };
  await run("hint-b4", "metric=gpu", async (page) => {
    const b = txBlock(page);
    await b.getByText("Demo Film").first().waitFor({ state: "attached", timeout: SLOW });
    hp("B4 no stale line", `hint-b4@${w}`, (await b.getByText(TX_STALE).count()) === 0, null);
    hp("B4 no reading line", `hint-b4@${w}`, (await b.getByText("reading transcode sessions").count()) === 0, null);
  }, txRoute(b4), txBlock);
}

// load-failed (nw-resources-load-failed): Net and Disk tabs when /api/resources has not answered (mocked 500) or answered with/without volumes.
const RF_PER_WIDTH = 14; // 5 (R1) + 4 (R2) + 1 (R3) + 2 (R4) + 2 (R5, R6: retry line)
let rfRan = 0, rfPass = 0;
const rf = (key, where, ok, value) => { rfRan++; if (ok) rfPass++; check(key, where, ok, value); };
const SYSTEM_LINE = "volume sizes need SYSTEM=1 on the socket proxy";
const rfAlert = (page) => page.locator('[role="alert"]', { hasText: "Docker did not answer" });
const rfVolumes = (page) => page.locator(".panel", { has: page.getByText("Volumes", { exact: true }) }).last();
const rfHeader = (page) => page.locator("header p.microlabel").first();
const rfFail = (page) => page.route(/\/api\/resources(\?|$)/, (route) => json(route, { error: "unreachable" }, 500));
// Real snapshot with `volumes` replaced (null = proxy without SYSTEM=1).
const rfVolumesAre = (volumes) => (page) =>
  page.route(/\/api\/resources(\?|$)/, async (route) => {
    const body = await route.fetch().then((r) => r.json()).catch(() => ({}));
    json(route, { ...body, volumes });
  });
async function loadFailed(run, w) {
  await run("failed", "metric=disk", async (page) => {
    await rfAlert(page).first().waitFor({ timeout: SLOW });
    rf("R1 no SYSTEM=1 line", `failed@${w}`, (await page.getByText(SYSTEM_LINE).count()) === 0, null);
    rf("R1 header has no '0 containers'", `failed@${w}`, !(await rfHeader(page).innerText()).includes("0 containers"), await rfHeader(page).innerText());
    rf("R1 exactly one error block", `failed@${w}`, (await rfAlert(page).count()) === 1, await rfAlert(page).count());
    rf("R1 header line is exactly unavailable", `failed@${w}`, (await rfHeader(page).innerText()).trim().toLowerCase() === "unavailable", await rfHeader(page).innerText());
    rf("R1 block has no box band clause", `failed@${w}`, !(await rfAlert(page).first().innerText()).includes("box band above"), null);
    // nw-resources-polish-2 item C: "every 10 s" is joined by U+00A0 and the paragraph's last line is not an orphan.
    const rt = await rfAlert(page).first().evaluate((root) => {
      const p = root.querySelector("p");
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode()) && !node.data.includes("Retrying every"));
      if (!node) return { found: false };
      const i = node.data.indexOf("10");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(p, p.childNodes.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const top = Math.max(...rects.map((r) => r.top));
      const last = rects.filter((r) => r.top >= top - 1);
      return { found: true, nbsp: node.data[i - 1] === " " && node.data[i + 2] === " ", lastLine: Math.round(Math.max(...last.map((r) => r.right)) - Math.min(...last.map((r) => r.left))) };
    });
    rf("R5 'every 10 s' joined by U+00A0", `failed@${w}`, rt.found && rt.nbsp, rt);
    rf("R6 last line wider than 60px", `failed@${w}`, rt.found && rt.lastLine > 60, rt);
  }, rfFail, (page) => rfAlert(page).first());
  await run("load-failed-net", "metric=net", async (page) => {
    await rfAlert(page).first().waitFor({ timeout: SLOW });
    rf("R2 exactly one error block", `load-failed-net@${w}`, (await rfAlert(page).count()) === 1, await rfAlert(page).count());
    rf("R2 header has no '0 containers'", `load-failed-net@${w}`, !(await rfHeader(page).innerText()).includes("0 containers"), await rfHeader(page).innerText());
    rf("R2 header line is exactly unavailable", `load-failed-net@${w}`, (await rfHeader(page).innerText()).trim().toLowerCase() === "unavailable", await rfHeader(page).innerText());
    rf("R2 block has no box band clause", `load-failed-net@${w}`, !(await rfAlert(page).first().innerText()).includes("box band above"), null);
  }, rfFail, (page) => rfAlert(page).first());
  await run("load-ready-null-volumes", "metric=disk", async (page) => {
    await page.getByText(SYSTEM_LINE).waitFor({ timeout: SLOW });
    rf("R3 SYSTEM=1 line present", `load-ready-null-volumes@${w}`, (await page.getByText(SYSTEM_LINE).count()) === 1, null);
  }, rfVolumesAre(null), rfVolumes);
  await run("load-ready-volumes", "metric=disk", async (page) => {
    await page.getByText("demo_vol", { exact: true }).waitFor({ timeout: SLOW });
    rf("R4 no SYSTEM=1 line", `load-ready-volumes@${w}`, (await page.getByText(SYSTEM_LINE).count()) === 0, null);
    rf("R4 no error block", `load-ready-volumes@${w}`, (await rfAlert(page).count()) === 0, null);
  }, rfVolumesAre([{ name: "demo_vol", sizeBytes: 2e9 }]), rfVolumes);
}

// scan-root (nw-scan-unreadable-root): an unreadable scan root shows as a failed job, an errored pinned scan shows "error", not "0 B".
const SR_PER_WIDTH = 13; // S1 4 + S2 4 + S3 4 + S4 1 (nw-resources-polish-2: case kept, reason visible)
let srRan = 0, srPass = 0;
const sr = (key, where, ok, value) => { srRan++; if (ok) srPass++; check(key, where, ok, value); };
// Mixed case on purpose: the alert must keep it (a microlabel renders uppercase).
const SR_GONE = "cannot read /mnt/Media/Gone: ENOENT: no such file or directory, scandir '/mnt/Media/Gone'";
const SR_PIN_REASON = "readdir failed: ENOENT: no such file or directory, scandir '/mnt/Media/pin-bad'";
const srJob = (kind) => ({ id: "j1", kind, root: "/mnt/gone", state: "error", progress: { entriesScanned: 0 }, result: null, error: SR_GONE, startedAt: Date.now(), finishedAt: Date.now() });
const srScanRoutes = (kind) => async (page) => {
  await withDisk(["/mnt/gone"])(page);
  await page.route(/\/api\/resources\/disk-usage/, (route) => json(route, { ...DISK_SCAN, label: "/mnt/gone", path: "/mnt/gone" }));
  await page.route(new RegExp(`/api/resources/scan/${kind}`), (route) => json(route, srJob(kind)));
};
const srPinCell = (page, path) => page.locator(`span[title="${path}"]`).locator("xpath=following-sibling::span[1]");
const srOverflow = async (page) => { const o = await page.evaluate(docOverflow); return { ok: o.scroll <= o.client, o }; };
async function scanRoot(run, w) {
  const job = (state, kind, label, empty, btn) =>
    run(state, "metric=disk", async (page) => {
      await page.locator('button[aria-controls="disk-contents-/mnt/gone"]').click({ timeout: SLOW });
      await page.getByRole("button", { name: btn }).click({ timeout: SLOW });
      const alert = page.locator('[role="alert"]', { hasText: "cannot read /mnt/Media/Gone" });
      await alert.waitFor({ timeout: SLOW });
      sr(`${label} alert text is whole and keeps its case`, `${state}@${w}`, (await alert.first().textContent()).trim() === SR_GONE, await alert.first().textContent());
      const tt = await alert.first().evaluate((el) => getComputedStyle(el).textTransform);
      sr(`${label} alert text-transform is none`, `${state}@${w}`, tt === "none", tt);
      sr(`${label} no clean-result line`, `${state}@${w}`, (await page.getByText(empty).count()) === 0, null);
      const o = await srOverflow(page);
      sr(`${label} no horizontal overflow`, `${state}@${w}`, o.ok, o.o);
    }, srScanRoutes(kind), (page) => page.locator('[role="alert"]', { hasText: "cannot read /mnt/Media/Gone" }).first());
  await job("scan-error-largest", "largest-files", "S1", /no files found/i, /Find largest files/);
  await job("scan-error-duplicates", "duplicates", "S2", /no likely duplicates/i, /Find duplicates/);
  await run("pinned-error", "metric=disk", async (page) => {
    const bad = srPinCell(page, "/mnt/pin-bad");
    await bad.waitFor({ timeout: SLOW });
    await page.waitForFunction(() => ![...document.querySelectorAll("span")].some((e) => e.textContent === "…"), null, { timeout: SLOW }).catch(() => {});
    sr("S3 cell text is exactly error", `pinned-error@${w}`, (await bad.innerText()).trim() === "error", await bad.innerText());
    sr("S3 cell has a title", `pinned-error@${w}`, !!(await bad.locator("span[title]").first().getAttribute("title").catch(() => null)), null);
    sr("S3 row never says 0 B", `pinned-error@${w}`, !(await bad.evaluate((el) => el.parentElement.innerText)).includes("0 B"), null);
    // Item B: the reason is element text in the row (not only a title), and it is the server's reason.
    const reason = await bad.locator("xpath=..").locator('[role="alert"]').allTextContents();
    sr("S3 reason text is visible in the row", `pinned-error@${w}`, reason.length === 1 && reason[0].trim() === SR_PIN_REASON, reason);
    const good = srPinCell(page, "/mnt/pin-good");
    sr("S4 good pin shows a size", `pinned-error@${w}`, /^\d+(\.\d+)? ([KMGT]i?)?B$/.test((await good.innerText()).trim()), await good.innerText());
  }, async (page) => {
    await withDisk(["/mnt/test"])(page);
    await page.route(/\/api\/resources\/pins/, (route) => json(route, { pinnedFolders: ["/mnt/pin-bad", "/mnt/pin-good"] }));
    await page.route(/\/api\/resources\/contents/, (route) => {
      const asked = new URL(route.request().url()).searchParams.get("path");
      const base = { ...DISK_SCAN, label: asked, path: asked };
      return json(route, asked === "/mnt/pin-bad" ? { ...base, entries: [], usedBytes: 0, partial: true, error: SR_PIN_REASON } : { ...base, usedBytes: 1.5e9 });
    });
  }, (page) => page.locator(".panel", { has: page.getByText("PINNED", { exact: true }) }).last());
}

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

    if (ONLY === "hint-pages") {
      await hintPages(run, vp.name);
      continue;
    }

    if (ONLY === "load-failed") {
      await loadFailed(run, vp.name);
      continue;
    }

    if (ONLY === "scan-root") {
      await scanRoot(run, vp.name);
      continue;
    }

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
// A mistyped SHOTS_ONLY would otherwise run the default sections and look green.
check("SHOTS_ONLY names a known section", "all", !ONLY || ["hint-pages", "load-failed", "scan-root"].includes(ONLY), ONLY);
if (ONLY === "hint-pages") {
  check("hint-pages ran every check", "all", hpRan === HP_PER_WIDTH * VIEWPORTS.length, { ran: hpRan, expected: HP_PER_WIDTH * VIEWPORTS.length });
  console.log(`hint-pages: ${hpPass}/${HP_PER_WIDTH * VIEWPORTS.length} pass`);
}
if (ONLY === "load-failed") {
  check("load-failed ran every check", "all", rfRan === RF_PER_WIDTH * VIEWPORTS.length, { ran: rfRan, expected: RF_PER_WIDTH * VIEWPORTS.length });
  console.log(`load-failed: ${rfPass}/${RF_PER_WIDTH * VIEWPORTS.length} pass`);
}
if (ONLY === "scan-root") {
  check("scan-root ran every check", "all", srRan === SR_PER_WIDTH * VIEWPORTS.length, { ran: srRan, expected: SR_PER_WIDTH * VIEWPORTS.length });
  console.log(`scan-root: ${srPass}/${SR_PER_WIDTH * VIEWPORTS.length} pass`);
}
console.log(JSON.stringify({ failed, results }));
process.exit(failed ? 1 : 0);
