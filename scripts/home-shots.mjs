#!/usr/bin/env node
/* Home (/) acceptance run: captures and numeric checks C1 to C14 from the shape brief, on the test stack.
 * /api/attention is served from scripts/fixtures/home/fixtures.ts (built relative to now), so every age and
 * hh:mm is stable; the launcher's containers and widgets and the backup status come from the same file. Every other request goes to the
 * real test stack. Run on the server, never on production:
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node --experimental-strip-types scripts/home-shots.mjs
 *
 * Writes <OUT_DIR>/results.json and prints one `home-shots: pass/total` line plus each failing check.
 * Needs Playwright >= 1.45. Playwright is not a dependency of this repo; run it where one is installed.
 * The test stack is a dev build (any non-empty password logs in).
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backupOk, build, buildWeek, CONTAINERS, WIDGETS } from "./fixtures/home/fixtures.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const NOW = Date.now();
const FIX = build(NOW);
const ZONE = "Australia/Sydney";
const WEEK_MS = 7 * 86_400_000;
// WK (7-day range): the pinned clock, a Thursday. The page asks for since = this - 7 days.
const WK_NOW = Date.parse("2026-11-12T09:00:00+11:00");
const FIXW = buildWeek(WK_NOW);
const WIDTHS = [
  { name: "1440", viewport: { width: 1440, height: 900 }, bound: 180 },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, bound: 169 },
];
// The 8 states of C4, in the order of the brief. `loading` holds the report open; `error` answers HTTP 500.
const STATES = ["loading", "quiet", "one", "several", "partial", "dockerFailed", "otherFailed", "error"];
const FEATURES = [
  "answer", "attention", "changes", "launcher", "filter", "slash-key", "groups", "counts", "container-link",
  "open-app", "widget-fields", "widget-actions", "sort-link", "lifecycle", "box-digest", "resources-link",
  "backup", "orchestra-link",
];

mkdirSync(OUT_DIR, { recursive: true });
const results = []; // { id: "C1", pass, detail }
const record = (id, pass, detail) => results.push({ id, pass: !!pass, detail });
let pageErrors = 0;
const foreign = [];

const browser = await chromium.launch({ headless: true });

/** One page on its own context. `fixture` is a key of FIX, "loading" or "error"; `state.cur` can be swapped. */
async function open({ width = WIDTHS[0], fixture = "quiet", reduced = false, throwStorage = false, pinned = false } = {}) {
  const { name, bound, ...ctxOpts } = width;
  const context = await browser.newContext({
    ...ctxOpts,
    timezoneId: ZONE,
    ...(pinned ? { locale: "en-AU" } : {}),
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  await context.addInitScript(
    ({ lastLooked, doThrow }) => {
      if (doThrow) {
        const boom = () => {
          throw new DOMException("blocked", "SecurityError");
        };
        Storage.prototype.getItem = boom;
        Storage.prototype.setItem = boom;
      } else {
        try {
          window.localStorage.setItem("home-last-looked", String(lastLooked));
        } catch {
          // storage blocked in this context: the page falls back to the last 24 h
        }
      }
    },
    { lastLooked: (pinned ? WK_NOW : NOW) - 8 * 3600_000, doThrow: throwStorage },
  );
  const page = await context.newPage();
  const state = { cur: fixture, week: "week" };
  if (pinned) await page.clock.setFixedTime(WK_NOW);
  page.on("pageerror", () => pageErrors++);
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreign.push(u);
  });
  await page.route("**/api/attention*", (route) => {
    // The 7-day request is the one whose since is the pinned clock minus 7 days; `state.week` picks its answer.
    if (pinned && Math.abs(Number(new URL(route.request().url()).searchParams.get("since")) - (WK_NOW - WEEK_MS)) < 60_000) {
      if (state.week === "loading") return;
      if (state.week === "error") return route.fulfill({ status: 500, body: "{}" });
      return route.fulfill({ json: FIXW[state.week] });
    }
    if (state.cur === "loading") return; // never answered
    if (state.cur === "error") return route.fulfill({ status: 500, body: "{}" });
    return route.fulfill({ json: (pinned ? build(WK_NOW) : FIX)[state.cur] });
  });
  await page.route("**/api/docker/containers", (route) => route.fulfill({ json: CONTAINERS }));
  await page.route("**/api/backup", (route) => route.fulfill({ json: backupOk(NOW) }));
  await page.route("**/api/widgets",(route) => route.fulfill({ json: WIDGETS }));
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".hm-answer").waitFor({ timeout: 30_000 });
  await page.locator(".hm-app").first().waitFor({ timeout: 30_000 }); // C9 reads the launcher, which loads after the answer
  if (fixture !== "loading") {
    await page.waitForFunction(() => !/^Checking the box/.test(document.querySelector(".hm-answer")?.textContent ?? ""), null, {
      timeout: 30_000,
    });
  }
  await page.waitForTimeout(400);
  return { context, page, state, name, bound };
}

/** A poll tick: SWR revalidates on window focus (2 s dedupe), so wait past it before and after. */
async function tick(page, state, fixture) {
  if (fixture) state.cur = fixture;
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1200);
}

/** Everything the per-state checks read, in one round trip. */
const readState = () => {
  const hm = document.querySelector(".hm");
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = rect(el);
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "black";
    canvas.fillStyle = c;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const root = getComputedStyle(document.documentElement);
  const token = (n) => rgba(root.getPropertyValue(n).trim()).join();
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] === 1) break;
    }
    let out = [0, 0, 0];
    for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    return out;
  };
  const att = document.querySelector(".hm-att");
  const chg = document.querySelector(".hm-chg");
  const attSubjects = [...document.querySelectorAll(".hm-att-row")].map((r) => r.dataset.subject);
  const chgSubjects = [...document.querySelectorAll(".hm-chg-row")].flatMap((r) => (r.dataset.subject ?? "").split(" "));
  const headlines = [...document.querySelectorAll(".hm-att-title")].map((t) => t.textContent.trim());
  const chgText = [...document.querySelectorAll(".hm-chg-text")].map((t) => t.textContent);
  const answer = document.querySelector(".hm-answer");
  // C5: interactive targets visible in .hm
  const small = [...hm.querySelectorAll("a, button, input, [role=menuitem]")]
    .filter(visible)
    // .hm-att-disclose stretches its tap area over the positioned ancestor (::after, inset 0), so that box is the target.
    .map((el) => ({ el, r: rect(el.classList.contains("hm-att-disclose") && el.offsetParent ? el.offsetParent : el) }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${Math.round(r.width)}x${Math.round(r.height)}${el.classList.contains("hm-att-disclose") ? " (tap area)" : ""}`);
  // C6: computed-style contrast of every leaf text element (WCAG ratio against the composited background)
  let minRatio = 99;
  let worst = "";
  for (const el of hm.querySelectorAll("*")) {
    if (!visible(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fg = rgba(getComputedStyle(el).color);
    const bg = bgOf(el);
    const a = fg[3];
    const mixed = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const l1 = lum(mixed);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < minRatio) {
      minRatio = ratio;
      worst = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
    }
  }
  // C7: warn or bad paint, and infinite animations
  const warn = token("--color-warn");
  const bad = token("--color-bad");
  const painted = [];
  for (const el of hm.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
      const v = rgba(cs[prop]).join();
      if (v === warn || v === bad) painted.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}:${prop}`);
    }
  }
  const infinite = document.getAnimations().filter((x) => x.effect?.getComputedTiming().iterations === Infinity).length;
  // C12: overflow. Ellipsised and line-clamped boxes clip by design; anything else that clips text is a fault.
  const clipped = [];
  for (const el of hm.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const byDesign = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" || cs.display === "-webkit-box";
    if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 && !byDesign) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    if (rect(el).right > window.innerWidth + 1 && !el.closest(".hm-att-list, .hm-chg-list")) clipped.push(`beyond-viewport:${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
  }
  const sections = [...hm.children].map((s) => s.scrollWidth - s.clientWidth);
  return {
    answerText: answer.textContent.trim(),
    answerTone: answer.dataset.tone,
    answerBottom: rect(answer).bottom + window.scrollY,
    attSubjects,
    chgSubjects,
    headlines,
    chgText,
    small,
    minRatio,
    worst,
    painted,
    infinite,
    clipped,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sectionOverflow: Math.max(0, ...sections),
    features: Object.fromEntries(
      document.querySelectorAll("[data-feature]").length
        ? [...new Set([...document.querySelectorAll("[data-feature]")].map((e) => e.dataset.feature))].map((f) => [
            f,
            [...document.querySelectorAll(`[data-feature="${f}"]`)].some((e) => rect(e).width > 0 && rect(e).height > 0),
          ])
        : [],
    ),
    hasAtt: !!att,
    hasChg: !!chg,
  };
};

// ---- per state, per width: C3 C4 C5 C6 C7 C8 C9 C12 and the captures ----
for (const width of WIDTHS) {
  for (const stateName of STATES) {
    const { context, page } = await open({ width, fixture: stateName });
    const s = await page.evaluate(readState);
    const tag = `${stateName}@${width.name}`;
    const both = s.attSubjects.filter((x) => s.chgSubjects.includes(x));
    const doubled = s.headlines.filter((h) => s.chgText.some((t) => t.includes(h)));
    record("C3", both.length === 0 && doubled.length === 0, `${tag}: shared subjects ${both.length}, headlines in feed ${doubled.length}`);
    record("C4", s.answerBottom <= width.bound, `${tag}: answer bottom ${Math.round(s.answerBottom)} px (max ${width.bound})`);
    if (width.name === "390") record("C5", s.small.length === 0, `${tag}: ${s.small.length} under 44 px ${s.small.slice(0, 4).join("; ")}`);
    record("C6", s.minRatio >= 4.5, `${tag}: lowest text contrast ${s.minRatio.toFixed(2)}:1 at ${s.worst} (computed colours, not the pixel percentile)`);
    if (stateName === "quiet") {
      record("C7", s.painted.length === 0 && s.infinite === 0, `${tag}: ${s.painted.length} warn/bad paints ${s.painted.slice(0, 3).join("; ")}, ${s.infinite} infinite animations`);
      const missing = FEATURES.filter((f) => !s.features[f]);
      record("C9", missing.length === 0, `${tag}: ${FEATURES.length - missing.length} of ${FEATURES.length}${missing.length ? `, missing ${missing.join(", ")}` : ""}`);
    }
    if (["partial", "dockerFailed", "otherFailed", "error", "loading"].includes(stateName)) {
      const honest = !/^All clear/.test(s.answerText) && s.answerTone !== "ok";
      record("C8", honest, `${tag}: "${s.answerText}" tone ${s.answerTone}`);
    }
    record("C12", s.pageOverflow <= 0 && s.sectionOverflow <= 0 && s.clipped.length === 0, `${tag}: page ${s.pageOverflow}, sections ${s.sectionOverflow}, clipped ${s.clipped.length} ${s.clipped.slice(0, 3).join("; ")}`);
    await page.screenshot({ path: join(OUT_DIR, `home-${stateName}-${width.name}.png`), fullPage: true });
    await context.close();
  }
}

// ---- C1: the pill rule. The pointer rests on an app card; 2 hits arrive and 1 clears. ----
{
  const { context, page, state } = await open({ fixture: "c1Before" });
  const readBelow = () => {
    const att = document.querySelector(".hm-att");
    const chg = document.querySelector(".hm-chg");
    // The changes box is fixed-size and fills slots in place: its rows may change, so its descendants are not counted (the box itself is).
    const below = [...document.querySelectorAll(".hm *")].filter(
      (el) => !att.contains(el) && !(chg && chg !== el && chg.contains(el)) && att.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return {
      height: att.getBoundingClientRect().height,
      chgHeight: chg?.getBoundingClientRect().height ?? null,
      tops: below.map((el) => Math.round((el.getBoundingClientRect().top + window.scrollY) * 100) / 100),
      pill: document.querySelector(".hm-pill")?.textContent.trim() ?? "",
      answer: document.querySelector(".hm-answer").textContent.trim(),
    };
  };
  await page.hover(".hm-app .hm-app-name");
  const before = await page.evaluate(readBelow);
  await tick(page, state, "c1After");
  await tick(page, state);
  await tick(page, state);
  const after = await page.evaluate(readBelow);
  const dTop = before.tops.length === after.tops.length ? Math.max(0, ...before.tops.map((t, i) => Math.abs(t - after.tops[i]))) : Infinity;
  record(
    "C1",
    after.height === before.height && after.chgHeight === before.chgHeight && dTop === 0 && /^2 new/.test(after.pill) && after.answer !== before.answer,
    `d height ${after.height - before.height} px, d changes height ${after.chgHeight - before.chgHeight} px, max d top ${dTop} px over ${before.tops.length} elements, pill "${after.pill}", answer "${before.answer}" -> "${after.answer}"`,
  );
  await context.close();
}

// ---- C2: the changes box. 3 new events with the pointer on the launcher; then 1 more with it inside. ----
{
  const { context, page, state } = await open({ fixture: "c2Before" });
  const read = () => ({
    h: document.querySelector(".hm-chg-list").getBoundingClientRect().height,
    launcher: document.querySelector(".hm-apps").getBoundingClientRect().top + window.scrollY,
    slots: document.querySelector(".hm-chg-list").dataset.slots,
  });
  await page.hover(".hm-app .hm-app-name");
  const a = await page.evaluate(read);
  await tick(page, state, "c2Events");
  await tick(page, state);
  await tick(page, state);
  const b = await page.evaluate(read);
  await page.hover(".hm-chg-list");
  await tick(page, state, "c2More");
  await tick(page, state);
  await tick(page, state);
  const c = await page.evaluate(read);
  record(
    "C2",
    b.h === a.h && b.launcher === a.launcher && c.slots === b.slots && c.h === b.h,
    `d height ${b.h - a.h} px, d launcher top ${b.launcher - a.launcher} px, held slots ${c.slots === b.slots ? "unchanged" : "CHANGED"}`,
  );
  await context.close();
}

// ---- C10 and C11: the slide after a pill tap, and none under reduced motion ----
for (const reduced of [false, true]) {
  const { context, page, state } = await open({ fixture: "c10Before", reduced });
  const rows = () => Object.fromEntries([...document.querySelectorAll(".hm-att-row")].map((r) => [r.dataset.rowId, r.getBoundingClientRect().top]));
  const before = await page.evaluate(rows);
  await tick(page, state, "c10After");
  await page.locator(".hm-pill").click();
  const seen = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const anims = document.getAnimations();
    return {
      transform: anims.filter((x) => x.playState === "running" && x.effect?.getKeyframes().some((k) => "transform" in k)).length,
      infinite: anims.filter((x) => x.effect?.getComputedTiming().iterations === Infinity).length,
    };
  });
  await page.waitForTimeout(700); // 420 ms slide + 240 ms fade + margin: shoot and measure settled
  const after = await page.evaluate(rows);
  const moved = Object.keys(before).filter((k) => k in after && Math.abs(after[k] - before[k]) > 0.5).length;
  if (!reduced) {
    await page.screenshot({ path: join(OUT_DIR, "home-c10-after-tap-1440.png") });
    record("C10", seen.transform >= 1 && moved >= 1, `${seen.transform} transform animations in the first frames, ${moved} rows moved`);
  } else {
    record("C11", seen.transform === 0 && seen.infinite === 0, `${seen.transform} transform animations, ${seen.infinite} infinite`);
  }
  await context.close();
}

// ---- C14: no storage ----
for (const width of WIDTHS) {
  const before = pageErrors;
  const { context, page } = await open({ width, fixture: "quiet", throwStorage: true });
  // innerText applies the label's text-transform: uppercase, so match case-insensitively.
  const text = await page.locator(".hm-chg").innerText();
  record("C14", /last 24 h/i.test(text) && pageErrors === before, `@${width.name}: feed label ${/last 24 h/i.test(text) ? "last 24 h" : `"${text.split("\n")[0]}"`}, ${pageErrors - before} page errors`);
  await context.close();
}

// ---- PQ4: Home's Disks value is labelled and fits (host mocked with three disks, one long name) ----
const HOST = {
  hostname: "h", os: "linux", uptimeSeconds: 90_000, cpu: { percent: 12.3, cores: 4, model: "x", loadAvg: [0, 0, 0] },
  memory: { total: 16e9, used: 8e9, available: 8e9, percent: 50 }, network: { rxPerSec: 1000, txPerSec: 1000 }, tempC: 40, ts: NOW,
  disk: [
    { mount: "/", total: 1e11, used: 4.1e10, percent: 41 },
    { mount: "/mnt/media", total: 8e12, used: 5.4e12, percent: 68 },
    { mount: "/mnt/a-very-long-disk-name", total: 1e12, used: 1e11, percent: 10 },
  ],
};
for (const width of WIDTHS) {
  const { context, page } = await open({ width, fixture: "quiet" });
  await page.route("**/api/host", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HOST) }));
  await page.reload({ waitUntil: "domcontentloaded" });
  const cell = page.locator('[data-feature="box-digest"] .hm-dg-cell', { hasText: "Disks" });
  await cell.filter({ hasText: "root" }).waitFor({ timeout: 30_000 }).catch(() => {});
  const m = await cell.evaluate((el) => ({ text: el.textContent ?? "", over: document.documentElement.scrollWidth - window.innerWidth, right: el.getBoundingClientRect().right, vw: window.innerWidth }));
  record("PQ4", /root.41%/.test(m.text) && /media.68%/.test(m.text) && m.over <= 0 && m.right <= m.vw, `@${width.name}: "${m.text.replace(/ /g, " ")}", page overflow ${m.over}px, cell right ${Math.round(m.right)}/${m.vw}`);
  // Crop the whole Box section, padded, with the viewport tall enough that the fixed bottom nav and dev badge sit below it.
  const box = page.locator('[data-feature="box-digest"]');
  const PAD = 12;
  const h = await box.evaluate((el) => el.getBoundingClientRect().height);
  await page.setViewportSize({ width: width.viewport.width, height: Math.ceil(h) + 2 * PAD + 160 });
  await box.evaluate((el) => el.scrollIntoView({ block: "start" }));
  // Leave room above for a sticky top header (short fixed/sticky bars only; a full-height sidebar is not "top chrome").
  await page.evaluate((pad) => {
    const top = [...document.querySelectorAll("body *")].map((n) => [getComputedStyle(n), n.getBoundingClientRect()])
      .filter(([cs, b]) => (cs.position === "fixed" || cs.position === "sticky") && b.top <= 1 && b.height > 0 && b.height < innerHeight / 2 && b.width > innerWidth / 2)
      .reduce((m, [, b]) => Math.max(m, b.bottom), 0);
    window.scrollBy(0, -(pad + top));
  }, PAD);
  const geo = await box.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const chrome = [...document.querySelectorAll("body *")].filter((n) => {
      if (n.contains(el) || el.contains(n)) return false;
      const cs = getComputedStyle(n);
      if (cs.position !== "fixed" && cs.position !== "sticky") return false;
      const b = n.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
    }).map((n) => n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : ""));
    const nav = [...document.querySelectorAll("body *")].find((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && n.getBoundingClientRect().height > 30 && n.getBoundingClientRect().height < window.innerHeight / 2 && !n.contains(el));
    return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, navTop: nav ? nav.getBoundingClientRect().top : null, chrome, vh: window.innerHeight };
  });
  record("PQ4", geo.chrome.length === 0 && (geo.navTop === null || geo.bottom <= geo.navTop) && geo.y >= 0, `@${width.name}: crop covers Box section ${Math.round(geo.h)}px, bottom ${Math.round(geo.bottom)} vs nav top ${geo.navTop === null ? "none" : Math.round(geo.navTop)}, chrome over crop: ${geo.chrome.join(",") || "none"}`);
  const cx = Math.max(0, geo.x - PAD), cy = Math.max(0, geo.y - PAD);
  await page.screenshot({ path: join(OUT_DIR, `home-pq4-disks-${width.name}.png`), clip: { x: cx, y: cy, width: Math.min(geo.w + 2 * PAD, (await page.viewportSize()).width - cx), height: Math.min(geo.h + 2 * PAD, geo.vh - cy) } });
  await context.close();
}

// ---- SL: a lane stalled with no agent rows raises an item that names the lane ----
for (const width of WIDTHS) {
  const { context, page } = await open({ width, fixture: "stalledLane" });
  const row = page.locator('.hm-att-row[data-subject="orchestra"]');
  await row.waitFor({ timeout: 30_000 }).catch(() => {});
  const m = await row.evaluate((el) => ({ text: el.textContent ?? "", over: document.documentElement.scrollWidth - window.innerWidth })).catch(() => ({ text: "", over: 0 }));
  record("SL", /dev has gone quiet/.test(m.text) && /sent no agent details/.test(m.text) && m.over <= 0, `@${width.name}: "${m.text.slice(0, 120)}", page overflow ${m.over}px`);
  // Crop the row padded; the viewport is tall enough that the fixed bottom nav sits below it.
  const PAD = 12;
  const h = await row.evaluate((el) => el.getBoundingClientRect().height).catch(() => 40);
  await page.setViewportSize({ width: width.viewport.width, height: Math.ceil(h) + 2 * PAD + 400 });
  await row.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  const r = await row.boundingBox().catch(() => null);
  if (r) {
    const covered = await row.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [...document.querySelectorAll("body *")].some((n) => {
        if (n.contains(el) || el.contains(n)) return false;
        const cs = getComputedStyle(n);
        const nb = n.getBoundingClientRect();
        return (cs.position === "fixed" || cs.position === "sticky") && nb.width > 0 && nb.height > 0 && nb.left < b.right && nb.right > b.left && nb.top < b.bottom && nb.bottom > b.top;
      });
    });
    record("SL", !covered, `@${width.name}: fixed or sticky chrome over the crop: ${covered}`);
    const cx = Math.max(0, r.x - PAD), cy = Math.max(0, r.y - PAD);
    await page.screenshot({ path: join(OUT_DIR, `home-sl-stalled-lane-${width.name}.png`), clip: { x: cx, y: cy, width: Math.min(r.width + 2 * PAD, width.viewport.width - cx), height: r.height + 2 * PAD } });
  }
  await context.close();
}

// ---- DQ: a quiet front door camera raises an item next to the disk one (state attention-doorbell) ----
for (const width of WIDTHS) {
  const { context, page } = await open({ width, fixture: "doorbellQuiet" });
  const row = page.locator('.hm-att-row[data-subject="doorbell"]');
  await row.waitFor({ timeout: 30_000 }).catch(() => {});
  const m = await row.evaluate((el) => ({ text: el.textContent ?? "", over: document.documentElement.scrollWidth - window.innerWidth })).catch(() => ({ text: "", over: 0 }));
  record("DQ", /Front door camera has gone quiet/.test(m.text) && /68 days/.test(m.text) && m.over <= 0, `@${width.name}: "${m.text.slice(0, 140)}", page overflow ${m.over}px`);
  const PAD = 12;
  const h = await row.evaluate((el) => el.getBoundingClientRect().height).catch(() => 40);
  await page.setViewportSize({ width: width.viewport.width, height: Math.ceil(h) + 2 * PAD + 400 });
  await row.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  const r = await row.boundingBox().catch(() => null);
  if (r) {
    const covered = await row.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [...document.querySelectorAll("body *")].some((n) => {
        if (n.contains(el) || el.contains(n)) return false;
        const cs = getComputedStyle(n);
        const nb = n.getBoundingClientRect();
        return (cs.position === "fixed" || cs.position === "sticky") && nb.width > 0 && nb.height > 0 && nb.left < b.right && nb.right > b.left && nb.top < b.bottom && nb.bottom > b.top;
      });
    });
    record("DQ", !covered, `@${width.name}: fixed or sticky chrome over the crop: ${covered}`);
    const cx = Math.max(0, r.x - PAD), cy = Math.max(0, r.y - PAD);
    await page.screenshot({ path: join(OUT_DIR, `home-attention-doorbell-${width.name}.png`), clip: { x: cx, y: cy, width: Math.min(r.width + 2 * PAD, width.viewport.width - cx), height: r.height + 2 * PAD } });
  }
  await context.close();
}

// ---- LC: the stop confirm and a lifecycle error on a card (sonarr, `several`): the name keeps its 2.75rem column ----
for (const width of WIDTHS) {
  const { context, page } = await open({ width, fixture: "several" });
  await page.route("**/api/docker/containers/*/action", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not stop sonarr" }) }));
  const card = page.locator(".hm-app", { hasText: "sonarr" }).first();
  const measure = () =>
    card.evaluate((el) => {
      const rect = (n) => n.getBoundingClientRect();
      const name = rect(el.querySelector(".hm-app-name"));
      const acts = rect(el.querySelector(".hm-app-acts"));
      const overlap = name.left < acts.right && name.right > acts.left && name.top < acts.bottom && name.bottom > acts.top;
      return { w: name.width, overlap, min: parseFloat(getComputedStyle(el.querySelector(".hm-app-name")).minWidth) };
    });
  const shoot = async (file) => {
    const r = await card.boundingBox();
    const x = Math.max(0, r.x - 8), y = Math.max(0, r.y - 8);
    await page.screenshot({ path: join(OUT_DIR, file), clip: { x, y, width: Math.min(r.width + 16, width.viewport.width - x), height: r.height + 16 } });
  };
  await card.getByRole("button", { name: "Stop sonarr" }).click();
  await card.locator(".nw-confirm").waitFor();
  await page.waitForTimeout(400);
  const a = await measure();
  await shoot(`home-confirm-open-${width.name}.png`);
  record("LC", a.w >= a.min && !a.overlap, `@${width.name} confirm open: name ${Math.round(a.w)} px (min ${Math.round(a.min)}), overlaps actions: ${a.overlap}`);
  if (width.name === "390") {
    await card.getByRole("button", { name: "Yes, stop sonarr" }).click();
    await card.getByRole("alert").waitFor();
    await page.waitForTimeout(400);
    const e = await measure();
    await shoot("home-lifecycle-error-390.png");
    record("LC", e.w >= e.min && !e.overlap, `@390 lifecycle error: name ${Math.round(e.w)} px (min ${Math.round(e.min)}), overlaps actions: ${e.overlap}`);
  }
  await context.close();
}

// ---- WK: the Recent / 7 days range on the Changes list (nw-weekly-digest). Pinned clock, en-AU, Australia/Sydney. ----
// Captures wk1..wk8 of the shape brief and numeric checks 1 to 5 of "Layout and numeric checks". Check 6 (default pixel
// parity with origin/main) is a comparison: wk1 prints its list and "Show N more" rects, to diff against a run on main.
{
  const measure = (page) =>
    page.evaluate(() => {
      const r = (n) => n.getBoundingClientRect();
      const rect = (n) => (n ? [r(n).x, r(n).y, r(n).width, r(n).height].map(Math.round) : null);
      const sec = document.querySelector('[data-feature="changes"]');
      const head = sec.querySelector(".hm-sec-head");
      const h2 = head.querySelector("h2");
      const group = head.querySelector('[role="group"]');
      const at = [...sec.querySelectorAll(".hm-chg-at")];
      return {
        headH: r(head).height,
        headMin: parseFloat(getComputedStyle(head).minHeight),
        h2Right: r(h2).right,
        groupLeft: r(group).left,
        gap: parseFloat(getComputedStyle(head).columnGap) || 8,
        h2Clipped: h2.scrollWidth > h2.clientWidth,
        btns: [...group.querySelectorAll("button")].map((b) => ({ w: r(b).width, h: r(b).height })),
        atFits: at.every((n) => n.scrollWidth <= n.clientWidth),
        atMax: Math.max(0, ...at.map((n) => n.scrollWidth)),
        rowH: [...sec.querySelectorAll(".hm-chg-row")].map((n) => Math.round(r(n).height)),
        listH: r(sec.querySelector(".hm-chg-list")).height,
        listRect: rect(sec.querySelector(".hm-chg-list")),
        moreRect: rect(sec.querySelector(".hm-more")),
        heading: h2.textContent,
        label: sec.getAttribute("aria-label"),
        pressed: [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-pressed")),
        times: at.map((n) => n.textContent),
        empty: sec.querySelector(".hm-chg-empty")?.textContent ?? null,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
  // sel: the element to crop; it is scrolled into the upper part of the viewport first so no fixed chrome covers it.
  const crop = async (page, file, vw, sel = '[data-feature="changes"]') => {
    await page.locator(sel).evaluate((n) => { window.scrollTo(0, Math.max(0, n.getBoundingClientRect().top + scrollY - 120)); });
    await page.waitForTimeout(200);
    const box = await page.locator(sel).boundingBox();
    const x = Math.max(0, box.x - 8), y = Math.max(0, box.y - 8);
    await page.screenshot({ path: join(OUT_DIR, file), clip: { x, y, width: Math.min(box.width + 16, vw - x), height: box.height + 16 } });
  };
  const week = ["Today 08:00", "Today 06:30", "Wed 07:00", "Tue 07:00", "Mon 21:40", "Thu 10:20"];
  const plan = [
    { n: "wk1-recent", widths: ["390", "1440"], week: null },
    { n: "wk2-week", widths: ["390", "1440"], week: "week" },
    { n: "wk3-empty", widths: ["390"], week: "weekEmpty" },
    { n: "wk4-loading", widths: ["1440"], week: "loading" },
    { n: "wk5-error", widths: ["390"], week: "error" },
    { n: "wk6-open", widths: ["1440"], week: "weekMany", open: true },
    { n: "wk7-long", widths: ["390", "1440"], week: "weekLong" },
  ];
  for (const p of plan) {
    for (const width of WIDTHS.filter((w) => p.widths.includes(w.name))) {
      const { context, page, state } = await open({ width: p.open ? { ...width, viewport: { ...width.viewport, height: 1400 } } : width, pinned: true });
      const tag = `${p.n}@${width.name}`;
      if (p.week) {
        state.week = p.week;
        await page.getByRole("button", { name: "Last 7 days" }).click();
        await page.waitForTimeout(500);
        if (p.open) {
          await page.locator(".hm-more").click();
          await page.waitForTimeout(500);
        }
      }
      const m = await measure(page);
      const phone = width.name === "390";
      // 1: the head is its min-height in both ranges. 2: SegmentButton's own tap targets (44 below md, 32 from md).
      record("WK", Math.abs(m.headH - m.headMin) < 0.6, `${tag} head ${m.headH}px, min-height ${m.headMin}px`);
      record("WK", m.btns.every((b) => (phone ? b.h >= 44 && b.w >= 44 : b.h >= 32)), `${tag} segments ${m.btns.map((b) => `${Math.round(b.w)}x${Math.round(b.h)}`).join(" ")}`);
      // 3: the heading never overlaps the group and is not clipped. 4: the time column fits (7.5rem on desktop).
      record("WK", m.h2Right <= m.groupLeft - m.gap + 0.5 && !m.h2Clipped, `${tag} h2 right ${Math.round(m.h2Right)}, group left ${Math.round(m.groupLeft)}, gap ${m.gap}, clipped ${m.h2Clipped}`);
      record("WK", m.atFits, `${tag} time column fits: ${m.atFits}, widest ${m.atMax}px`);
      // 5: closed rows keep --hm-chg-row (3.25rem desktop, 4.75rem phone); an opened list is taller by design.
      if (!p.open) record("WK", m.rowH.every((h) => h === (phone ? 76 : 52)), `${tag} row heights ${m.rowH.join(",")}, list ${Math.round(m.listH)}px`);
      record("WK", m.pageOverflow <= 0, `${tag} page overflow ${m.pageOverflow}`);
      // Copy and state, per the shape table. 01:00 = the pinned clock minus the 8 h last look.
      record("WK", m.heading === (p.week ? "Last 7 days · latest per app" : "Since you last looked · 01:00"), `${tag} heading "${m.heading}"`);
      record("WK", m.label === (p.week ? "Last 7 days" : "Since you last looked") && m.pressed.join() === (p.week ? "false,true" : "true,false"), `${tag} label "${m.label}", pressed ${m.pressed}`);
      if (p.n === "wk2-week") record("WK", m.times.join() === week.slice(0, m.times.length).join() && m.times.length > 0, `${tag} times ${m.times}`);
      if (p.n === "wk3-empty") record("WK", m.empty === "Nothing changed in the last 7 days.", `${tag} empty "${m.empty}"`);
      if (p.n === "wk4-loading") record("WK", m.empty === "Looking for changes…" && m.times.length === 0, `${tag} loading "${m.empty}", stale rows ${m.times.length}`);
      if (p.n === "wk5-error") record("WK", m.empty === "Unknown.", `${tag} error "${m.empty}"`);
      if (p.n === "wk1-recent") console.log(`WK parity rects ${tag} list ${m.listRect} more ${m.moreRect}`);
      if (p.open) {
        // The whole opened section is in the crop: its last row and "Show fewer" end inside the box the crop takes.
        const c = await page.evaluate(() => {
          const sec = document.querySelector('[data-feature="changes"]');
          const b = sec.querySelector(".hm-more").getBoundingClientRect();
          return { rows: sec.querySelectorAll(".hm-chg-row").length, btnBottom: b.bottom, secBottom: sec.getBoundingClientRect().bottom, vh: innerHeight, text: sec.querySelector(".hm-more").textContent };
        });
        record("WK", c.rows === 14 && /fewer/i.test(c.text) && c.btnBottom <= c.secBottom + 0.5 && c.secBottom + 8 <= c.vh, `${tag} opened: ${c.rows} rows, "${c.text}" bottom ${Math.round(c.btnBottom)} within section bottom ${Math.round(c.secBottom)} (viewport ${c.vh})`);
      }
      await crop(page, `home-${p.n}-${width.name}.png`, width.viewport.width);
      if (p.n === "wk2-week") await page.screenshot({ path: join(OUT_DIR, `home-wk2-week-full-${width.name}.png`), fullPage: true });
      await context.close();
    }
  }
  // wk8: Recent at 360 with "· app changes unknown" (the heading wrap, check 3).
  {
    const width = { name: "360", viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true };
    const { context, page } = await open({ width, fixture: "changesFailed", pinned: true });
    const m = await measure(page);
    const h2Lines = await page.locator('[data-feature="changes"] .hm-sec-head h2').evaluate((n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)));
    record("WK", m.heading.includes("app changes unknown"), `wk8@360 heading names the failed state: "${m.heading}"`);
    record("WK", m.h2Right <= m.groupLeft - m.gap + 0.5 && !m.h2Clipped && Math.abs(m.headH - m.headMin) < 0.6, `wk8@360 h2 lines ${h2Lines}, h2 right ${Math.round(m.h2Right)}, group left ${Math.round(m.groupLeft)}, head ${m.headH}px (min ${m.headMin}px), heading "${m.heading}"`);
    await crop(page, "home-wk8-recent-failed-360.png", 360, '[data-feature="changes"] .hm-sec-head');
    await context.close();
  }

  // ---- CL: the stored change log (nw-change-log). Numeric checks 1 to 5 and 7 of its shape brief; wk3/wk4 cover week-empty and loading. ----
  const textFits = (page) =>
    page.evaluate(() => {
      const sec = document.querySelector('[data-feature="changes"]');
      return [...sec.querySelectorAll(".hm-chg-text")].every((n) => n.scrollWidth <= n.clientWidth && n.scrollHeight <= n.clientHeight + 1);
    });
  const rectsOf = (page) => measure(page).then((m) => JSON.stringify([m.listRect, m.moreRect, m.rowH]));
  const clPlan = [
    // check 3, 4 (a "Wed 08:00" Recent time), 7 (count 4 -> 1 moves no rect), and the 52-char name at 390.
    { n: "cl0-recent-normal", widths: ["390", "1440"], fixture: "changesCountsOne", heading: "Since you last looked · 01:00", text0: "transmission-openvpn restarted itself and is running again" },
    { n: "cl1-recent-count-and-day-prefix", widths: ["390", "1440"], fixture: "changesCounts", other: "changesCountsOne", heading: "Since you last looked · 01:00" },
    { n: "cl2-week-covered-counts", widths: ["390", "1440"], week: "weekCovered", heading: "Last 7 days" },
    { n: "cl3-week-partial-log", widths: ["390", "1440"], week: "weekPartial", heading: "Last 7 days · counted since Mon" },
    { n: "cl4-week-no-log", widths: ["390"], week: "weekNoLog", heading: "Last 7 days · latest per app" },
    { n: "cl4-week-earlier-stop", widths: ["390"], week: "weekEarlierStop", heading: "Last 7 days", times: ["Today 08:00", "Tue 08:40"] },
    { n: "cl5-week-empty", widths: ["390"], week: "weekEmptyLogged", heading: "Last 7 days", empty: "Nothing changed in the last 7 days." },
    { n: "cl6-count-long-name", widths: ["390", "1440"], fixture: "changesCounts", heading: "Since you last looked · 01:00", text0: "transmission-openvpn restarted 12 times, 11 by itself", long: true },
  ];
  for (const p of clPlan) {
    for (const width of WIDTHS.filter((w) => p.widths.includes(w.name))) {
      const { context, page, state } = await open({ width, fixture: p.fixture ?? "quiet", pinned: true });
      const tag = `${p.n}@${width.name}`;
      const phone = width.name === "390";
      if (p.week) {
        state.week = p.week;
        await page.getByRole("button", { name: "Last 7 days" }).click();
        await page.waitForTimeout(500);
      }
      const m = await measure(page);
      record("CL", m.heading === p.heading, `${tag} heading "${m.heading}"`); // check 5 copy
      record("CL", Math.abs(m.headH - m.headMin) < 0.6 && m.h2Right <= m.groupLeft - m.gap + 0.5 && !m.h2Clipped, `${tag} head ${m.headH}px (min ${m.headMin}px), h2 right ${Math.round(m.h2Right)}, group left ${Math.round(m.groupLeft)}`); // 5
      record("CL", m.rowH.every((h) => h === (phone ? 76 : 52)), `${tag} row heights ${m.rowH.join(",")}`); // 1
      record("CL", m.listH === (phone ? 76 : 52) * Math.min(m.rowH.length, 4) + 2 || m.rowH.length < 4, `${tag} list ${Math.round(m.listH)}px`); // 2
      record("CL", await textFits(page), `${tag} count text is not truncated`); // 3
      record("CL", m.atFits, `${tag} time column fits, widest ${m.atMax}px`); // 4
      if (p.times) record("CL", m.times.join() === p.times.join(), `${tag} times ${m.times}`);
      if (p.empty) record("CL", m.empty === p.empty && m.times.length === 0, `${tag} empty "${m.empty}", rows ${m.times.length}`);
      if (p.text0) {
        // Defining text first, then (for the long row) the truncation and overlap checks.
        const r = await page.evaluate(() => {
          const t = document.querySelector('[data-feature="changes"] .hm-chg-text');
          const o = t?.closest(".hm-chg-row")?.querySelector(".hm-chg-owner");
          const a = t?.getBoundingClientRect(), b = o?.getBoundingClientRect();
          return t && { text: t.textContent, sw: t.scrollWidth, cw: t.clientWidth, sh: t.scrollHeight, ch: t.clientHeight, overlap: !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) };
        });
        record("CL", r?.text === p.text0, `${tag} first row text "${r?.text}"`);
        if (p.long) record("CL", (phone ? r.sh <= r.ch : r.sw <= r.cw) && !r.overlap, `${tag} long name: scrollW ${r.sw}/${r.cw}, scrollH ${r.sh}/${r.ch}, overlap ${r.overlap}`); // 3
      }
      if (p.n === "cl1-recent-count-and-day-prefix") {
        record("CL", /^(Mon|Tue|Wed) \d\d:\d\d$/.test(m.times[2] ?? "") && /^\d\d:\d\d$/.test(m.times[0]), `${tag} day prefix only on the older row: ${m.times}`);
        const before = await rectsOf(page);
        state.cur = p.other;
        await page.reload();
        await page.waitForTimeout(500);
        record("CL", before === (await rectsOf(page)), `${tag} count 4 -> 1 moves no rect`); // 7
      }
      await crop(page, `home-${p.n}-${width.name}.png`, width.viewport.width);
      await context.close();
    }
  }
  // Check 5 at 360: the week-partial-log heading stays on the 2.75rem head and clear of the segment group.
  {
    const width = { name: "360", viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true };
    const { context, page, state } = await open({ width, fixture: "quiet", pinned: true });
    state.week = "weekPartial";
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await page.waitForTimeout(500);
    const m = await measure(page);
    record("CL", m.heading === "Last 7 days · counted since Mon", `cl3-week-partial-log@360 heading "${m.heading}"`);
    record("CL", m.headMin === 44 && Math.abs(m.headH - 44) < 0.6 && m.h2Right <= m.groupLeft - 8 + 0.5 && !m.h2Clipped, `cl3-week-partial-log@360 head ${m.headH}px (min ${m.headMin}px), h2 right ${Math.round(m.h2Right)}, group left ${Math.round(m.groupLeft)}`); // 5
    await crop(page, "home-cl3-week-partial-log-360.png", 360, '[data-feature="changes"] .hm-sec-head');
    await context.close();
  }
}

await browser.close();

// ---- C13 and the summary ----
record("C13", pageErrors === 0 && foreign.length === 0, `${pageErrors} page errors, ${foreign.length} foreign requests ${foreign.slice(0, 3).join(" ")}`);
const ids = [...Array.from({ length: 14 }, (_, i) => `C${i + 1}`), "PQ4", "SL", "LC", "WK", "CL"];
const summary = ids.map((id) => {
  const mine = results.filter((r) => r.id === id);
  return { id, pass: mine.length > 0 && mine.every((r) => r.pass), runs: mine.length, details: mine.map((r) => `${r.pass ? "ok" : "FAIL"} ${r.detail}`) };
});
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ at: new Date(NOW).toISOString(), summary }, null, 2));
const passed = summary.filter((s) => s.pass).length;
for (const s of summary.filter((x) => !x.pass)) console.log(`${s.id} FAIL\n  ${s.details.filter((d) => d.startsWith("FAIL")).join("\n  ") || "no runs recorded"}`);
console.log(`home-shots: ${passed}/${ids.length} pass`);
process.exit(passed === ids.length ? 0 : 1);
