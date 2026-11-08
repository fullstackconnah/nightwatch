#!/usr/bin/env node
/* Home (/) acceptance run: captures and numeric checks C1 to C14 from the shape brief, on the test stack.
 * /api/attention is served from scripts/fixtures/home/fixtures.ts (built relative to now), so every age and
 * hh:mm is stable. Every other request goes to the real test stack. Run on the server, never on production:
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node --experimental-strip-types scripts/home-shots.mjs
 *
 * Writes <OUT_DIR>/results.json and prints one `home-shots: pass/total` line plus each failing check.
 * Needs Playwright >= 1.45. Playwright is not a dependency of this repo; run it where one is installed.
 * The test stack is a dev build (any non-empty password logs in) and needs at least one container with a
 * URL, a widget with fields and a stopped container for C9 and C12 to see every feature.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "./fixtures/home/fixtures.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const NOW = Date.now();
const FIX = build(NOW);
const ZONE = "Australia/Sydney";
const WIDTHS = [
  { name: "1440", viewport: { width: 1440, height: 900 }, bound: 180 },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, bound: 169 },
];
// The 8 states of C4, in the order of the brief. `loading` holds the report open; `error` answers HTTP 500.
const STATES = ["loading", "quiet", "one", "several", "partial", "dockerFailed", "otherFailed", "error"];
const FEATURES = [
  "answer", "attention", "changes", "launcher", "filter", "slash-key", "groups", "counts", "container-link",
  "open-app", "widget-fields", "widget-actions", "sort-link", "lifecycle-link", "box-digest", "resources-link",
  "backup", "orchestra-link",
];

mkdirSync(OUT_DIR, { recursive: true });
const results = []; // { id: "C1", pass, detail }
const record = (id, pass, detail) => results.push({ id, pass: !!pass, detail });
let pageErrors = 0;
const foreign = [];

const browser = await chromium.launch({ headless: true });

/** One page on its own context. `fixture` is a key of FIX, "loading" or "error"; `state.cur` can be swapped. */
async function open({ width = WIDTHS[0], fixture = "quiet", reduced = false, throwStorage = false } = {}) {
  const { name, bound, ...ctxOpts } = width;
  const context = await browser.newContext({
    ...ctxOpts,
    timezoneId: ZONE,
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
    { lastLooked: NOW - 8 * 3600_000, doThrow: throwStorage },
  );
  const page = await context.newPage();
  const state = { cur: fixture };
  page.on("pageerror", () => pageErrors++);
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreign.push(u);
  });
  await page.route("**/api/attention*", (route) => {
    if (state.cur === "loading") return; // never answered
    if (state.cur === "error") return route.fulfill({ status: 500, body: "{}" });
    return route.fulfill({ json: FIX[state.cur] });
  });
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".hm-answer").waitFor({ timeout: 30_000 });
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
    .map((el) => ({ el, r: rect(el) }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
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
  const text = await page.locator(".hm-chg").innerText();
  record("C14", /last 24 h/.test(text) && pageErrors === before, `@${width.name}: feed label ${/last 24 h/.test(text) ? "last 24 h" : `"${text.split("\n")[0]}"`}, ${pageErrors - before} page errors`);
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
  await page.locator('[data-feature="box-digest"]').screenshot({ path: join(OUT_DIR, `home-pq4-disks-${width.name}.png`) });
  await context.close();
}

await browser.close();

// ---- C13 and the summary ----
record("C13", pageErrors === 0 && foreign.length === 0, `${pageErrors} page errors, ${foreign.length} foreign requests ${foreign.slice(0, 3).join(" ")}`);
const ids = [...Array.from({ length: 14 }, (_, i) => `C${i + 1}`), "PQ4"];
const summary = ids.map((id) => {
  const mine = results.filter((r) => r.id === id);
  return { id, pass: mine.length > 0 && mine.every((r) => r.pass), runs: mine.length, details: mine.map((r) => `${r.pass ? "ok" : "FAIL"} ${r.detail}`) };
});
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ at: new Date(NOW).toISOString(), summary }, null, 2));
const passed = summary.filter((s) => s.pass).length;
for (const s of summary.filter((x) => !x.pass)) console.log(`${s.id} FAIL\n  ${s.details.filter((d) => d.startsWith("FAIL")).join("\n  ") || "no runs recorded"}`);
console.log(`home-shots: ${passed}/${ids.length} pass`);
process.exit(passed === ids.length ? 0 : 1);
