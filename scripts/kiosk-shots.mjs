#!/usr/bin/env node
/* Kiosk Sunroom acceptance run (Sill DS PR 1): the captures and the numeric checks that need a browser.
 * Every /kiosk/api/* answer is mocked from scripts/fixtures/kiosk/fixtures.mjs, so it needs only a running kiosk
 * page. Run on the server, never on production:
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/kiosk-shots.mjs
 *
 * Writes <OUT_DIR>/results.json and prints the same object as the LAST line (JSON). Needs Playwright >= 1.45
 * (not a dependency of this repo). Main states are /kiosk?theme=sunroom&wx=overcast&wxsun=day at 1180x820 and
 * 1024x768 with a fixed clock and a pinned time zone; the six-stop pass is ?theme=sunroom&wx=off with the weather
 * mocked per stop. JSON keys: n16PageErrors, n16ForeignRequests, n17RunningAnimations, n19BackdropFilter,
 * n20PaneInPane, sixStop.<stop>, crossing.{cloneSeen,ariaHidden,inert,strayClones,scopeIntact}.
 * PR 2 (controls): controls.<size>.<state>.{n11Small,n12LiveTransitions,n18ToneWithoutWord}, controls.reduced.<size>.n14Running,
 * controls.seen (the climate tile and chips rendered). States: rest, modal (climate), sheet (auto-off).
 * Rain zones: rain-<state>-full.png and rain-<state>-floor.png (y 700-800) at 1280x800 for heavy-night, storm-dusk and
 * drizzle-dusk, plus light-day, drizzle-day and light-day-reduced (midday sun, the last with reduced motion; the day ones add rain-<state>-floor-pad.png, y 560-800) (the rain is in the mocked weather, no ?wx=); rainZoneCover.<state> lists the visible controls in the
 * floor band (bottom edge below 0.75 x height, the ring spawn band) outside every [data-rain-zone] rect. Must be [].
 * PR 4 (ambient): ambient.radarGap.<size> (px, >= 16), ambient.<state>.{n11Small,n12LiveTransitions,n18ToneWithoutWord} for main-<midday|night>-<size>, rest (plus n17Running), stale (tagSeen,tagCount,tagText),
 * nowPlaying (seen,word,pip), carousel and carousel-1180x820 (before,after,pillBox,pillOffset{before,after,within1px}). Shots ambient-<state>-<size>.png.
 * UV and air (kiosk-uv): sunAir.N1..N11 (true/false; the run exits 1 if any is false), sunAir.entries.<Nx>[], sunAir.states, sunAir.std, sunAir.failed[]. Shots sunair-*.png.
 * Bin night (kiosk-bins): bins.N1..N9,N11,P3 (true/false; the run exits 1 if any is false), bins.entries.<Nx>[], bins.states, bins.settings.<state>, bins.failed[]. Shots bins-*.png. N10 is src/lib/bin-night.test.ts.
 * Calendar (kiosk-calendar): calendar.{C1..C6,C8,C9} (true/false; the run exits 1 if any is false), calendar.entries.<Cx>[], calendar.states, calendar.settings.<state>, calendar.failed[]. Shots calendar-*.png. C7 is src/lib/kiosk-agenda.test.ts.
 * Full view board (direction B): fullview.checks.<key> {ok,...}, fullview.failed[] (one line each; the run exits 1 if any), fullview.states, fullview.notRun[]. Shots fullview-*.png. Run this section alone: ONLY=fullview BASE_URL=... OUT_DIR=... node scripts/kiosk-shots.mjs
 * Corner controls (kiosk-corner): corner.checks.<key> {ok,...}, corner.failed[] (one line each; the run exits 1 if any). Shots corner-<state>-<size>.png.
 * Polish round: polish.p1.runningCount (1), polish.p3.{left,right,bottom} (>= 2), polish.p4-<stop>-<size>[] {fontPx >= 15, w, h >= 44}, polish.controls-<size>.{p5,p6,p7}. Shots polish-*.png.
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uvContrast } from "./kiosk-uv-contrast.mjs";
import { AUTO_OFF, LIST_EMPTY, LIST_STATES, LONG_NAMES, listBody, longNamesBody,HA_STATES, NOW_PLAYING, RAIN_HA_STATES, RAIN_NOW_PLAYING, PINNED_ISO, QUIET, RAIN_STATES, ROUTES, STOPS, SUN_AIR_STATES, SUN_AIR_STD, ZONE, rainWeatherFor, sunAirInstant, sunAirWeatherFor, weatherFor } from "./fixtures/kiosk/fixtures.mjs";
import { BIN_RULE_TWO, BIN_RULE_WED, BIN_STATES, CAL_DRAFT, CAL_LONGEST_ERROR, CAL_SETTINGS, CAL_STATES, binInstant, binWeatherFor, calInstant, calWeatherFor, settingsFullFor } from "./fixtures/kiosk/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const SIZES = [
  { name: "1180x820", viewport: { width: 1180, height: 820 } },
  { name: "1024x768", viewport: { width: 1024, height: 768 } },
];
const MAIN_URL = `${BASE_URL}/kiosk?theme=sunroom&wx=overcast&wxsun=day`;
// glance renders only the read-only climate summary; the controls live in the pinned standard layout
const CONTROLS_URL = `${MAIN_URL}&layout=standard`;
const STOP_URL = `${BASE_URL}/kiosk?theme=sunroom&wx=off`;
// no ?wx= at all: every preset ("off" too) replaces an unreachable payload with a synthetic ok one, so no outage would show
const SA_STALE_URL = `${BASE_URL}/kiosk?theme=sunroom`;

mkdirSync(OUT_DIR, { recursive: true });
const results = { errors: [], sixStop: {}, crossing: {} };
let pageErrors = 0;
const pageErrorMessages = {};
let consoleErrors = 0;
const consoleErrorMessages = {};
const consoleErrorLog = [];
let hydrationFull = null;
/** True when the kiosk error boundary ("Something went wrong") is on screen: a render crash, which counts as a failure. */
const crashed = (page) => page.getByText("Something went wrong").count().then((n) => n > 0);
const foreign = [];
const browser = await chromium.launch({ headless: true });

/** Wrap one block so a failure is recorded under its name and the rest still run. */
async function guarded(name, fn) {
  try {
    await fn();
  } catch (e) {
    results.errors.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

/** Wait until a selector exists; resolves false instead of throwing. */
async function seen(page, selector, timeout = 30_000) {
  try {
    await page.locator(selector).first().waitFor({ state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
}

/** A page with every /kiosk/api/* mocked; `weather` is read per request so a run can swap the sun. */
async function visit(url, { viewport, weather, fixedTime = false, reduced = false, instant = PINNED_ISO, ha = false, nowPlaying = false, rain = false, climateMode = null, routes = null, initScript = null, setup = null }) {
  const context = await browser.newContext({ viewport, timezoneId: ZONE, reducedMotion: reduced ? "reduce" : "no-preference" });
  // "flow" and "ticking": start at the pinned instant but keep time passing (SWR's focus throttle and dedupe read Date.now; ticking is also fast-forwarded)
  if (fixedTime === "flow" || fixedTime === "ticking") await context.clock.install({ time: new Date(instant) });
  else if (fixedTime) await context.clock.setFixedTime(new Date(instant));
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const state = { weather };
  page.on("pageerror", (e) => {
    pageErrors++;
    const m = String(e?.message ?? e).slice(0, 200);
    pageErrorMessages[m] = (pageErrorMessages[m] ?? 0) + 1;
  });
  // an error boundary swallows the throw, so pageerror never fires; React logs it to the console instead
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    consoleErrors++;
    const t = m.text().slice(0, 200);
    consoleErrorMessages[t] = (consoleErrorMessages[t] ?? 0) + 1;
    // the full hydration text names the differing attribute (its diff follows the 200-char intro)
    if (/hydrated but some attributes/.test(t) && !hydrationFull) {
      hydrationFull = "pending"; // React passes the attribute diff as a %s argument, so it isn't in m.text()
      Promise.all(m.args().map((a) => a.jsonValue().catch(() => String(a))))
        .then((v) => { hydrationFull = v.map(String).join("\n").slice(0, 6000); }, (e) => { hydrationFull = `args unreadable: ${e}`; });
    }
    // page.step names the script step; url + viewport + clock-pinned tell whether setFixedTime causes a hydration mismatch
    consoleErrorLog.push({ msg: t, page: page.url(), source: m.location().url, step: page.step ?? "load", viewport: `${viewport.width}x${viewport.height}`, fixedTime });

  });
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreign.push(u);
  });
  await page.route("**/kiosk/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (routes && path in routes) return route.fulfill({ json: routes[path] }); // a caller's mutable per-path answer wins
    const json = path.endsWith("/weather")
      ? state.weather
      : path.endsWith("/attention")
        ? { status: "quiet" }
        : ha && path.endsWith("/ha/states")
          ? climateMode
            ? { ...HA_STATES, entities: { ...HA_STATES.entities, climates: HA_STATES.entities.climates.map((c, i) => (i === 0 ? { ...c, hvacMode: climateMode } : c)) } }
            : (rain ? RAIN_HA_STATES : HA_STATES)
          : ha && path.endsWith("/climate-auto-off")
            ? AUTO_OFF
            : nowPlaying && path.endsWith("/nowplaying")
              ? (rain ? RAIN_NOW_PLAYING : NOW_PLAYING)
              : (ROUTES[path] ?? QUIET);
    return route.fulfill({ json });
  });
  if (setup) await setup(page); // per-state routes registered last, so they win over the generic answer above
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Hide the Next dev indicator (the round "N" badge) from every capture; next.config is untouched.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await seen(page, '[data-kiosk-theme="sunroom"]');
  await page.waitForTimeout(1200);
  if (await crashed(page)) (results.crashed ??= []).push(`${url} ${viewport.width}x${viewport.height}`);
  await page.waitForFunction(() => !document.querySelector(".sr-stopfade"), null, { timeout: 5000 }).catch(() => {}); // shoot the settled stop only
  return { context, page, state };
}

/** Shoot first, then measure. */
const SCAN = () => {
  const scope = document.querySelector('[data-kiosk-theme="sunroom"]');
  const cs = scope ? getComputedStyle(scope) : null;
  const v = (n) => (cs ? cs.getPropertyValue(n).trim() : "");
  const rootsOk = (el) => !el.closest(".kiosk-climate-working, .kiosk-sr-weather, .kiosk-sky, .kiosk-leaks");
  return {
    vars: { bg: v("--sr-bg"), panel: v("--sr-panel"), ink: v("--sr-ink"), accent: v("--sr-accent"), pane: v("--sr-shadow-pane"), pressX: v("--sr-press-x"), pressY: v("--sr-press-y") },
    running: document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.target && rootsOk(a.effect.target))
      .map((a) => `${a.effect.target.className || a.effect.target.tagName}:${a.animationName ?? a.transitionProperty ?? ""}`),
    backdrop: [...document.querySelectorAll("*")].filter((el) => {
      const b = getComputedStyle(el).backdropFilter;
      return b && b !== "none";
    }).length,
    paneInPane: [...document.querySelectorAll(".panel")].filter((el) => el.parentElement?.closest(".panel")).length,
  };
};

// ---- full view board (direction B "Board"): section 6 checks 1-14 of the shape brief, run alone with ONLY=fullview ----
// Standard view at 1024x768 and 1180x820 (no page scroll on the crowded evening), 390x844 (scrolled, two viewport shots).
// Every number is read from the token or house class it measures (probes below); a failing check lands in results.fullview.failed with its number.
const FV = (results.fullview = { checks: {}, failed: [], states: {}, notRun: [] });
const fvRec = (key, ok, detail = {}) => { FV.checks[key] = { ok, ...detail }; if (!ok) FV.failed.push(`${key} ${JSON.stringify(detail)}`); };
const lg0 = (size) => size.viewport.width >= 1024;
const fvNear =(a, b, tol = 1) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const fvHits = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const FV_SIZES = [...SIZES, { name: "390x844", viewport: { width: 390, height: 844 } }];
// fvpolish item 6: `sun` is the explicit wxsun pin, and an explicit wxsun BEATS the stop (kiosk-weather-fx.ts applyWxPreview), so a night capture must pass sun: "night" (it used to ride wxsun=day, a day Sunroom).
const FV_URL = (theme = "sunroom", layout = "standard", sun = "day", wx = "overcast") => `${BASE_URL}/kiosk?theme=${theme}&wx=${wx}&wxsun=${sun}&layout=${layout}`;
const FV_LIGHT = ["Bedside", "Hallway ceiling lamp north", "Kitchen strip", "Reading light", "Porch", "Study desk", "Landing", "Wardrobe", "Garage", "Studio"];
const FV_SWITCH = ["Fan", "Heater", "Kettle", "Dehumidifier", "Speaker", "Printer", "Router", "Radio", "Towel rail", "Pump"];
/** An HA answer: `zones` climates, `lights` + `switches` toggles, `scenes`, `sensors` (names are invented, none share a prefix). */
function fvHa({ zones = 2, lights = 5, switches = 5, scenes = 4, sensors = 2 } = {}) {
  const zoneNames = ["Living", "Study", "Bedroom", "Office", "Garage"];
  const nm = (list, i) => (i < list.length ? list[i] : `${list[i % list.length]} ${i}`);
  return {
    status: "ok",
    entities: {
      ...HA_STATES.entities,
      climates: Array.from({ length: zones }, (_, i) => ({ ...HA_STATES.entities.climates[0], entityId: `climate.z${i}`, name: zoneNames[i % 5] })),
      lights: Array.from({ length: lights }, (_, i) => ({ entityId: `light.l${i}`, name: nm(FV_LIGHT, i), on: i % 2 === 0, brightnessPct: i % 2 === 0 ? 62 : null, available: i !== 3 })),
      switches: Array.from({ length: switches }, (_, i) => ({ entityId: `switch.s${i}`, name: nm(FV_SWITCH, i), on: i % 2 === 1, available: true })),
      scenes: Array.from({ length: scenes }, (_, i) => ({ entityId: `scene.c${i}`, name: ["Evening", "Movie", "Bright", "Night", "Away", "Dinner"][i % 6], available: true })),
      sensors: Array.from({ length: sensors }, (_, i) => ({ entityId: `sensor.m${i}`, name: ["Hall temp", "Cellar humidity", "Door battery"][i % 3], kind: ["temperature", "humidity", "battery"][i % 3], value: [21, 54, 88][i % 3], unit: ["°C", "%", "%"][i % 3], available: true })),
    },
  };
}
const FV_DOOR = { status: "ok", cameras: [{ entityId: "camera.front_door", name: "Front door", available: true }], triggers: [], latest: null, autoOpen: true, viewCamera: null, lastSeenAt: "2026-06-14T13:58:00.000Z" }; // "Seen yesterday 11:58 pm" at the pinned evening
const FV_BRIEFING = { status: "ok", date: "2026-06-15", digest: { headline: "Overnight: two things need a look", body: "- Backup finished at 02:14 - Disk 81% on the media volume - Two containers restarted after the 03:00 update - Router firmware 4.2 is available", actionNeeded: "no" }, news: { summary: "- Grid operator warns of a cold snap this week\n- Council approves the new tram extension\n- Local team wins the cup final in extra time", headlines: [], source: "ABC News" } }; // the longest Today case: a four-item digest and a three-line news summary
const FV_DL = { status: "ok", items: Array.from({ length: 3 }, (_, i) => ({ hash: `h${i}`, name: `Download number ${i + 1}`, progress: 0.3, dlspeed: 1_500_000, size: 4_000_000_000, eta: 900 })) };
const FV_ALERT = { status: "attention", severity: "warn", headline: "Backup is late", detail: "Last run was two days ago.", action: "Check the backup job." };
const FV_TIMER = (state) => `localStorage.setItem("kiosk-timers", JSON.stringify([{ id: "t1", name: "Roast", endsAt: ${new Date(calInstant(CAL_STATES[state].at)).getTime() + 5_025_000}, durationMs: 5025000, pausedRemainingMs: 5025000 }]));`; // 1:23:45
/** A visit to the Standard view: the crowded evening by default (agenda 3 rows + more, bin night, now playing, alert, downloads, a camera, a timer, a list). */
const fvVisit = (size, { state = "crowded", ha = fvHa(), extra = {}, theme = "sunroom", timer = true, setup = null, layout = "standard", np = true, sun = "day", wx = "overcast" } = {}) =>
  visit(FV_URL(theme, layout, sun, wx), {
    viewport: size.viewport, weather: calWeatherFor(state), fixedTime: true, instant: calInstant(CAL_STATES[state].at), ha: true, nowPlaying: np, initScript: timer ? FV_TIMER(state) : null, setup,
    routes: { "/kiosk/api/calendar": CAL_STATES[state].body, "/kiosk/api/bins": BIN_STATES.crowded.body, "/kiosk/api/ha/states": ha, "/kiosk/api/doorbell": FV_DOOR, "/kiosk/api/downloads": FV_DL, "/kiosk/api/attention": FV_ALERT, "/kiosk/api/list": LIST_STATES.crowded.body, ...extra },
  });
const fvWake = async (page, size, state) => { if (state === "woken-night") { await page.mouse.click(size.viewport.width / 2, size.viewport.height / 2); await page.waitForTimeout(800); } };

/** Everything the 14 checks need, in one evaluate. Token sizes come from probes of the Sunroom token, never a free number. */
const FV_READ = () => {
  const scope = document.querySelector('[data-kiosk-theme]');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
  const probe = (css) => { const el = document.createElement("span"); el.style.cssText = `position:absolute;visibility:hidden;${css}`; scope.append(el); const cs = getComputedStyle(el); const o = { size: parseFloat(cs.fontSize), track: cs.letterSpacing, w: parseFloat(cs.width) }; el.remove(); return o; };
  const tok = { hit: probe("width:var(--sr-hit)").w, hitMin: probe("width:var(--sr-hit-min)").w, sp2: probe("width:var(--sr-space-2)").w, sp3: probe("width:var(--sr-space-3)").w, sp4: probe("width:var(--sr-space-4)").w, sp6: probe("width:var(--sr-space-6)").w,
    reading: probe("font:var(--sr-type-reading);letter-spacing:var(--sr-track-reading)"), figure: probe("font:var(--sr-type-figure)"), body: probe("font:var(--sr-type-body)"), label: probe("font:var(--sr-type-label)"), meta: probe("font:var(--sr-type-meta)"), micro: probe("font:var(--sr-type-micro)") };
  const fs = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
  // The chip name's size is the house `sr-chip-sm` name (`.sr-chip-name text-sm`), probed in a real chip, not `--sr-type-label` (which sets the chip's own font).
  const chipProbe = document.createElement("button"); chipProbe.className = "sr-chip sr-chip-sm"; chipProbe.style.cssText = "position:absolute;visibility:hidden"; chipProbe.innerHTML = '<span class="sr-chip-name text-sm">x</span>'; scope.append(chipProbe);
  const chipNameSize = fs(chipProbe.firstElementChild), chipRadius = parseFloat(getComputedStyle(chipProbe).borderTopLeftRadius); chipProbe.remove();
  // N5's cell radius is the computed `.panel` radius in Sunroom (1.25rem), probed from a real `.panel`.
  const panelProbe = document.createElement("div"); panelProbe.className = "panel"; panelProbe.style.cssText = "position:absolute;visibility:hidden"; scope.append(panelProbe);
  const panelRadius = parseFloat(getComputedStyle(panelProbe).borderTopLeftRadius); panelProbe.remove();
  const header =document.querySelector("header.kiosk-hdr-grid");
  const board = document.querySelector(".max-w-6xl.grid-cols-12");
  const cells = board ? [...board.querySelectorAll(":scope > section.panel")].map((c) => ({ name: (c.querySelector("h2")?.textContent ?? "").trim(), rect: r(c), radius: parseFloat(getComputedStyle(c).borderTopLeftRadius), padL: parseFloat(getComputedStyle(c).paddingLeft), headSize: fs(c.querySelector("h2.microlabel")), headTrack: c.querySelector("h2.microlabel") ? getComputedStyle(c.querySelector("h2.microlabel")).letterSpacing : null })) : [];
  const chipOf = (b) => { const name = b.querySelector(".sr-chip-name"), sub = b.querySelector(".sr-chip-sub"); return { label: b.getAttribute("aria-label"), rect: r(b), radius: parseFloat(getComputedStyle(b).borderTopLeftRadius), nameText: name?.textContent ?? "", nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : false, nameEllipsis: name ? getComputedStyle(name).textOverflow === "ellipsis" : false, nameSize: fs(name), title: b.getAttribute("title"), subClipped: sub ? sub.scrollWidth > sub.clientWidth + 1 : false, nameW: name ? name.clientWidth : 0, iconW: b.querySelector("svg")?.getBoundingClientRect().width ?? 0, hasWord: !!b.querySelector(".sr-state"), available: !b.disabled, lit: b.getAttribute("aria-checked") === "true", subText: sub?.textContent ?? "" }; };
  const chips = [...document.querySelectorAll('button[role="switch"]')].map(chipOf);
  const scenes = [...document.querySelectorAll('button[aria-label^="Activate "]')].map((b) => ({ rect: r(b), radius: parseFloat(getComputedStyle(b).borderTopLeftRadius), nameText: b.querySelector(".sr-chip-name")?.textContent ?? "", nameW: b.querySelector(".sr-chip-name")?.clientWidth ?? 0, pip: r(b.querySelector(".sr-pip")), idleStatus: !!b.querySelector(".sr-chip-sub") }));
  const dock = document.querySelector('[data-rain-zone="dock"]');
  const cluster = document.querySelector('div[data-rain-zone="corner"]:not([role])');
  const buttonsIn = (root) => [...(root?.querySelectorAll("button") ?? [])].filter((b) => b.offsetParent !== null || getComputedStyle(b).position === "fixed").map((b) => ({ label: b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 16), rect: r(b) }));
  const hero = header ? { rect: r(header), padL: parseFloat(getComputedStyle(header).paddingLeft), colGap: parseFloat(getComputedStyle(header).columnGap), position: getComputedStyle(header).position, filter: getComputedStyle(header).filter, backdrop: getComputedStyle(header).backdropFilter, transform: getComputedStyle(header).transform } : null;
  const time = document.querySelector('[data-hero="time"]'), date = document.querySelector('[data-hero="date"]'), temp = document.querySelector('[data-hero="temp"]'), cond = document.querySelector('[data-hero="cond"]');
  const line = header?.querySelector("[data-weather-line]");
  const tile = document.querySelector(".sr-climate");
  const tileBox = tile ? tile.closest("section.panel")?.querySelectorAll(".sr-climate") : [];
  const nudgeTiles = [...tileBox].map((t) => ({ nudges: [...t.querySelectorAll(".sr-btn-nudge")].map(r), target: [...t.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^\s*\d{2}(\.\d)?\s*°?\s*[CF]?\s*$/.test(e.textContent ?? "")).map(r) }));
  const scrollers = board ? [...board.querySelectorAll("*")].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1; }).map((e) => e.tagName) : [];
  const clipped = [...document.querySelectorAll("header.kiosk-hdr-grid *, .max-w-6xl.grid-cols-12 *")].filter((e) => { const cs = getComputedStyle(e); return e.children.length === 0 && (e.textContent ?? "").trim() && e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis"; }).map((e) => (e.textContent ?? "").trim().slice(0, 24));
  const agTime = document.querySelector("[data-agenda-row] .font-mono"), agTitle = document.querySelector("[data-agenda-row] > span:nth-child(3)"), binRow = document.querySelector('[data-bin-night="row"]');
  return {
    hdrCols: header ? [...header.children].slice(0, 5).map((c) => r(c)) : [], lineKidsW: line ? [...line.children].map((k) => Math.round(k.scrollWidth)) : [],
    vw: innerWidth, vh: innerHeight, scrollH: document.scrollingElement.scrollHeight, scrollY: scrollY, tok: { ...tok, chipName: chipNameSize, panelRadius, chipRadius }, hero, board: r(board), cells, chips, scenes, scrollers, clipped, nudgeTiles,
    time: time ? { rect: r(time), size: fs(time), track: getComputedStyle(time).letterSpacing } : null, date: date ? { rect: r(date), size: fs(date), lh: parseFloat(getComputedStyle(date).lineHeight) } : null,
    temp: fs(temp), tempRect: r(temp), cond: fs(cond), line: line ? { size: fs(line.firstElementChild), kids: [...line.children].map((k) => ({ ellipsis: getComputedStyle(k).textOverflow === "ellipsis", clipped: k.scrollWidth > k.clientWidth + 1 })), rect: r(line) } : null,
    dock: dock ? { rect: r(dock), position: getComputedStyle(dock).position, buttons: buttonsIn(dock) } : null, cluster: r(cluster), clusterButtons: buttonsIn(cluster),
    heads: cells.map((c) => c.name), agTime: fs(agTime), agTitle: fs(agTitle), binSize: fs(binRow), emptyLine: document.querySelector("[data-today-empty]")?.textContent ?? null,
    hasBoard: !!board, nowPlaying: !!document.querySelector("[data-sr-np]"),
  };
};

/** Section 6 checks against one read. `lg` is true from 1024 px: the dock is fixed, the board has its 12 columns. */
function fvChecks(d, size, tag, { crowded = true } = {}) {
  const lg = d.vw >= 1024;
  const k = (n) => `${tag} N${n}`;
  const cell = (n) => d.cells.find((c) => new RegExp(`^${n}`, "i").test(c.name));
  const today = cell("today"), climate = cell("climate"), lights = cell("lights"), scenes = cell("scenes");
  const hits = [...d.chips.map((c) => c.rect), ...d.scenes.map((c) => c.rect)];
  // 1: every control >= --sr-hit-min; dock buttons and both cluster tiles >= --sr-hit; chips exactly --sr-hit-min
  const small = [...(d.dock?.buttons ?? []), ...d.clusterButtons].filter((b) => b.rect.h < d.tok.hit - 0.5).map((b) => b.label);
  const under = hits.filter((h) => h.h < d.tok.hitMin - 0.5 || h.h > d.tok.hitMin + 0.5).length;
  fvRec(k(1), small.length === 0 && under === 0 && d.chips.length > 0, { smallerThanHit: small, chipsNotHitMin: under, hit: d.tok.hit, hitMin: d.tok.hitMin });
  // 2: the clock is --sr-type-reading with its tracking; the date is one --sr-type-label line and stays inside the clock column
  const col1 = d.time && d.date ? { left: Math.min(d.time.rect.left, d.date.rect.left), right: Math.max(d.time.rect.right, d.date.rect.right) } : null;
  fvRec(k(2), !!d.time && fvNear(d.time.size, d.tok.reading.size, 0.5) && d.time.track === d.tok.reading.track && !!d.date && fvNear(d.date.size, d.tok.label.size, 0.5) && d.date.rect.h <= d.date.lh * 1.5 && (!lg || (col1 && d.hero && col1.right <= d.hero.rect.right)), { time: d.time && { size: d.time.size, track: d.time.track }, want: d.tok.reading, date: d.date && { size: d.date.size, h: d.date.rect.h, lh: d.date.lh } });
  // 3: type roles
  const agOk = d.agTime === null || (fvNear(d.agTime, d.tok.meta.size, 0.5) && fvNear(d.agTitle, d.tok.label.size, 0.5));
  const ell = !d.line || d.line.kids.every((q) => !q.clipped || q.ellipsis);
  fvRec(k(3), fvNear(d.temp, d.tok.figure.size, 0.5) && fvNear(d.cond, d.tok.body.size, 0.5) && (!d.line || fvNear(d.line.size, d.tok.meta.size, 0.5)) && ell && d.cells.every((c) => c.headSize === null || fvNear(c.headSize, d.tok.micro.size, 0.5)) && d.chips.every((c) => fvNear(c.nameSize, d.tok.chipName, 0.5)) && agOk, { temp: d.temp, cond: d.cond, line: d.line && d.line.size, agTime: d.agTime, agTitle: d.agTitle, chipName: d.chips[0]?.nameSize, heads: d.cells.map((c) => c.headSize), tok: { figure: d.tok.figure.size, body: d.tok.body.size, meta: d.tok.meta.size, label: d.tok.label.size, micro: d.tok.micro.size, chipName: d.tok.chipName } });
  // 4: spacing: cell padding and board gaps --sr-space-3; page padding --sr-space-4; hero column gap --sr-space-6, hero padding-x --sr-space-6 (lg)
  const gapsOk = lg && today && climate ? fvNear(climate.rect.left - today.rect.right, d.tok.sp3, 0.6) && (!lights || fvNear(lights.rect.top - Math.max(today.rect.bottom, climate.rect.bottom), d.tok.sp3, 0.6)) : true;
  fvRec(k(4), d.cells.every((c) => fvNear(c.padL, d.tok.sp3, 0.5)) && gapsOk && fvNear(d.board?.left, lg ? d.tok.sp4 : d.tok.sp3, 0.6) && (!lg || (fvNear(d.hero.colGap, d.tok.sp6, 0.5) && fvNear(d.hero.padL, d.tok.sp6, 0.5))), { padL: d.cells.map((c) => c.padL), boardLeft: d.board?.left, hero: d.hero && { colGap: d.hero.colGap, padL: d.hero.padL }, sp3: d.tok.sp3, sp4: d.tok.sp4, sp6: d.tok.sp6 });
  // 5: cell radius is the computed `.panel` radius in Sunroom (1.25rem = 20px); chips are pills
  fvRec(k(5), d.cells.every((c) => fvNear(c.radius, d.tok.panelRadius, 0.5)) && d.chips.every((c) => fvNear(c.radius, d.tok.chipRadius, 0.5)), { radii: d.cells.map((c) => c.radius), panel: d.tok.panelRadius, chipRadii: [...new Set(d.chips.map((c) => c.radius))], chipSm: d.tok.chipRadius });
  // 6: cells in one row have equal bottoms
  fvRec(k(6), !lg || ((!climate || fvNear(today.rect.bottom, climate.rect.bottom, 0.5)) && (!scenes || !lights || fvNear(lights.rect.bottom, scenes.rect.bottom, 0.5))), { today: today?.rect.bottom, climate: climate?.rect.bottom, lights: lights?.rect.bottom, scenes: scenes?.rect.bottom });
  // 7: dock to cluster gap >= --sr-space-6 (worst state); at any size no cluster rect meets a dock button or the hero temperature
  const dockR = d.dock?.rect, cl = d.cluster;
  const meets = [...(d.dock?.buttons ?? [])].some((b) => fvHits(b.rect, cl)) || fvHits(d.tempRect, cl);
  fvRec(k(7), !meets && (!lg || !cl || !dockR || cl.left - dockR.right >= d.tok.sp6 - 0.5), { gap: lg && cl && dockR ? cl.left - dockR.right : null, want: d.tok.sp6, meets });
  // 8: the dock's left inset equals the cluster's right inset (1.25rem + safe area); both bottoms are 1rem (--sr-space-4)
  if (lg) fvRec(k(8), !!dockR && !!cl && d.dock.position === "fixed" && fvNear(dockR.left, d.vw - cl.right, 0.6) && fvNear(dockR.left, 20, 0.6) && fvNear(d.vh - dockR.bottom, d.tok.sp4, 0.6) && fvNear(d.vh - cl.bottom, d.tok.sp4, 0.6), { dockLeft: dockR?.left, clusterRight: cl && d.vw - cl.right, dockBottom: dockR && d.vh - dockR.bottom, clusterBottom: cl && d.vh - cl.bottom, position: d.dock?.position });
  // 9: no page scroll with the crowded fixture at 1024x768 and 1180x820; the board bottom plus --sr-space-3 sits at or above the dock top
  if (lg && crowded) fvRec(k(9), d.scrollH <= d.vh && d.board.bottom + d.tok.sp3 <= (dockR?.top ?? d.vh) + 0.5, { scrollH: d.scrollH, vh: d.vh, boardBottom: d.board.bottom, dockTop: dockR?.top });
  // 11: chips at 1024 in 3 columns: a short name ("Bedside") shows in full; a longer one ends in an ellipsis with its title; the sub is never clipped
  if (d.vw === 1024) {
    const bed = d.chips.find((c) => c.nameText === "Bedside"), long = d.chips.find((c) => c.nameText.length > 14);
    fvRec(k(11), !!bed && !bed.nameClipped && (!long || (long.nameEllipsis && long.title === FV_LIGHT[1])) && d.chips.every((c) => !c.nameClipped || c.nameW >= 5 * 7), { bedside: bed && { clipped: bed.nameClipped }, long: long && { ellipsis: long.nameEllipsis, title: long.title }, minNameW: Math.min(...d.chips.map((c) => c.nameW)), subClipped: d.chips.filter((c) => c.subClipped).length });
  }
  // 11b (fix 1): no plain ON/OFF word on a toggle chip; every chip icon >= 14 px; an unavailable chip shows its name; at 1024 (3 columns) a name of 12 characters or fewer shows in
  // full, at 390 (2 columns) a name of 7 or fewer (the shortened name is what is measured; a 62% sub or "unavailable" gives way first); the name keeps 5 characters (min-w-[5ch]).
  if (d.vw === 1024 || d.vw === 390) {
    const fit = d.vw === 1024 ? 12 : 7;
    const short = d.chips.filter((c) => c.nameText.length > 0 && c.nameText.length <= fit);
    const bad = short.filter((c) => c.nameClipped).map((c) => c.nameText);
    const unavail = d.chips.filter((c) => !c.available);
    fvRec(k("11b chips"), d.chips.length > 0 && short.length > 0 && bad.length === 0 && d.chips.every((c) => !c.hasWord && c.iconW >= 14 - 0.5 && c.nameText.length > 0 && c.nameW > 0) && unavail.every((c) => c.nameW >= 5 * 7), { fit, shortChecked: short.length, clippedShort: bad, withWord: d.chips.filter((c) => c.hasWord).length, minIcon: Math.min(...d.chips.map((c) => c.iconW)), unavailable: unavail.map((c) => [c.nameText, c.nameW]) });
  }
  // 1b (fix 1): every scene chip shows its name (non-zero width, the fixture's scene name), no idle status text, and the pip sits inside the chip
  if (d.scenes.length) fvRec(k("1b scene chips"), d.scenes.every((s) => s.nameW > 0 && ["Evening", "Movie", "Bright", "Night", "Away", "Dinner"].includes(s.nameText) && s.pip && s.pip.left >= s.rect.left - 0.5 && s.pip.right <= s.rect.right + 0.5 && !s.idleStatus), { scenes: d.scenes.map((s) => [s.nameText, Math.round(s.nameW), s.idleStatus, s.pip && Math.round(s.rect.right - s.pip.right)]) });
  // 15 (fix 1): from lg the weather band uses the room between the clock column and the rail: each reading shows in full on one line (no ellipsis) with the crowded fixture
  if (lg && d.line) fvRec(k(15), d.line.kids.every((q) => !q.clipped) && (!crowded || d.line.kids.length >= 2), { heroH: d.hero && Math.round(d.hero.rect.h), readings: d.line.kids.length, kidsScrollW: d.lineKidsW, lineW: Math.round(d.line.rect.w), cols: d.hdrCols.map((c) => c && [Math.round(c.left), Math.round(c.right)]) });
  // 14: layout check (this repo has no e2e capture helper): no inner scroller on the board, no clipped text without an ellipsis, no dock button over board text
  fvRec(k(14), d.scrollers.length === 0 && d.clipped.length === 0, { scrollers: d.scrollers, clipped: d.clipped });
}

/** A padded crop of one element; an element taller than the viewport is two viewport shots (top and end), never a tall crop. */
async function fvCrop(page, locator, name) {
  const box = await locator.first().boundingBox().catch(() => null);
  if (!box) return FV.notRun.push(`${name}: element absent`);
  const vp = page.viewportSize();
  if (box.height > vp.height - 24) {
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT_DIR, `fullview-${name}-top.png`) });
    await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight)); await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT_DIR, `fullview-${name}-end.png`) });
    await page.evaluate(() => scrollTo(0, 0));
    return;
  }
  const y = box.y + (await page.evaluate(() => scrollY));
  await page.screenshot({ path: join(OUT_DIR, `fullview-${name}.png`), fullPage: true, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, y - 12), width: Math.min(vp.width, box.width + 24), height: box.height + 24 } });
}
const fvCell = (page, name) => page.locator("section.panel", { has: page.locator("h2", { hasText: new RegExp(`^${name}`, "i") }) });

async function fullViewBoard() {
  // the crowded evening at both tablet sizes: checks 1-9, 11, 14 (+ pages for the three breakpoints)
  for (const size of FV_SIZES) {
    await guarded(`fullview crowded ${size.name}`, async () => {
      const { context, page } = await fvVisit(size);
      await seen(page, "section.panel h2", 15_000);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.fonts.ready);
      const d = await page.evaluate(FV_READ);
      FV.states[`crowded-${size.name}`] = { cells: d.heads, chips: d.chips.length, scrollH: d.scrollH, vh: d.vh, nowPlaying: d.nowPlaying, dockButtons: d.dock?.buttons.map((b) => b.label) };
      fvChecks(d, size, `crowded-${size.name}`);
      // brief 2.1 / 2.3: the hero carries no transform, filter or backdrop-filter. This visit is pinned (layout=standard), where Glance is hidden: Timers, Shopping, Front door, Admin.
      // The order with Glance is the unpinned state below ("fullview unpinned").
      const order = (d.dock?.buttons ?? []).map((b) => b.label).join("|");
      fvRec(`crowded-${size.name} dock order`, /^Timer.*\|Shopping.*\|View the front door.*\|Admin$/.test(order), { order });
      // fix 1 item 5: below lg the dock wraps button by button, so the timer and Shopping share the first row
      if (!lg0(size)) { const [t, s] = d.dock.buttons; fvRec(`crowded-${size.name} dock wraps naturally`, !!t && !!s && Math.abs(t.rect.top - s.rect.top) < 1, { timerTop: t?.rect.top, shoppingTop: s?.rect.top }); }
      if (size.name !== "390x844") await page.screenshot({ path: join(OUT_DIR, `fullview-${size.name}-day.png`), fullPage: true });
      else {
        // 390: scrolled, two viewport shots; N10 the last cell clears the cluster by --sr-space-4
        await page.screenshot({ path: join(OUT_DIR, "fullview-390x844-day-top.png") });
        await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
        await page.waitForTimeout(400);
        const e = await page.evaluate(FV_READ);
        const lastCell = e.cells.at(-1);
        fvRec("390 N10 last cell clears the cluster", !!lastCell && !!e.cluster && lastCell.rect.bottom <= e.cluster.top - e.tok.sp4 + 0.5 && !fvHits(e.tempRect, e.cluster) && !(e.dock?.buttons ?? []).some((b) => fvHits(b.rect, e.cluster)), { lastBottom: lastCell?.rect.bottom, clusterTop: e.cluster?.top, sp4: e.tok.sp4 });
        await page.screenshot({ path: join(OUT_DIR, "fullview-390x844-day-end.png") });
      }
      if (size.name === "1024x768") {
        await fvCrop(page, fvCell(page, "today"), "today-short-agenda-nowplaying");
        await fvCrop(page, page.locator('[data-rain-zone="dock"]'), "dock-worst");
        await page.getByRole("button", { name: /download/i }).first().click().catch(() => {});
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(OUT_DIR, "fullview-1024x768-downloads-tray.png") });
      }
      await context.close();
    });
  }
  // night: the woken full view at 1024x768, checks 1-8 and 14
  // fix 1 item 4: Glance is hidden while the view is pinned (layout=standard or elevated), so the full view reached FROM Glance (unpinned) is the state with the Glance button
  await guarded("fullview unpinned", async () => {
    const size = SIZES[1];
    const { context, page } = await fvVisit(size, { layout: "glance" });
    await page.mouse.click(size.viewport.width / 2, size.viewport.height / 2);
    await seen(page, "section.panel h2", 15_000);
    await page.waitForTimeout(1500);
    const d = await page.evaluate(FV_READ);
    const order = (d.dock?.buttons ?? []).map((b) => b.label).join("|");
    fvRec("unpinned-1024x768 dock order with Glance", /^Timer.*\|Shopping.*\|View the front door.*\|Back to glance.*\|Admin$/.test(order), { order });
    await fvCrop(page, page.locator('[data-rain-zone="dock"]'), "dock-unpinned");
    await context.close();
  });
  await guarded("fullview night", async () => {
    const size = SIZES[1];
    // fvpolish item 6: the night pin is wxsun=night with wx=off (clear: no cloud greying of the palette, so --sr-bg is the night stop's own bg).
    const { context, page } = await fvVisit(size, { state: "woken-night", sun: "night", wx: "off" });
    await fvWake(page, size, "woken-night");
    await page.waitForTimeout(1200);
    const d = await page.evaluate(FV_READ);
    fvChecks(d, size, "night-1024x768", { crowded: false });
    const srBg = (p) => p.evaluate(() => getComputedStyle(document.querySelector("[data-kiosk-theme]")).getPropertyValue("--sr-bg").trim().toLowerCase());
    const nightBg = await srBg(page);
    // fvpolish fix 1 item 6: the day read and the assert come before the night shot, so a wrong pin is recorded before the capture exists.
    const day = await fvVisit(size, { sun: "day", wx: "off" });
    await seen(day.page, "section.panel h2", 15_000);
    await day.page.waitForTimeout(1200);
    const dayBg = await srBg(day.page);
    await day.context.close();
    // The stop's bg is read from the source, never typed here.
    const src = readFileSync(new URL("../src/lib/sunroom-light.ts", import.meta.url), "utf8");
    const stopBg = src.match(/name: "night"[\s\S]*?bg: "(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase();
    fvRec("night capture: Sunroom --sr-bg is the night stop's bg and differs from day", !!stopBg && nightBg === stopBg && dayBg !== nightBg, { nightBg, stopBg, dayBg });
    await page.screenshot({ path: join(OUT_DIR, "fullview-night-1024.png"), fullPage: true });
    await context.close();
  });
  // aerogel (a glass .panel theme): the dock's left and bottom equal the viewport insets, and the page fits or scrolls without an inner scroller
  await guarded("fullview aerogel", async () => {
    const { context, page } = await fvVisit(SIZES[1], { theme: "aerogel" });
    await seen(page, "section.panel h2", 15_000);
    await page.waitForTimeout(1500);
    const d = await page.evaluate(FV_READ);
    fvRec("aerogel 1024 dock insets", !!d.dock && d.dock.position === "fixed" && fvNear(d.dock.rect.left, 20, 0.6) && fvNear(d.vh - d.dock.rect.bottom, 16, 0.6) && (d.scrollH <= d.vh || d.scrollers.length === 0), { dockLeft: d.dock?.rect.left, dockBottom: d.dock && d.vh - d.dock.rect.bottom, scrollH: d.scrollH, vh: d.vh, scrollers: d.scrollers });
    // logged, never failed: Aerogel's panel colour is itself translucent (#ffffff8c), so its dock buttons rely on the blur
    const ag = await page.evaluate(() => [...document.querySelectorAll('[data-rain-zone="dock"] button')].map((b) => { const s = getComputedStyle(b); const k = document.createElement("canvas"); k.width = k.height = 1; const x = k.getContext("2d", { willReadFrequently: true }); x.fillStyle = s.backgroundColor; x.fillRect(0, 0, 1, 1); return { label: (b.getAttribute("aria-label") ?? "").slice(0, 20), alpha: +(x.getImageData(0, 0, 1, 1).data[3] / 255).toFixed(2), blur: s.backdropFilter }; }));
    fvRec("aerogel 1024 dock button surface (logged)", true, { btns: ag });
    await page.screenshot({ path: join(OUT_DIR, "fullview-aerogel-1024x768.png"), fullPage: true });
    await context.close();
  });
  // row 1 by zone count (1 and 3 zones: N12 the three-zone tile's nudges never meet its target text)
  for (const zones of [1, 3]) {
    await guarded(`fullview ${zones} zones`, async () => {
      const { context, page } = await fvVisit(SIZES[1], { ha: fvHa({ zones }) });
      await seen(page, ".sr-climate", 15_000);
      await page.waitForTimeout(1200);
      const d = await page.evaluate(FV_READ);
      const today = d.cells.find((c) => /^today/i.test(c.name)), climate = d.cells.find((c) => /^climate/i.test(c.name));
      const colW = (d.board.right - d.board.left - 11 * d.tok.sp3) / 12;
      const span = (c) => Math.round((c.rect.w + d.tok.sp3) / (colW + d.tok.sp3));
      fvRec(`${zones} zones row 1 spans`, span(today) === (zones === 1 ? 7 : 4) && span(climate) === (zones === 1 ? 5 : 8), { today: span(today), climate: span(climate) });
      if (zones === 3) {
        const bad = d.nudgeTiles.filter((t) => t.nudges.some((n) => t.target.some((x) => fvHits(n, x))));
        fvRec("3 zones N12 nudges clear of the target text", d.nudgeTiles.length === 3 && bad.length === 0 && d.nudgeTiles.every((t) => t.target.length > 0), { tiles: d.nudgeTiles.length, overlapping: bad.length, targets: d.nudgeTiles.map((t) => t.target.length) });
      }
      await fvCrop(page, fvCell(page, "climate"), `climate-${zones}-zone${zones > 1 ? "s" : ""}`);
      await context.close();
    });
  }
  // entity counts: 1, 12 (the 1024 ceiling, no scroll), 20 (the page scrolls, never a cell)
  for (const [n, lights, switches] of [[1, 1, 0], [12, 6, 6], [20, 10, 10]]) {
    await guarded(`fullview ${n} entities`, async () => {
      const size = SIZES[1];
      const { context, page } = await fvVisit(size, { ha: fvHa({ lights, switches, scenes: 4, sensors: 2 }) });
      await seen(page, 'button[role="switch"]', 15_000);
      await page.waitForTimeout(1200);
      const d = await page.evaluate(FV_READ);
      fvRec(`${n} entities no inner scroller`, d.chips.length === n && d.scrollers.length === 0 && (n >= 20 || n === 1 || d.scrollH <= d.vh || n === 12 && d.scrollH <= d.vh + 0), { chips: d.chips.length, scrollH: d.scrollH, vh: d.vh, scrollers: d.scrollers });
      if (n === 20) {
        // The page scrolls here and the dock is fixed over it: viewport shots (top, then the end of the scroll, where the end reserve must clear the dock), not a crop taken mid-scroll.
        await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(250);
        await page.screenshot({ path: join(OUT_DIR, "fullview-lights-20-top.png") });
        await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight)); await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT_DIR, "fullview-lights-20-end.png") });
        const e = await page.evaluate(() => {
          const dock = document.querySelector('[data-rain-zone="dock"]');
          const chipBottom = Math.max(...[...document.querySelectorAll('button[role="switch"]')].map((b) => b.getBoundingClientRect().bottom));
          const alpha = (c) => { const k = document.createElement("canvas"); k.width = k.height = 1; const x = k.getContext("2d", { willReadFrequently: true }); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3] / 255; }; // a 1x1 canvas resolves color-mix / oklch output that getComputedStyle may not give as rgba
          const btns = dock ? [...dock.querySelectorAll("button")].map((b) => { const s = getComputedStyle(b); return { label: (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 20), alpha: alpha(s.backgroundColor), border: parseFloat(s.borderTopWidth) }; }) : [];
          return { dockTop: dock ? dock.getBoundingClientRect().top : null, chipBottom, btns, fixed: dock ? getComputedStyle(dock).position === "fixed" : false };
        });
        const shop = e.btns.find((b) => /^Shopping/.test(b.label));
        fvRec("20 entities: end of scroll, last chip above the dock", e.dockTop !== null && e.chipBottom <= e.dockTop, { chipBottom: e.chipBottom, dockTop: e.dockTop });
        fvRec("20 entities: every dock button (the running timer too) is opaque, alpha >= 0.95, border 1", e.btns.length >= 4 && !!e.btns.find((b) => /^Timers/.test(b.label)) && e.btns.every((b) => b.alpha >= 0.95 && b.border === 1), { btns: e.btns });
      } else await fvCrop(page, fvCell(page, "lights"), `lights-${n}`);
      await context.close();
    });
  }
  // other states (captures; the numbers above already ran on the crowded evening): nothing on, morning, auto-off banner, HA not connected, stale, loading, no camera, elevated
  const none = { status: "ok", events: [], stale: false };
  await guarded("fullview nothing on", async () => {
    // The evening ("crowded" clock, 18:30), not "ordinary" (11:00 is the morning period, whose briefing card is always there): no agenda, no bins, nothing playing, no camera, an idle timer.
    const { context, page } = await fvVisit(SIZES[1], { state: "crowded", extra: { "/kiosk/api/calendar": none, "/kiosk/api/bins": { status: "unconfigured" }, "/kiosk/api/doorbell": { ...FV_DOOR, status: "unconfigured", cameras: [], lastSeenAt: null } }, timer: false, np: false }); // the real unconfigured answer keeps `cameras: []` (ha-doorbell.ts); without it the dock button throws and the page falls to the error boundary
    await seen(page, "section.panel h2", 15_000);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT_DIR, "fullview-nothing-on-1024x768.png") });
    const d = await page.evaluate(FV_READ);
    FV.states["nothing on"] = { url: page.url(), cells: d.heads, dockPresent: !!d.dock, todayText: (await fvCell(page, "today").first().innerText().catch(() => "")).slice(0, 160) };
    fvRec("nothing on: copy and no footer", d.emptyLine === "Nothing on today or tomorrow" && !d.nowPlaying, { emptyLine: d.emptyLine, nowPlaying: d.nowPlaying });
    const dockLabels = (d.dock?.buttons ?? []).map((b) => b.label).join("|");
    fvRec("dock no camera, idle timer: Timers, Shopping, Admin", /^Timer(?!.*\d:\d\d).*\|Shopping.*\|Admin$/.test(dockLabels) && !/front door/i.test(dockLabels), { dockLabels });
    await fvCrop(page, fvCell(page, "today"), "today-nothing-on");
    await fvCrop(page, page.locator('[data-rain-zone="dock"]'), "dock-no-camera-timer-idle");
    await context.close();
  });
  await guarded("fullview morning", async () => {
    const { context, page } = await visit(FV_URL(), { viewport: SIZES[1].viewport, weather: calWeatherFor("ordinary"), fixedTime: true, instant: calInstant("07:30"), ha: true, routes: { "/kiosk/api/calendar": CAL_STATES.ordinary.body, "/kiosk/api/briefing": FV_BRIEFING } }); // the shared fixture answers "unconfigured", which the card prints as "Briefing unavailable."
    await seen(page, "section.panel h2", 15_000);
    await page.waitForTimeout(1200);
    const todayText = await fvCell(page, "today").first().innerText();
    fvRec("morning briefing loaded", todayText.includes(FV_BRIEFING.digest.headline) && !/Briefing unavailable/.test(todayText), { todayText: todayText.slice(0, 120) });
    await fvCrop(page, fvCell(page, "today"), "today-morning-briefing");
    await context.close();
  });
  await guarded("fullview banner", async () => {
    const { context, page } = await visit(FV_URL(), { viewport: SIZES[1].viewport, weather: calWeatherFor("crowded"), fixedTime: true, instant: calInstant("22:57"), ha: true, routes: { "/kiosk/api/calendar": CAL_STATES.crowded.body } }); // AUTO_OFF fires at 23:00 with a 5-minute warn lead (use-climate-auto-off.ts), so 22:57 is inside the warn window
    // 22:57 is night: the overlay covers the board until a tap wakes it (as the "fullview night" state does)
    await page.mouse.click(SIZES[1].viewport.width / 2, SIZES[1].viewport.height / 2);
    await page.waitForTimeout(800);
    await seen(page, ".sr-climate", 15_000);
    await page.waitForTimeout(1200);
    const banner = await page.locator('section.panel [role="status"]').count();
    FV.states.autoOffBanner = { seen: banner > 0 };
    if (!banner) FV.notRun.push("auto-off banner warn: not on screen at 22:57 (the warn window is the engine's)");
    await fvCrop(page, fvCell(page, "climate"), "climate-auto-off-banner");
    await context.close();
  });
  for (const [name, ha, wait] of [["ha-not-connected", { status: "unconfigured" }, 'section.panel'], ["ha-loading", null, "header"]]) {
    await guarded(`fullview ${name}`, async () => {
      const setup = name === "ha-loading" ? (p) => p.route("**/kiosk/api/ha/states", (route) => setTimeout(() => route.fulfill({ json: fvHa() }).catch(() => {}), 25_000)) : null;
      const { context, page } = await fvVisit(SIZES[1], { ha: ha ?? fvHa(), setup });
      await seen(page, wait, 15_000);
      await page.waitForTimeout(1200);
      const d = await page.evaluate(FV_READ);
      FV.states[name] = { cells: d.heads, scrollH: d.scrollH };
      if (name === "ha-not-connected") fvRec("ha not connected: the status is the cell, row 2 absent, Today unaffected", d.heads.length === 1 && /^today/i.test(d.heads[0]) && d.chips.length === 0, { cells: d.heads });
      await page.screenshot({ path: join(OUT_DIR, `fullview-${name}-1024x768.png`), fullPage: true });
      await context.close();
    });
  }
  await guarded("fullview ha-stale", async () => {
    let n = 0;
    const { context, page } = await fvVisit(SIZES[1], { setup: (p) => p.route("**/kiosk/api/ha/states", (route) => (++n <= 2 ? route.fulfill({ json: fvHa() }) : route.fulfill({ status: 500, json: { error: "x" } }))) });
    await seen(page, ".sr-climate", 15_000);
    await page.waitForTimeout(1200);
    const lightsHead = () => fvCell(page, "lights").first().evaluate((el) => { const h = el.querySelector("h2"); const lh = parseFloat(getComputedStyle(h).lineHeight) || h.getBoundingClientRect().height; return { header: h.parentElement.parentElement.getBoundingClientRect().height, headingLines: Math.round(h.getBoundingClientRect().height / lh) }; });
    const fresh = await lightsHead(); // the same cell, not yet stale (the first two polls answer)
    await page.waitForTimeout(30_000);
    const tags = await page.locator("section.panel .sr-stale").count();
    FV.states.haStale = { staleTags: tags };
    const stale = await lightsHead();
    fvRec("ha-stale: header keeps its fresh height, heading on one line", tags > 0 && Math.abs(stale.header - fresh.header) <= 0.5 && stale.headingLines === 1, { fresh, stale });
    await fvCrop(page, fvCell(page, "lights"), "ha-stale");
    await context.close();
  });
  await guarded("fullview elevated", async () => {
    const { context, page } = await fvVisit(SIZES[1]);
    // The window runs from the page's pinned clock (the crowded evening), not PINNED_ISO (10:30): from there it had already lapsed, so the page stayed plain.
    const until = Date.parse(calInstant(CAL_STATES.crowded.at)) + 600_000;
    await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { ok: true, expiresAt: until } }) : route.fallback()));
    await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: { elevated: true, expiresAt: until } }));
    await page.getByRole("button", { name: /^Admin/ }).first().click();
    await seen(page, "[role=dialog]", 5000);
    for (const dg of "0000") await page.getByRole("button", { name: `digit ${dg}` }).click();
    await page.waitForTimeout(1800);
    // Fail the state, never shoot a plain page: the dock shows the elevated mark and no Admin button.
    await page.locator('[data-rain-zone="dock"]').getByText("elevated", { exact: true }).waitFor({ timeout: 5000 });
    if (await page.locator('[data-rain-zone="dock"] [data-sr-admin]').count()) throw new Error("elevated state: the Admin button is still in the dock");
    const d = await page.evaluate(FV_READ);
    const labels = (d.dock?.buttons ?? []).map((b) => b.label);
    // 7 (elevated): vitals plus the elevated mark, Glance hidden; the dock-to-cluster gap still holds
    fvRec("elevated dock: Glance hidden, gap to the cluster", !labels.some((l) => /glance/i.test(l)) && (!d.cluster || !d.dock || d.cluster.left - d.dock.rect.right >= d.tok.sp6 - 0.5), { labels, gap: d.cluster && d.dock ? d.cluster.left - d.dock.rect.right : null });
    await fvCrop(page, page.locator('[data-rain-zone="dock"]'), "dock-elevated");
    await page.screenshot({ path: join(OUT_DIR, "fullview-elevated-1024x768.png") });
    await context.close();
  });
  // ---- fvpolish (2026-11-16): seven polish items. Every number cites a token or house class; each false lands in FV.failed. ----
  const FP_SIZES = { w1024: SIZES[1], w390: FV_SIZES.find((z) => z.name === "390x844"), w640: { name: "640x960", viewport: { width: 640, height: 960 } } };
  const fpGuarded = (name, fn) => guarded(name, async () => { try { await fn(); } catch (e) { FV.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } }); // a missing mark fails the run, not just results.errors
  /** Page-side: the pill, tiles, unavailable chips, forecast rail and the first-paint boxes in one read (tokens from probes, never typed). */
  const FP_READ = () => {
    const scope = document.querySelector("[data-kiosk-theme]");
    const tok = (css) => { const el = document.createElement("span"); el.style.cssText = `position:absolute;visibility:hidden;${css}`; scope.append(el); const w = parseFloat(getComputedStyle(el).width); el.remove(); return w; };
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
    const pill = document.querySelector('button[aria-label^="AC auto-off"]');
    const rail = document.querySelector('[data-testid="kiosk-forecast-rail"]');
    const heading = [...document.querySelectorAll("section.panel h2")].find((h) => /^climate/i.test(h.textContent ?? ""));
    const cluster = document.querySelector('div[data-rain-zone="corner"]:not([role])');
    const dayCells = rail ? [...rail.children].filter((c) => c.offsetParent !== null && getComputedStyle(c).display !== "none") : [];
    return {
      vw: innerWidth, scrollY, docW: document.documentElement.scrollWidth, sp3: tok("width:var(--sr-space-3)"), hitMin: tok("width:var(--sr-hit-min)"),
      theme: scope.getAttribute("data-kiosk-theme"),
      pill: box(pill), tiles: [...document.querySelectorAll(".sr-climate")].map(box), settings: [...document.querySelectorAll('button[aria-label^="Advanced controls for"]')].map(box),
      heading: box(heading), cluster: box(cluster),
      unavail: [...document.querySelectorAll('button[role="switch"]:disabled')].map((b) => { const sub = b.querySelector(".sr-chip-sub"); return { rect: box(b), text: sub?.textContent ?? null, clipped: sub ? sub.scrollWidth > sub.clientWidth : true, ellipsis: sub ? getComputedStyle(sub).textOverflow === "ellipsis" : null, hidden: sub ? sub.offsetParent === null : true }; }),
      days: dayCells.length, rail: rail ? { sw: rail.scrollWidth, cw: rail.clientWidth } : null,
    };
  };
  const fpGap = (a, b) => Math.hypot(Math.max(a.left - b.right, b.left - a.right, 0), Math.max(a.top - b.bottom, b.top - a.bottom, 0));
  /** Page-side: the composed alpha of each element's background over its whole box: colour layer under every image layer (gradient stops included), and any mask. */
  const FP_ALPHA = (sels) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
    const alpha = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0, 0, 0, 0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data[3] / 255; }; // an unparsable colour stays transparent, so it fails safe
    const layers = (img) => { const out = []; let depth = 0, cur = ""; for (const ch of img) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
    const COLOUR = /(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\((?:[^()]|\([^()]*\))*\)/g;
    return sels.flatMap((sel) => [...document.querySelectorAll(sel)]).map((el) => {
      const s = getComputedStyle(el);
      const base = alpha(s.backgroundColor);
      const imgs = s.backgroundImage === "none" ? [] : layers(s.backgroundImage).map((l) => { const stops = (l.match(COLOUR) ?? []).map(alpha); return stops.length ? Math.min(...stops) : 1; });
      const masked = (s.maskImage && s.maskImage !== "none") || (s.webkitMaskImage && s.webkitMaskImage !== "none");
      const composed = 1 - (1 - base) * imgs.reduce((p, a) => p * (1 - a), 1);
      return { label: (el.getAttribute("aria-label") ?? el.tagName).slice(0, 24), alpha: +composed.toFixed(3), base: +base.toFixed(3), imageLayers: imgs.map((a) => +a.toFixed(3)), masked: !!masked, position: s.position };
    });
  };
  const fpOpaque = (rows) => rows.length > 0 && rows.every((r) => r.alpha >= 0.95 && !r.masked);

  /** Page-side (fvpolish fix 1 item 2): what could fade the auto-off pill: opacity and mask on the pill and every ancestor up to the Climate cell, its own paint, its lit layer's box, and unfinished animations. */
  const PILL_READ = () => {
    const pill = document.querySelector('button[aria-label^="AC auto-off"]');
    const cell = pill.closest("section.panel");
    const chain = []; for (let el = pill; el; el = el.parentElement) { chain.push(el); if (el === cell) break; }
    const mask = (s) => (s.maskImage && s.maskImage !== "none") || (s.webkitMaskImage && s.webkitMaskImage !== "none");
    const lit = pill.querySelector(".sr-lit"), disc = pill.querySelector(".sr-catch");
    const b = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; };
    const ps = getComputedStyle(pill), ds = disc ? getComputedStyle(disc) : null;
    return {
      opacities: chain.map((el) => +getComputedStyle(el).opacity), masked: chain.filter((el) => mask(getComputedStyle(el))).length,
      bgColor: ps.backgroundColor, bgImage: ps.backgroundImage, discBg: ds?.backgroundColor ?? null, discOpacity: ds ? +ds.opacity : null, discTransform: ds?.transform ?? null,
      pill: b(pill), lit: lit ? b(lit) : null, running: pill.getAnimations({ subtree: true }).filter((a) => a.playState !== "finished").length,
    };
  };
  // 1, 2, 3: the auto-off pill gap, the unavailable chip, the forecast days, at 1024 and 390 (the 1024 count is what 390 must equal)
  let days1024 = null, pill1024 = null;
  for (const [key, size] of [["1024", FP_SIZES.w1024], ["390", FP_SIZES.w390]]) {
    await fpGuarded(`fullview polish ${key}`, async () => {
      const { context, page } = await fvVisit(size);
      await seen(page, ".sr-climate", 15_000);
      await page.waitForTimeout(1500);
      const d = await page.evaluate(FP_READ);
      if (!d.pill || !d.tiles.length) throw new Error("mark missing: the auto-off pill or a climate tile is not on screen");
      const gap = Math.min(...d.tiles.map((t) => fpGap(d.pill, t)));
      fvRec(`fullview-pill-gap-${key}`, gap >= d.sp3 - 0.5, { gap: +gap.toFixed(1), want: d.sp3, token: "--sr-space-3 (the Board's tile gap)" });
      if (!d.unavail.length) throw new Error("mark missing: no unavailable chip (the fixture's 4th light is unavailable)");
      fvRec(`fullview-unavailable-${key}`, d.unavail.every((u) => u.text === "unavailable" && !u.clipped && !u.hidden && !u.ellipsis && u.rect.h >= d.hitMin - 0.5), { chips: d.unavail.map((u) => ({ text: u.text, clipped: u.clipped, hidden: u.hidden, ellipsis: u.ellipsis, h: +u.rect.h.toFixed(1) })), hitMin: d.hitMin });
      if (key === "1024") days1024 = d.days;
      else fvRec("fullview-forecast-390", d.days === days1024 && days1024 > 0 && !!d.rail && d.rail.sw <= d.rail.cw && d.docW <= d.vw, { days: d.days, days1024, rail: d.rail, docW: d.docW, vw: d.vw });
      FV.states[`polish-${key}`] = { pill: d.pill && { top: d.pill.top, bottom: d.pill.bottom }, days: d.days, unavailable: d.unavail.length };
      // item 2: below 640 px scroll the Climate header to mid-viewport (no fixed chrome over it), let the sun catch settle, then read before the shot
      if (key === "390") { await page.evaluate(() => document.querySelector('button[aria-label^="AC auto-off"]').scrollIntoView({ block: "center" })); await page.waitForTimeout(1200); }
      const pr = await page.evaluate(PILL_READ);
      if (key === "1024") pill1024 = pr;
      else if (pill1024) {
        const eq1 = (a, b) => Math.abs(a - b) <= 1;
        fvRec("fullview-pill-paint-390", pr.opacities.every((o) => o === 1) && pr.masked === 0 && pr.running === 0 && pr.bgColor === pill1024.bgColor && pr.bgImage === pill1024.bgImage && pr.discBg === pill1024.discBg && pr.discOpacity === pill1024.discOpacity && pr.discTransform === pill1024.discTransform && !!pr.lit && eq1(pr.lit.w, pr.pill.w) && eq1(pr.lit.h, pr.pill.h) && eq1(pr.lit.left, pr.pill.left) && eq1(pr.lit.top, pr.pill.top), { at390: pr, at1024: pill1024 });
      }
      await fvCrop(page, fvCell(page, "climate"), `pill-gap-${key}`);
      await fvCrop(page, fvCell(page, "lights"), `unavailable-${key}`);
      if (key === "390") await fvCrop(page, page.locator('[data-testid="kiosk-forecast-rail"]'), "forecast-390");
      await context.close();
    });
  }

  // 5: first paint (scrollTop 0) at 390 and 640: the corner cluster meets none of the Climate heading, the pill, a tile's settings button
  for (const [key, size] of [["390", FP_SIZES.w390], ["640", FP_SIZES.w640]]) {
    await fpGuarded(`fullview first paint ${key}`, async () => {
      const { context, page } = await fvVisit(size);
      await seen(page, ".sr-climate", 15_000);
      await page.waitForTimeout(1500);
      const d = await page.evaluate(FP_READ);
      if (d.scrollY !== 0) throw new Error(`mark missing: first paint must be scrollTop 0 (is ${d.scrollY})`);
      if (!d.cluster || d.cluster.w < 1 || !d.pill || !d.heading) throw new Error("mark missing: the corner cluster (downloads and alert fixtures), the pill or the Climate heading is absent");
      const hits = [["heading", d.heading], ["pill", d.pill], ...d.settings.map((b, i) => [`settings-${i}`, b])].filter(([, b]) => fvHits(b, d.cluster)).map(([n]) => n);
      fvRec(`fullview-first-paint-${key}`, hits.length === 0, { hits, cluster: d.cluster, pillLeft: d.pill.left, headingBottom: d.heading.bottom });
      await page.screenshot({ path: join(OUT_DIR, `fullview-first-paint-${key}.png`) });
      await context.close();
    });
  }

  // 4: 20 lights, end of scroll, the pinned hero is opaque (alpha >= 0.95 composed over its whole box) in four themes
  for (const [theme, label, sun, state] of [["sunroom", "sunroom-day", "day", "crowded"], ["sunroom", "sunroom-night", "night", "woken-night"], ["aurora", "aurora", "day", "crowded"], ["aerogel", "aerogel", "day", "crowded"]]) {
    await fpGuarded(`fullview lights 20 end ${label}`, async () => {
      const size = FP_SIZES.w1024;
      const { context, page } = await fvVisit(size, { theme, sun, wx: sun === "night" ? "off" : "overcast", state, ha: fvHa({ lights: 10, switches: 10, scenes: 4, sensors: 2 }) });
      await fvWake(page, size, state);
      await seen(page, 'button[role="switch"]', 15_000);
      await page.waitForTimeout(1500);
      await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => ({ theme: document.querySelector("[data-kiosk-theme]").getAttribute("data-kiosk-theme"), y: scrollY, end: scrollY + innerHeight >= document.scrollingElement.scrollHeight - 1, pinned: !!document.querySelector("header.kiosk-hdr-grid[data-pinned]"), top: document.querySelector("header.kiosk-hdr-grid").getBoundingClientRect().top }));
      if (m.theme !== theme || m.y <= 0 || !m.end || !m.pinned || Math.abs(m.top) > 1) throw new Error(`mark missing: ${JSON.stringify(m)}`);
      const rows = await page.evaluate(FP_ALPHA, ["header.kiosk-hdr-grid"]);
      fvRec(`fullview-lights-20-end-${label}`, fpOpaque(rows), { want: ">= 0.95 composed over the whole pinned box", rows });
      await page.screenshot({ path: join(OUT_DIR, `fullview-lights-20-end-${label}.png`) });
      await context.close();
    });
  }

  // 7: the dock is opaque in Aurora and Aerogel at 1024x768 (colour under gradient stops; the running timer's tint is a gradient layer), plus one Glance capture with a running timer
  for (const theme of ["aurora", "aerogel"]) {
    await fpGuarded(`fullview dock ${theme}`, async () => {
      const { context, page } = await fvVisit(FP_SIZES.w1024, { theme });
      await seen(page, '[data-rain-zone="dock"] button', 15_000);
      await page.waitForTimeout(1500);
      const rows = await page.evaluate(FP_ALPHA, ['[data-rain-zone="dock"] button']);
      const timer = rows.find((r) => /^Timers?/.test(r.label));
      const running = await page.locator('[data-rain-zone="dock"] button', { hasText: /\d:\d\d/ }).count();
      if (!running) throw new Error("mark missing: no running timer on the dock");
      fvRec(`fullview-dock-${theme}-1024`, fpOpaque(rows) && !!timer && timer.imageLayers.length >= 2, { rows });
      await fvCrop(page, page.locator('[data-rain-zone="dock"]'), `dock-${theme}-1024`);
      await context.close();
    });
  }
  await fpGuarded("fullview glance timer running", async () => {
    const { context, page } = await fvVisit(FP_SIZES.w1024, { layout: "glance" });
    // fvpolish fix 1 item 4: Glance has no dock (data-rain-zone="dock" is Full only); its Timers button is the first button of the "tiles" zone (kiosk-glance.tsx), so the mark is read there.
    const TILES = '[data-rain-zone="tiles"] button';
    await seen(page, TILES, 15_000);
    await page.waitForTimeout(1500);
    const running = await page.locator(TILES, { hasText: /\d:\d\d/ }).count();
    const mode = await page.evaluate(() => document.querySelector("header")?.getAttribute("data-mode"));
    const rows = await page.evaluate(FP_ALPHA, [TILES]);
    const timer = rows.find((r) => /^Timers?/.test(r.label));
    if (!running || mode !== "glance" || !timer) throw new Error(`mark missing: running ${running}, header mode ${mode}, timer row ${!!timer}`);
    fvRec("glance-timer-running-1024", timer.imageLayers.some((a) => a > 0 && a < 1), { timer, buttons: rows.length });
    await page.screenshot({ path: join(OUT_DIR, "glance-timer-running-1024.png") });
    await context.close();
  });
  // 13: contrast at midday and night, in node (the same ink-on-surface tokens the other sections check)
  await guarded("fullview contrast", async () => {
    const c = await uvContrast(["ink", "ink-dim", "ink-faint"]);
    fvRec("N13 contrast", c.pass && c.unresolved.length === 0, { checked: c.checked, lowest: c.lowest, failures: c.failures });
  });
  if (FV.failed.length) process.exitCode = 1;
}
// ---- kiosk accent picker (accent PR 3, spec section 5 checks 4, 5, 9, 10, 11, 12 and the state marks) ----
// Run alone: SHOTS_ONLY=accent BASE_URL=... OUT_DIR=... node scripts/kiosk-shots.mjs (ONLY=accent works too). Keys: results.accent.{checks.<key> {ok,...}, failed[]}; every false lands in failed and exits 1.
// Shots appearance-accent-<state>.png (the Appearance panel, an element crop) and glance-sunroom-<day|night>-orchid.png. Pinned like the typeface section: ?theme=sunroom&wx=overcast&wxsun=day, night = STOP_URL with the night weather mock.
// No capture helper (cropElement, layoutCheck) exists in this repo, so the crops are plain locator screenshots.
const AC = (results.accent = { checks: {}, failed: [] });
const acRec = (key, ok, detail = {}) => { AC.checks[key] = { ok, ...detail }; if (!ok) AC.failed.push(`${key} ${JSON.stringify(detail)}`); };
const AC_SRC = readFileSync(new URL("../src/lib/kiosk-accent.ts", import.meta.url), "utf8");
/** A swatch's light and dark accent hex, read from the shipped table so a tuned hex needs no edit here. */
const acHex = (id) => {
  const m = new RegExp(`id: "${id}", label: "\\w+", light: \\{ accent: "(#\\w+)", dim: "#\\w+" \\}, dark: \\{ accent: "(#\\w+)"`).exec(AC_SRC);
  return { light: m[1].toLowerCase(), dark: m[2].toLowerCase() };
};
const AC_IDS = ["default", "harbour", "lagoon", "fern", "iris", "orchid", "clay"];
const AC_ALERT = { status: "attention", severity: "warn", headline: "Backup is late", detail: "Last run was two days ago.", action: "Check the backup job." };
const acStore = (store) => (store ? `localStorage.setItem("kiosk-accent", ${JSON.stringify(JSON.stringify(store))})` : null);
/** Everything the checks read from the open Appearance panel, in one round trip. */
const AC_READ = () => {
  const scope = document.querySelector("[data-kiosk-accent]");
  const cs = getComputedStyle(scope);
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--sr-hit-min)";
  scope.appendChild(probe);
  const hitMin = probe.getBoundingClientRect().height;
  probe.remove();
  const panel = document.querySelector("#kiosk-tabpanel-appearance");
  const chips = [...panel.querySelectorAll("[data-accent-chip]")];
  const disc = (b) => { const r = b?.querySelector(":scope > span[aria-hidden].rounded-full")?.getBoundingClientRect(); return r ? [r.width, r.height] : null; };
  const themeChip = [...panel.querySelectorAll("button[aria-pressed]:not([data-accent-chip])")].find((b) => b.querySelector(":scope > span[aria-hidden].rounded-full"));
  return {
    theme: scope.getAttribute("data-kiosk-theme") ?? "default",
    dataAccent: scope.getAttribute("data-kiosk-accent"),
    ids: chips.map((c) => c.getAttribute("data-accent-chip")),
    pressed: chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.getAttribute("data-accent-chip")),
    heights: chips.map((c) => c.getBoundingClientRect().height),
    tops: chips.map((c) => Math.round(c.getBoundingClientRect().top)),
    hitMin,
    accentDisc: disc(chips[0]),
    themeDisc: disc(themeChip),
    colorAccent: cs.getPropertyValue("--color-accent").trim().toLowerCase(),
    srAccent: cs.getPropertyValue("--sr-accent").trim().toLowerCase(),
    srBlue: cs.getPropertyValue("--sr-blue").trim().toLowerCase(),
    colorBlue: cs.getPropertyValue("--color-blue").trim().toLowerCase(),
    inlineAccent: scope.style.getPropertyValue("--color-accent") || scope.style.getPropertyValue("--sr-accent") || "",
    docW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    hint: [...panel.querySelectorAll("p")].map((p) => p.textContent.trim()).find((t) => t.startsWith("Applies to")) ?? null,
  };
};
/** Open the Appearance tab the way tpOpenTypeface opens Typeface: the admin PIN pad, then the tab that is already first. */
async function acOpen({ viewport = SIZES[0].viewport, night = false, reduced = false, store = null } = {}) {
  const v = await visit(night ? `${STOP_URL}&layout=standard` : CONTROLS_URL, { viewport, weather: weatherFor(night ? "night" : "midday"), fixedTime: true, ha: true, reduced, initScript: acStore(store) });
  const { page } = v;
  await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { ok: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }) : route.fallback()));
  await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: { elevated: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }));
  const admin = page.getByRole("button", { name: /^Admin/ }).first();
  if (!(await admin.count())) throw new Error("Admin button not found");
  await admin.click();
  await seen(page, "[role=dialog]", 5000);
  for (const d of "0000") await page.getByRole("button", { name: `digit ${d}` }).click();
  await page.waitForTimeout(1500);
  if (!(await seen(page, "#kiosk-tabpanel-appearance [data-accent-chip]", 5000))) throw new Error("accent chips not found");
  await page.waitForTimeout(500);
  return v;
}
/** Shoot the Accent group (chips + hint) alone: scroll it to mid-viewport, check no chip or the hint touches the fixed dock or the sticky hero (`accent-clear-<name>`), clip to its box padded 16 px. */
const acShot = async (page, name) => {
  const group = page.locator('[data-accent-chip="default"]').locator("xpath=../..");
  await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
  const m = await group.evaluate((el) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const chrome = [...document.querySelectorAll('[data-rain-zone="dock"], .kiosk-hdr-grid')].filter((e) => ["fixed", "sticky"].includes(getComputedStyle(e).position)).map(r);
    const mine = [...el.querySelectorAll("[data-accent-chip]"), ...[...el.querySelectorAll("p")].filter((p) => p.textContent.startsWith("Applies to"))].map(r);
    return { box: r(el), covered: mine.some((a) => chrome.some((c) => hit(a, c))), vw: innerWidth, vh: innerHeight };
  });
  acRec(`accent-clear-${name}`, !m.covered, { covered: m.covered });
  const x = Math.max(0, m.box.x - 16), y = Math.max(0, m.box.y - 16);
  await page.screenshot({ path: join(OUT_DIR, `appearance-accent-${name}.png`), clip: { x, y, width: Math.min(m.vw - x, m.box.w + 32), height: Math.min(m.vh - y, m.box.h + 32) } });
};
const acPick = async (page, id) => { await page.locator(`[data-accent-chip="${id}"]`).click(); await page.waitForTimeout(500); };
/** Exactly one pressed chip, matching the scope's mark. */
const acMarks = (label, d, wantId) => acRec(`marks ${label}`, d.pressed.length === 1 && d.pressed[0] === wantId && d.dataAccent === wantId, { pressed: d.pressed, dataAccent: d.dataAccent, wantId });
/** Tab from the last theme chip through the seven accent chips; `kind` "ring" reads the Tailwind ring (box-shadow) against --color-accent, "sunroom" reads the outline against --sr-focus. */
async function acTab(page, kind) {
  await page.locator("#kiosk-tabpanel-appearance button[aria-pressed]:not([data-accent-chip])").last().focus();
  const order = [];
  const marks = [];
  const tri = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map((n) => Math.round(Number(n))).join(",");
  for (let i = 0; i < AC_IDS.length; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate((k) => {
      const a = document.activeElement;
      const probe = document.createElement("div");
      probe.style.color = k === "ring" ? "var(--color-accent)" : "var(--sr-focus)";
      document.querySelector("[data-kiosk-accent]").appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(a);
      return { id: a.getAttribute("data-accent-chip"), want, shadow: cs.boxShadow, outline: cs.outlineColor, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
    }, kind);
    order.push(f.id);
    const rings = f.shadow.match(/rgba?\([^)]*\)/g) ?? [];
    const ok = kind === "ring" ? rings.some((r) => tri(r) === tri(f.want)) : f.outlineStyle === "solid" && tri(f.outline) === tri(f.want);
    marks.push({ id: f.id, ok, want: f.want, got: kind === "ring" ? rings : f.outline });
  }
  return { order, marks };
}
async function accentShots() {
  const run = (name, fn) => guarded(`accent ${name}`, async () => { try { await fn(); } catch (e) { AC.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
  const orchid = acHex("orchid");

  // Sunroom by day: default pressed, checks 4 and 5, Orchid, check 12, check 10 (keyboard), then back to Theme default; then Folio and Aurora with Orchid
  await run("day", async () => {
    const { context, page } = await acOpen();
    const base = await page.evaluate(AC_READ);
    acRec("order", JSON.stringify(base.ids) === JSON.stringify(AC_IDS), { ids: base.ids });
    acRec("hint sunroom", base.hint === "Applies to Sunroom only.", { hint: base.hint });
    acRec("check4 sunroom", Math.min(...base.heights) >= 44 && Math.min(...base.heights) >= base.hitMin, { shortest: Math.min(...base.heights), hitMin: base.hitMin });
    acRec("check5", !!base.accentDisc && !!base.themeDisc && base.accentDisc.every((n, i) => Math.abs(n - base.themeDisc[i]) <= 0.5 && Math.abs(n - 20) <= 0.5), { accentDisc: base.accentDisc, themeDisc: base.themeDisc });
    acMarks("sunroom default", base, "default");
    acRec("default writes no inline accent", base.inlineAccent === "", { inline: base.inlineAccent });
    await acShot(page, "default-pressed");

    await acPick(page, "orchid");
    const picked = await page.evaluate(AC_READ);
    acMarks("sunroom day orchid", picked, "orchid");
    acRec("sunroom day orchid hex", picked.srAccent === orchid.light, { got: picked.srAccent, want: orchid.light });
    acRec("sunroom never inline", picked.inlineAccent === "", { inline: picked.inlineAccent });
    acRec("check12 live", picked.colorBlue !== orchid.light && picked.colorBlue === picked.srBlue && picked.srBlue === base.srAccent, { colorBlue: picked.colorBlue, srBlue: picked.srBlue, orchid: orchid.light, rampAccent: base.srAccent });
    await acShot(page, "sunroom-day-orchid");

    // check 10 on Sunroom: Tab order, and the focus mark is the ramp's own outline (--sr-focus, controls.css), which a swatch never touches
    const sr = await acTab(page, "sunroom");
    acRec("check10 order sunroom", JSON.stringify(sr.order) === JSON.stringify(AC_IDS), { order: sr.order });
    acRec("check10 sunroom outline is --sr-focus", sr.marks.every((m) => m.ok), { marks: sr.marks });
    await acShot(page, "focus-sunroom");

    await acPick(page, "default");
    const back = await page.evaluate(AC_READ);
    acMarks("sunroom back to default", back, "default");
    acRec("sunroom default restores the ramp accent", back.srAccent === base.srAccent, { got: back.srAccent, want: base.srAccent });

    for (const [label, name, half] of [["Folio", "folio", "light"], ["Aurora", "aurora", "dark"]]) {
      await page.locator("#kiosk-tabpanel-appearance button[aria-pressed]:not([data-accent-chip])", { hasText: label }).first().click();
      await page.waitForTimeout(600);
      const before = await page.evaluate(AC_READ);
      await acPick(page, "orchid");
      const after = await page.evaluate(AC_READ);
      acMarks(`${name} orchid`, after, "orchid");
      acRec(`${name} orchid hex`, after.theme === name && after.colorAccent === orchid[half], { theme: after.theme, got: after.colorAccent, want: orchid[half] });
      acRec(`${name} hint`, after.hint === `Applies to ${label === "Aurora" ? "Aurora" : label} only.`, { hint: after.hint });
      acRec(`check4 ${name}`, Math.min(...after.heights) >= 44, { shortest: Math.min(...after.heights) });
      await acShot(page, `${name}-orchid`);
      if (name === "folio") {
        // check 10 where the chips use focus-visible:ring-accent: the ring is the chosen swatch's own accent
        const t = await acTab(page, "ring");
        acRec("check10 order folio", JSON.stringify(t.order) === JSON.stringify(AC_IDS), { order: t.order });
        acRec("check10 ring colour folio", t.marks.every((m) => m.ok), { marks: t.marks });
        await acShot(page, "focus");
      }
      await acPick(page, "default");
      const reset = await page.evaluate(AC_READ);
      acRec(`${name} default restores the theme accent`, reset.colorAccent === before.colorAccent && reset.inlineAccent === "", { got: reset.colorAccent, want: before.colorAccent, inline: reset.inlineAccent });
    }
    // Chrome Panel: Lagoon and Fern, each asserted pressed and carried on the theme root before the shot
    await page.locator("#kiosk-tabpanel-appearance button[aria-pressed]:not([data-accent-chip])", { hasText: "Chrome" }).first().click();
    await page.waitForTimeout(600);
    for (const id of ["lagoon", "fern"]) {
      await acPick(page, id);
      const d = await page.evaluate(AC_READ);
      acMarks(`chrome ${id}`, d, id);
      await acShot(page, `chrome-${id}`);
    }
    await acPick(page, "default");
    await context.close();
  });

  // Sunroom at night: the dark half, with the ink
  await run("night", async () => {
    const { context, page } = await acOpen({ night: true });
    await acPick(page, "orchid");
    const d = await page.evaluate(AC_READ);
    acMarks("sunroom night orchid", d, "orchid");
    acRec("sunroom night orchid hex", d.srAccent === orchid.dark, { got: d.srAccent, want: orchid.dark });
    acRec("check12 live night", d.colorBlue !== orchid.dark && d.colorBlue === d.srBlue, { colorBlue: d.colorBlue, srBlue: d.srBlue });
    await acShot(page, "sunroom-night-orchid");
    await context.close();
  });

  // 390 px: the chip row wraps and the page does not scroll sideways
  await run("390", async () => {
    const { context, page } = await acOpen({ viewport: { width: 390, height: 844 }, store: { sunroom: "orchid" } });
    const d = await page.evaluate(AC_READ);
    acRec("check9", new Set(d.tops).size > 1 && d.docW <= d.innerW, { rows: [...new Set(d.tops)], docW: d.docW, innerW: d.innerW });
    acRec("check4 390", Math.min(...d.heights) >= 44 && Math.min(...d.heights) >= d.hitMin, { shortest: Math.min(...d.heights), hitMin: d.hitMin });
    await acShot(page, "390");
    await context.close();
  });

  // reduced motion: no chip transition names transform, scale or translate (ThemeChip is read alongside as the reference)
  await run("reduced", async () => {
    const { context, page } = await acOpen({ reduced: true });
    const t = await page.evaluate(() => {
      const panel = document.querySelector("#kiosk-tabpanel-appearance");
      const prop = (b) => getComputedStyle(b).transitionProperty;
      const themeChip = [...panel.querySelectorAll("button[aria-pressed]:not([data-accent-chip])")].find((b) => b.querySelector(":scope > span[aria-hidden].rounded-full"));
      return { accent: prop(panel.querySelector('[data-accent-chip="orchid"]')), theme: prop(themeChip) };
    });
    acRec("check11 sunroom", !/transform|scale|translate|rotate|\ball\b/.test(t.accent), t);
    // off Sunroom the chips use Tailwind's colour transition: still no transform, scale or translate named
    await page.locator("#kiosk-tabpanel-appearance button[aria-pressed]:not([data-accent-chip])", { hasText: "Folio" }).first().click();
    await page.waitForTimeout(600);
    const f = await page.evaluate(() => getComputedStyle(document.querySelector('#kiosk-tabpanel-appearance [data-accent-chip="orchid"]')).transitionProperty);
    acRec("check11 folio", !/transform|scale|translate|rotate|\ball\b/.test(f), { accent: f });
    await context.close();
  });

  // the Glance pane, with Orchid, by day and at night
  for (const [name, url, stop] of [["day", MAIN_URL, "midday"], ["night", STOP_URL, "night"]]) {
    await run(`glance ${name}`, async () => {
      const { context, page } = await visit(url, { viewport: SIZES[0].viewport, weather: weatherFor(stop), fixedTime: true, ha: true, initScript: acStore({ sunroom: "orchid" }) });
      await page.waitForTimeout(800);
      const a = await page.evaluate(() => getComputedStyle(document.querySelector('[data-kiosk-theme="sunroom"]')).getPropertyValue("--sr-accent").trim().toLowerCase());
      acRec(`glance ${name} orchid`, a === orchid[name === "day" ? "light" : "dark"], { got: a });
      await page.screenshot({ path: join(OUT_DIR, `glance-sunroom-${name}-orchid.png`), fullPage: true });
      await context.close();
    });
  }

  // meaning is not carried by colour: with Fern chosen, an alert still has its icon and its words
  await run("fern status", async () => {
    const { context, page } = await visit(MAIN_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, initScript: acStore({ sunroom: "fern" }), routes: { "/kiosk/api/attention": AC_ALERT } });
    await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
    await page.getByRole("button", { name: /alert/i }).first().click();
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const tray = document.querySelector('[role="dialog"][aria-label="Alerts"]');
      return { tray: !!tray, icon: !!tray?.querySelector('svg[class*="triangle"]'), text: tray?.textContent.includes("Backup is late") ?? false };
    });
    acRec("fern status keeps icon and word", m.tray && m.icon && m.text, m);
    await context.close();
  });
  if (AC.failed.length) process.exitCode = 1;
}
if ((process.env.SHOTS_ONLY ?? process.env.ONLY) === "accent") {
  await accentShots();
  results.n16PageErrorMessages = pageErrorMessages;
  results.n16ForeignRequests = foreign;
  await browser.close();
  writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  process.exit(process.exitCode ?? 0);
}
if (process.env.ONLY === "fullview") {
  await fullViewBoard();
  results.n16PageErrorMessages = pageErrorMessages;
  results.n16ForeignRequests = foreign;
  await browser.close();
  writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  process.exit(process.exitCode ?? 0);
}

// ---- kiosk polish part B (2026-11-16): seven items, run alone with ONLY=polishb (and once in the full run, before the corner section) ----
// Keys: results.polishb.{checks.<key> {ok,...}, failed[] (one line each; the run exits 1 if any), reported{}}. Shots polishb-<state>.png: padded crops (16 px) plus one full page per breakpoint.
// Item 1 typeface-390-*, 2 microlabel-*, 3 pin-*, 4 downloads-*, 5 glance-390-*, 6 clock-*, 7 chip-default-*. `reported.autoOffContrast` is a reading only (under 4.5 is a lead finding, never a failure).
const PB = (results.polishb = { checks: {}, failed: [], reported: {} });
const pbRec = (key, ok, detail = {}) => { PB.checks[key] = { ok, ...detail }; if (!ok) PB.failed.push(`${key} ${JSON.stringify(detail)}`); };
const pbRun = (name, fn) => guarded(`polishb ${name}`, async () => { try { await fn(); } catch (e) { PB.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const pbFonts = (fonts) => `localStorage.setItem("kiosk-fonts", ${JSON.stringify(JSON.stringify({ sunroom: fonts }))})`;
const pbHits = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const PB_ALERT = { status: "attention", severity: "warn", headline: "Backup is late", detail: "Last run was two days ago.", action: "Check the backup job." };
const PB_DL = (n) => ({ status: "ok", items: Array.from({ length: n }, (_, i) => ({ hash: `pb${i}`, name: `Download number ${i + 1}`, progress: 0.2 + (i % 5) / 10, dlspeed: 1_500_000, size: 4_000_000_000, eta: 900 + i })) });
/** Shoot one element with 16 px of padding, clipped to the viewport (the acShot clip). */
const pbShot = async (page, loc, name, pad = 16) => {
  const b = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  await page.screenshot({ path: join(OUT_DIR, `polishb-${name}.png`), clip: { x, y, width: Math.min(b.vw - x, b.w + pad * 2), height: Math.min(b.vh - y, b.h + pad * 2) } });
};
/** Nothing fixed, sticky or edge-banded may sit on the group: every button, label and hint inside it must be the element found at its own centre point, inside the viewport. */
const pbClear = async (page, loc, key, { visibleOnly = false } = {}) => {
  const m = await loc.evaluate((el, visibleOnly) => {
    let parts = [...el.querySelectorAll("button, .microlabel, p")];
    if (visibleOnly) { // only parts fully inside what the shot shows: the group's box, the nearest scroll viewport and the window
      let sc = el.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const g = el.getBoundingClientRect(), s = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      const top = Math.max(0, g.top - 16, s.top), bottom = Math.min(innerHeight, g.bottom + 16, s.bottom);
      parts = parts.filter((p) => { const r = p.getBoundingClientRect(); return r.top >= top && r.bottom <= bottom; });
    }
    const bad = parts.filter((p) => { const r = p.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return true; const hit = document.elementFromPoint(cx, cy); return !hit || !p.contains(hit); }).map((p) => (p.textContent ?? "").trim().slice(0, 20));
    return { parts: parts.length, covered: bad };
  }, visibleOnly);
  pbRec(`${key}`, m.parts > 0 && m.covered.length === 0, m);
};
/** Page-side: the gap each side of the "·" in a chip, from the characters either side of it. */
const PB_DOT_GAPS = (el) => {
  const chars = [];
  const wk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = wk.nextNode(); n; n = wk.nextNode()) for (let i = 0; i < n.textContent.length; i++) chars.push([n, i]);
  const at = (c) => { const g = document.createRange(); g.setStart(c[0], c[1]); g.setEnd(c[0], c[1] + 1); return g.getBoundingClientRect(); };
  const d = chars.findIndex(([n, i]) => n.textContent[i] === "·");
  if (d < 0) return null;
  const solid = (c) => !/\s/.test(c[0].textContent[c[1]]);
  const prev = chars.slice(0, d).reverse().find(solid), next = chars.slice(d + 1).find(solid);
  if (!prev || !next) return null;
  return { before: at(chars[d]).left - at(prev).right, after: at(next).left - at(chars[d]).right };
};
const pbDotGaps = (loc) => loc.evaluate(PB_DOT_GAPS);
/** The chip's centre and four inset corners (4 px in) must each hit the chip or a descendant: no fixed or sticky chrome over it. */
const pbChipClear = async (page, loc, key) => {
  const m = await loc.evaluate((el) => {
    // inset past the pill radius: a 4 px inset lands outside the rounded corner and hits the parent
    const r = el.getBoundingClientRect(), d = Math.round(r.height * 0.35);
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d]];
    const over = [];
    const hits = pts.map(([x, y]) => { const h = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight ? document.elementFromPoint(x, y) : null; const ok = !!h && el.contains(h); if (!ok) over.push(h ? `${h.tagName.toLowerCase()}.${String(h.className).slice(0, 80)}` : "none"); return ok; });
    return { hits, over, top: r.top, bottom: r.bottom, vh: innerHeight };
  });
  pbRec(key, m.hits.length === 5 && m.hits.every(Boolean), m);
};
/** The instant (in the pinned zone) at which the wall clock reads `hhmm`, searched from the pinned instant. */
const pbInstant = (hhmm) => {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: ZONE, hour: "numeric", minute: "2-digit", hour12: true });
  for (let i = 0; i < 1440; i++) {
    const d = new Date(Date.parse(PINNED_ISO) + i * 60_000);
    const p = f.formatToParts(d);
    if (`${p.find((x) => x.type === "hour").value}:${p.find((x) => x.type === "minute").value}` === hhmm) return d;
  }
  throw new Error(`no instant reads ${hhmm}`);
};
const PB_FACES = [...readFileSync(new URL("../src/lib/kiosk-fonts.ts", import.meta.url), "utf8").matchAll(/\{ id: "([a-z-]+)", label: "[^"]+", kind: "(sans|serif|mono)", cssVar: ['"]var\((--font-t-[a-z-]+)\)/g)].map(([, id, kind, cssVar]) => ({ id, kind, cssVar }));

async function polishbShots() {
  // item 1 and item 7 (font chip): the Typeface tab at 390 px, Sunroom day. Panel top, then the Numerals group, then a non-default Numerals pick, each shot alone and checked clear of chrome.
  await pbRun("typeface 390", async () => {
    const { context, page } = await tpOpenTypeface({ width: 390, height: 844 });
    const panel = page.locator("#kiosk-tabpanel-typeface");
    const group = (label) => panel.locator("div.flex.flex-col.gap-2").filter({ has: page.locator("span.microlabel", { hasText: new RegExp(`^${label}$`) }) }).first();
    await page.evaluate(() => { document.querySelector("#kiosk-tabpanel-typeface").scrollIntoView({ block: "start" }); for (let n = document.querySelector("#kiosk-tabpanel-typeface"); n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = 0; scrollTo(0, 0); });
    await page.waitForTimeout(300);
    await pbClear(page, group("text"), "typeface-390-clear-top", { visibleOnly: true });
    await pbShot(page, group("text"), "typeface-390-top");
    await group("numerals").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await pbClear(page, group("numerals"), "typeface-390-clear-numerals");
    await pbShot(page, group("numerals"), "typeface-390-numerals");
    const gaps = await pbDotGaps(group("numerals").locator("button", { hasText: "default" }).first());
    pbRec("chip-default-gaps font chip", !!gaps && Math.abs(gaps.before - gaps.after) <= 1, gaps ?? {});
    await pbChipClear(page, group("numerals").locator("button", { hasText: "default" }).first(), "chip-default-clear font");
    const pick = group("numerals").locator("button[aria-pressed='false']").first();
    const picked = (await pick.textContent())?.trim();
    await pick.click();
    await page.waitForTimeout(500);
    await group("numerals").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const now = await group("numerals").evaluate((el) => ({ pressed: [...el.querySelectorAll("button[aria-pressed='true']")].map((b) => b.textContent.trim()) }));
    pbRec("typeface-390-pick", now.pressed.length === 1 && now.pressed[0] === picked, { picked, pressed: now.pressed });
    await pbClear(page, group("numerals"), "typeface-390-clear-picked");
    await pbShot(page, group("numerals"), "typeface-390-picked");
    await context.close();
  });

  // item 7 (accent chip): the gap before and after the dot in "Theme · default"
  await pbRun("chip default", async () => {
    const { context, page } = await acOpen();
    const chip = page.locator('[data-accent-chip="default"]');
    await chip.evaluate((el) => el.scrollIntoView({ block: "center" })); // clear of the fixed bottom fade and sticky chrome
    await page.waitForTimeout(300);
    const gaps = await pbDotGaps(chip);
    pbRec("chip-default-gaps accent chip", !!gaps && Math.abs(gaps.before - gaps.after) <= 1, gaps ?? {});
    await pbChipClear(page, chip, "chip-default-clear accent");
    await pbShot(page, chip, "chip-default-accent");
    await context.close();
  });

  // item 2: the microlabel word gap across every Text face (set inline on the label; each face is loaded before it is measured)
  await pbRun("microlabel", async () => {
    const { context, page } = await visit(FV_URL("sunroom", "standard"), { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: false, routes: { "/kiosk/api/ha/states": { status: "unconfigured" } } });
    const label = page.getByText("Home Assistant not connected", { exact: true });
    if (!(await label.count())) throw new Error("the not-connected microlabel is not on screen");
    const faces = PB_FACES.filter((f) => f.kind !== "mono").map((f) => ({ id: f.id, cssVar: f.cssVar }));
    const rows = await label.first().evaluate(async (el, list) => {
      const out = [];
      const node = el.firstChild;
      const words = [...node.textContent.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
      for (const f of list) {
        el.style.fontFamily = `var(${f.cssVar}), sans-serif`;
        const cs = getComputedStyle(el);
        try { await document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(",")[0]}`, node.textContent); } catch { /* an unloadable face is measured as its fallback and flagged below */ }
        const rect = (a) => { const g = document.createRange(); g.setStart(node, a[0]); g.setEnd(node, a[1]); return g.getBoundingClientRect(); };
        const gaps = words.slice(1).map((w, i) => rect(w).left - rect(words[i]).right);
        out.push({ id: f.id, em: parseFloat(cs.fontSize), maxGap: Math.max(...gaps), spacing: cs.wordSpacing, track: cs.letterSpacing });
      }
      el.style.fontFamily = "";
      return out;
    }, faces);
    const worst = rows.reduce((a, b) => (b.maxGap / b.em > a.maxGap / a.em ? b : a));
    PB.reported.microlabelWidestGap = worst;
    pbRec("microlabel word gap <= 0.6em in every Text face", rows.length > 0 && rows.every((r) => r.maxGap <= r.em * 0.6), { worst, faces: rows.length });
    await label.first().evaluate((el, id) => { el.style.fontFamily = `var(${id}), sans-serif`; }, faces.find((f) => f.id === worst.id).cssVar);
    await page.waitForTimeout(300);
    await pbShot(page, label.first(), "microlabel-widest");
    await context.close();
  });

  // item 3: the PIN keypad digits wear the Numerals face (Chivo Mono picked, so the Text face and the Numerals face differ)
  await pbRun("pin keypad", async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, initScript: pbFonts({ mono: "chivo-mono" }) });
    await page.getByRole("button", { name: /^Admin/ }).first().click();
    await seen(page, "[role=dialog]", 5000);
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const first = (el) => getComputedStyle(el).fontFamily.split(",")[0].trim();
      const key = document.querySelector('button[aria-label="digit 5"]');
      const r = key.getBoundingClientRect();
      return { key: first(key), clock: first(document.querySelector('[data-hero="time"]')), text: first(document.querySelector(".sr-pin-msg")), w: r.width, h: r.height };
    });
    pbRec("pin keys use the Numerals face", m.key === m.clock && m.key !== m.text, m);
    pbRec("pin key keeps its 56 px height", Math.abs(m.h - 56) <= 0.5, { h: m.h, w: m.w });
    await pbShot(page, page.locator("[role=dialog]").first(), "pin-keypad");
    await context.close();
  });

  // item 4 and the auto-off reading: full view at 1024x768 with six downloads and an alert
  await pbRun("downloads 1024", async () => {
    const { context, page } = await visit(FV_URL("sunroom", "standard"), { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, routes: { "/kiosk/api/downloads": PB_DL(6), "/kiosk/api/attention": PB_ALERT } });
    await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
    await page.waitForTimeout(600);
    const pill = await page.evaluate(() => {
      const wrap = document.querySelector('div[data-rain-zone="corner"]:not([role])');
      const h = (re) => [...wrap.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") ?? ""))?.getBoundingClientRect().height;
      return { dl: h(/download/i), al: h(/alert/i) };
    });
    pbRec("pills equal height", typeof pill.dl === "number" && typeof pill.al === "number" && Math.abs(pill.dl - pill.al) <= 0.5, pill);
    await page.getByRole("button", { name: /downloads in progress/i }).click();
    await seen(page, '[role="dialog"][aria-label="Downloads"]', 5000);
    await page.waitForTimeout(700);
    const d = await page.evaluate(() => {
      const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
      return { vw: innerWidth, vh: innerHeight, tray: box(document.querySelector('[role="dialog"][aria-label="Downloads"]')), rail: box(document.querySelector('[data-testid="kiosk-forecast-rail"]')), days: document.querySelector('[data-testid="kiosk-forecast-rail"]')?.children.length ?? 0 };
    });
    pbRec("downloads tray clear of the forecast rail", !!d.tray && !!d.rail && !pbHits(d.tray, d.rail), { tray: d.tray, rail: d.rail });
    pbRec("downloads tray stays anchored (right edge 20 from the viewport)", !!d.tray && Math.abs(d.vw - d.tray.right - 20) <= 1, { right: d.tray?.right, vw: d.vw });
    if (d.tray && d.rail) {
      const x = Math.max(0, Math.min(d.tray.left, d.rail.left) - 16), y = Math.max(0, d.rail.top - 16);
      await page.screenshot({ path: join(OUT_DIR, "polishb-downloads-tray-1024.png"), clip: { x, y, width: d.vw - x, height: Math.min(d.vh - y, d.tray.bottom + 16 - y) } });
    }
    await page.screenshot({ path: join(OUT_DIR, "polishb-full-1024x768.png"), fullPage: true });
    await page.keyboard.press("Escape");
    // the auto-off pill's time text against its gold fill (a reading, never a failure)
    const c = await page.evaluate(() => {
      const pillEl = document.querySelector('button[aria-label^="AC auto-off"]');
      if (!pillEl) return null;
      const num = (s) => s.match(/[\d.]+/g).map(Number);
      const lum = (c) => { const [R, G, B] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
      const text = getComputedStyle(pillEl.querySelector("[data-sr-num]")).color, fill = getComputedStyle(pillEl.querySelector(".sr-catch")).backgroundColor;
      const a = lum(num(text)) + 0.05, b = lum(num(fill)) + 0.05;
      return { label: pillEl.getAttribute("aria-label"), lit: pillEl.getAttribute("data-lit"), text, fill, ratio: Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100 };
    });
    PB.reported.autoOffContrast = c ?? "the auto-off pill was not on screen";
    await context.close();
  });

  // item 5: Glance at 390 px with the now-playing pill, plus the unchanged wide case
  for (const size of [{ name: "390x844", viewport: { width: 390, height: 844 } }, { name: "1024x768", viewport: SIZES[1].viewport }]) {
    await pbRun(`glance ${size.name}`, async () => {
      const { context, page } = await visit(MAIN_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, nowPlaying: true });
      await seen(page, '[data-rain-zone="tiles"] button', 15_000);
      await seen(page, "[data-sr-np]", 15_000);
      await page.waitForTimeout(800);
      const d = await page.evaluate(() => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, label: el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 16) }; };
        return { vh: innerHeight, pill: box(document.querySelector("[data-sr-np]")), tiles: [...document.querySelectorAll('[data-rain-zone="tiles"] button')].map(box), sentence: [...document.querySelectorAll('[data-rain-zone="sentence"]')].map(box) };
      });
      pbRec(`glance-${size.name} left controls present (Timers and a lamp)`, d.tiles.length >= 2, { tiles: d.tiles.map((t) => t.label) });
      pbRec(`glance-${size.name} no left control under the now-playing pill`, d.tiles.length > 0 && d.tiles.every((t) => !pbHits(t, d.pill)), { pill: d.pill, hits: d.tiles.filter((t) => pbHits(t, d.pill)).map((t) => t.label) });
      pbRec(`glance-${size.name} left controls clear of the centre column`, d.tiles.length > 0 && d.sentence.length > 0 && d.tiles.every((t) => d.sentence.every((s) => !pbHits(t, s))), { hits: d.tiles.filter((t) => d.sentence.some((s) => pbHits(t, s))).map((t) => t.label) });
      if (size.viewport.width > 640) pbRec(`glance-${size.name} wide cluster unchanged (bottom 16 above the viewport edge)`, d.tiles.length > 0 && d.tiles.every((t) => Math.abs(d.vh - 16 - t.bottom) <= 1), { bottoms: d.tiles.map((t) => t.bottom), vh: d.vh });
      await page.screenshot({ path: join(OUT_DIR, `polishb-glance-${size.name}.png`), fullPage: true });
      await context.close();
    });
  }

  // item 6: one clock width all day in the two display faces, and in the default face (glance 1024x768; four-digit readings, so the digit count is equal)
  for (const face of ["neon-mono", "pixel-mono", null]) {
    await pbRun(`clock ${face ?? "default"}`, async () => {
      const { context, page } = await visit(MAIN_URL, { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, initScript: face ? pbFonts({ mono: face }) : null });
      const widths = {};
      for (const t of ["11:11", "10:08", "12:38"]) {
        await context.clock.setFixedTime(pbInstant(t));
        await page.waitForFunction((want) => document.querySelector('[data-hero="time"] .sr-only')?.textContent === want, t, { timeout: 8000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        widths[t] = await page.evaluate(() => document.querySelector('[data-hero="time"] > span[aria-hidden]').getBoundingClientRect().width);
        if (face && (t === "11:11" || t === "10:08")) await pbShot(page, page.locator('[data-rain-zone="clock"]'), `clock-${face}-${t.replace(":", "")}`);
      }
      const v = Object.values(widths);
      pbRec(`clock-${face ?? "default"} width constant (11:11 vs 10:08 vs 12:38 within 1 px)`, Math.max(...v) - Math.min(...v) <= 1, widths);
      const read = await page.evaluate(() => ({ sr: document.querySelector('[data-hero="time"] .sr-only')?.textContent, hidden: document.querySelector('[data-hero="time"] > span[aria-hidden]') !== null }));
      pbRec(`clock-${face ?? "default"} reads as one string`, /^\d{1,2}:\d{2}$/.test(read.sr ?? "") && read.hidden, read);
      await context.close();
    });
  }
  if (PB.failed.length) process.exitCode = 1;
}
// ---- glance bottom row (2026-11-17): the now-playing pill never overlaps a chip, scene tile or cluster; folded lights; run alone with SHOTS_ONLY=glancerow ----
// Keys: results.glancerow.{checks.<key> {ok,...}, failed[] (one line each; the run exits 1 if any)}. Shots glancerow-<state>.png: one full viewport each.
// States a normal/idle, b normal/playing, c crowded 1024x768, d crowded 390x844, e crowded 768x1024, f one chip/playing, g crowded 1024x768 with a folded light on. Every check needs at least one matched element.
const GR = (results.glancerow = { checks: {}, failed: [] });
const grRec = (key, ok, detail = {}) => { GR.checks[key] = { ok, ...detail }; if (!ok) GR.failed.push(`${key} ${JSON.stringify(detail)}`); };
const grHit = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
/** Page-side: every rect the checks need, the house tokens as probes (never free numbers), and a cover check per chip (centre plus four inset corners, as pbChipClear). */
const GR_READ = () => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
  const scope = document.querySelector("[data-kiosk-theme]");
  const probe = (css) => { const el = document.createElement("span"); el.style.cssText = `position:absolute;visibility:hidden;${css}`; scope.append(el); const w = parseFloat(getComputedStyle(el).width); el.remove(); return w; };
  const clear = (el) => { const b = el.getBoundingClientRect(), d = Math.round(Math.min(b.width, b.height) * 0.35); /* inset past the corner radius */ const pts = [[b.left + b.width / 2, b.top + b.height / 2], [b.left + d, b.top + d], [b.right - d, b.top + d], [b.left + d, b.bottom - d], [b.right - d, b.bottom - d]]; return pts.every(([x, y]) => { const h = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight ? document.elementFromPoint(x, y) : null; return !!h && el.contains(h); }); };
  const cluster = document.querySelector('[data-rain-zone="tiles"]');
  const chips = cluster ? [...cluster.querySelectorAll("button")] : [];
  const corner = document.querySelector('[data-rain-zone="corner"]');
  const pill = document.querySelector("[data-sr-np]");
  return {
    vh: innerHeight, vw: innerWidth,
    tapMin: probe("width:var(--sr-hit-min)"), row1: probe("width:calc(1rem + env(safe-area-inset-bottom))"), row2: probe("width:calc(5.25rem + env(safe-area-inset-bottom))"),
    cluster: cluster ? r(cluster) : null, corner: corner && corner.getBoundingClientRect().width > 0 ? r(corner) : null, pill: pill ? r(pill) : null,
    chips: chips.map((b) => ({ rect: r(b), label: b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 12), clear: clear(b), clipped: [...b.querySelectorAll("span")].some((s) => s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).textOverflow !== "ellipsis") })),
    more: chips.filter((b) => /^Show all \d+ lights(, \d+ on)?$/.test(b.getAttribute("aria-label") ?? "")).length,
    moreChip: (() => { const b = chips.find((x) => /^Show all \d+ lights/.test(x.getAttribute("aria-label") ?? "")); return b ? { label: b.getAttribute("aria-label"), on: /\btext-accent\b/.test(b.className) } : null; })(),
    scenes: [...document.querySelectorAll('[data-glance-widget="scenes"] button')].map((b) => r(b)),
    // Glance column text lines (check 8): every element with its own text in the bin line and the non-scene widgets, one rect per element.
    lines: [...document.querySelectorAll('[data-bin-night="line"], [data-bin-night="line"] *, [data-glance-widget]:not([data-glance-widget="scenes"]) *')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getBoundingClientRect().height > 0)
      .map((el) => ({ text: el.textContent.trim().slice(0, 24), ...r(el) })),
    sceneRow: (() => { const w = document.querySelector('[data-glance-widget="scenes"]'); return w ? r(w) : null; })(),
  };
};
const grState = async (key, size, { lights = 5, scenes = 4, timer = false, np = false, lastOn = false } = {}, wantMore = null, row = null) => {
  const ha = fvHa({ lights, scenes, switches: 2, sensors: 1 });
  if (scenes >= 2) ha.entities.scenes[1].name = "Night";
  if (lastOn) ha.entities.lights[lights - 1].on = true; // the last light is the first to fold
  const { context, page } = await fvVisit({ viewport: { width: size[0], height: size[1] } }, { layout: "glance", ha, timer, np });
  try {
    await seen(page, '[data-rain-zone="tiles"] button', 15_000);
    if (scenes) await seen(page, '[data-glance-widget="scenes"] button', 15_000);
    if (np) await seen(page, "[data-sr-np]", 15_000);
    await page.waitForTimeout(1200); // the pill's fade and the cluster's fit settle
    const m = await page.evaluate(GR_READ);
    const k = (s) => `${key} ${s}`;
    grRec(k("chips matched"), m.chips.length > 0 && m.tapMin > 0, { chips: m.chips.length, tapMin: m.tapMin });
    if (scenes) grRec(k("scenes matched"), m.scenes.length === scenes, { scenes: m.scenes.length });
    if (np) {
      const hits = m.chips.filter((c) => grHit(m.pill, c.rect)).map((c) => c.label).concat(m.scenes.filter((s) => grHit(m.pill, s)).map(() => "scene"), grHit(m.pill, m.cluster) ? ["cluster"] : [], m.corner && grHit(m.pill, m.corner) ? ["corner"] : []);
      grRec(k("(1) pill overlaps no chip, scene or cluster"), !!m.pill && hits.length === 0, { pill: m.pill, hits });
    } else grRec(k("(1) no pill when nothing plays"), m.pill === null);
    const under = m.chips.flatMap((c) => m.scenes.filter((s) => grHit(c.rect, s)).map(() => c.label));
    grRec(k("(2) no cluster chip under a scene chip"), under.length === 0, { under });
    grRec(k("(3) every chip at least the tap floor high, clear of chrome, text ellipsised"), m.chips.every((c) => c.rect.h >= m.tapMin - 0.5 && c.clear && !c.clipped), { tapMin: m.tapMin, chips: m.chips.map((c) => [c.label, Math.round(c.rect.h), c.clear, c.clipped]) });
    if (row) { const want = m[row]; grRec(k(`(4) cluster bottom offset is ${row}`), !!m.cluster && Math.abs(m.vh - m.cluster.bottom - want) <= 0.5, { got: m.vh - m.cluster.bottom, want }); }
    // (5) nothing clipped by the overflow-hidden root: every scene tile and cluster chip lies fully inside the viewport.
    const outside = [...m.chips.map((c) => [c.label, c.rect]), ...m.scenes.map((r2) => ["scene", r2])].filter(([, r2]) => r2.left < -0.5 || r2.top < -0.5 || r2.right > m.vw + 0.5 || r2.bottom > m.vh + 0.5).map(([l]) => l);
    grRec(k("(5) every scene tile and cluster chip is fully inside the viewport"), m.chips.length + m.scenes.length > 0 && outside.length === 0, { outside });
    // (6) while the pill plays, the scene row sits at or above the pill's top.
    if (np && scenes) { const sb = Math.max(...m.scenes.map((r2) => r2.bottom)); grRec(k("(6) scene row bottom is at or above the pill top"), !!m.pill && sb <= m.pill.top + 0.5, { sceneBottom: sb, pillTop: m.pill?.top }); }
    // (8) no scene tile touches a Glance text line (at least 3 lines matched), and the lowest line ends 8 px (the house gap-2) above the scene row.
    if (scenes) {
      const touched = m.lines.filter((l) => m.scenes.some((s) => grHit(l, s))).map((l) => l.text);
      const low = Math.max(...m.lines.map((l) => l.bottom)), top = Math.min(...m.scenes.map((s) => s.top));
      grRec(k("(8) scene tiles clear of every Glance text line"), m.lines.length >= 3 && touched.length === 0 && low <= top - 8, { lines: m.lines.length, touched, lowestBottom: low, sceneTop: top, rects: m.lines.map((l) => [l.text, Math.round(l.top), Math.round(l.bottom)]), scenes: m.scenes });
    }
    // (9) the clock (the stack's first child) and the scene row both lie inside the viewport and inside the overflow-hidden column; the clock top is at least 8px from the viewport top.
    const c9 = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const clock = document.querySelector('[data-hero="time"]'), scene = document.querySelector('[data-glance-widget="scenes"]');
      let col = clock?.parentElement;
      while (col && getComputedStyle(col).overflowY !== "hidden") col = col.parentElement;
      return { vh: innerHeight, clock: clock && r(clock), scene: scene && r(scene), col: col && r(col) };
    });
    const in9 = (x) => x && x.top >= 8 - 0.5 && x.bottom <= c9.vh + 0.5 && c9.col && x.top >= c9.col.top - 0.5 && x.bottom <= c9.col.bottom + 0.5;
    grRec(k("(9) clock and scene row inside the viewport and the column"), !!c9.clock && !!c9.col && (!scenes || !!c9.scene) && in9(c9.clock) && (!scenes || in9(c9.scene)), c9);
    if (wantMore === "on") grRec(k("(7) +n chip carries the on tone and its name ends on"), !!m.moreChip && m.moreChip.on && /, \d+ on$/.test(m.moreChip.label), { moreChip: m.moreChip });
    else if (wantMore !== null) grRec(k(wantMore ? "folds into a +n chip" : "no +n chip"), (m.more === 1) === wantMore && m.more <= 1, { more: m.more });
    await page.screenshot({ path: join(OUT_DIR, `glancerow-${key.replace(/ /g, "-")}.png`) });
  } finally { await context.close(); }
};
async function glancerowShots() {
  const run = (name, fn) => guarded(`glancerow ${name}`, async () => { try { await fn(); } catch (e) { GR.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
  await run("a normal idle 1024", () => grState("a normal-idle-1024x768", [1024, 768], { lights: 5, scenes: 4 }, null, "row1"));
  await run("b normal playing 1024", () => grState("b normal-playing-1024x768", [1024, 768], { lights: 5, scenes: 4, np: true }, null, "row2"));
  await run("c crowded 1024", () => grState("c crowded-1024x768", [1024, 768], { lights: 8, scenes: 2, timer: true, np: true }, true, "row2"));
  await run("d crowded 390", () => grState("d crowded-390x844", [390, 844], { lights: 8, scenes: 2, timer: true, np: true }, true, "row2"));
  await run("e crowded 768", () => grState("e crowded-768x1024", [768, 1024], { lights: 8, scenes: 2, timer: true, np: true }, true, "row2"));
  await run("f one chip playing", () => grState("f one-chip-playing-1024x768", [1024, 768], { lights: 1, scenes: 2, np: true }, false, "row2"));
  await run("g crowded folded on 1024", () => grState("g crowded-folded-on-1024x768", [1024, 768], { lights: 8, scenes: 2, timer: true, np: true, lastOn: true }, "on", "row2"));
  if (GR.failed.length) process.exitCode = 1;
}
if ((process.env.SHOTS_ONLY ?? process.env.ONLY) === "glancerow") {
  await glancerowShots();
  results.n16PageErrorMessages = pageErrorMessages;
  results.n16ForeignRequests = foreign;
  await browser.close();
  writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  process.exit(process.exitCode ?? 0);
}

if ((process.env.SHOTS_ONLY ?? process.env.ONLY) === "polishb") {
  await polishbShots();
  results.n16PageErrorMessages = pageErrorMessages;
  results.n16ForeignRequests = foreign;
  await browser.close();
  writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  process.exit(process.exitCode ?? 0);
}

// ---- main states: both sizes, 10 s at rest ----
for (const size of SIZES) {
  await guarded(`main ${size.name}`, async () => {
    const { context, page } = await visit(MAIN_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true });
    await page.waitForTimeout(10_000);
    await page.screenshot({ path: join(OUT_DIR, `main-${size.name}.png`), fullPage: true });
    const scan = await page.evaluate(SCAN);
    results[`main-${size.name}`] = scan.vars;
    results.n17RunningAnimations = (results.n17RunningAnimations ?? []).concat(scan.running);
    results.n19BackdropFilter = (results.n19BackdropFilter ?? 0) + scan.backdrop;
    results.n20PaneInPane = (results.n20PaneInPane ?? 0) + scan.paneInPane;
    await context.close();
  });
}

// ---- six-stop pass: ?wx=off, the mocked sun lands each stop exactly ----
for (const stop of STOPS) {
  await guarded(`stop ${stop}`, async () => {
    const { context, page } = await visit(STOP_URL, { viewport: SIZES[0].viewport, weather: weatherFor(stop), fixedTime: true });
    await page.screenshot({ path: join(OUT_DIR, `stop-${stop}.png`), fullPage: true });
    results.sixStop[stop] = (await page.evaluate(SCAN)).vars;
    await context.close();
  });
  // the on-state glaze per stop: the controls view with the fixture's ON and OFF chips, cropped to the switches row
  await guarded(`stop-controls ${stop}`, async () => {
    const { context, page } = await visit(`${STOP_URL}&layout=standard`, { viewport: SIZES[0].viewport, weather: weatherFor(stop), fixedTime: true, ha: true });
    const chip = page.getByRole("switch", { name: /^Toggle Heater/ }).first();
    await chip.waitFor({ timeout: 8000 });
    await page.waitForTimeout(1200); // past the catch bloom, so the chip rests on the glaze
    await page.screenshot({ path: join(OUT_DIR, `stop-controls-${stop}.png`) });
    const box = await chip.evaluate((el) => {
      const r = el.parentElement.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const pad = 24;
    await page.screenshot({ path: join(OUT_DIR, `stop-chips-${stop}.png`), clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
    await context.close();
  });
}

// ---- AC mode colour: the Living AC power disc per mode, midday and night, cropped at 1180x820 ----
// ac-mode-<mode>-<stop>.png for heat, cool, dry, fan_only, auto (the fixture's climate.living with hvacMode swapped per visit, see climateMode in visit());
// ac-mode-off-remembered-<stop>.png loads ON in heat, taps the power button off (writes are mocked; the mode hold shows off) and crops the disc.
results.acModes = {};
for (const stop of ["midday", "night"]) {
  for (const mode of ["heat", "cool", "dry", "fan_only", "auto", "off-remembered"]) {
    await guarded(`ac-modes ${mode} ${stop}`, async () => {
      const off = mode === "off-remembered";
      const { context, page } = await visit(`${STOP_URL}&layout=standard`, { viewport: SIZES[0].viewport, weather: weatherFor(stop), fixedTime: true, ha: true, climateMode: off ? "heat" : mode });
      const btn = page.getByRole("button", { name: /^Turn (off|on) Living/ }).first();
      await btn.waitFor({ timeout: 8000 });
      if (off) await btn.click();
      await page.waitForTimeout(1200); // past the bloom or the shrink
      const box = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const pad = 16;
      await page.screenshot({ path: join(OUT_DIR, `ac-mode-${mode}-${stop}.png`), clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
      results.acModes[`${mode}-${stop}`] = await btn.evaluate((el) => ({ dataMode: el.getAttribute("data-mode"), pressed: el.getAttribute("aria-pressed"), face: getComputedStyle(el.querySelector(".sr-catch")).backgroundColor }));
      await context.close();
    });
  }
}

// ---- the dark crossing: the clone is aria-hidden, inert, and gone after the fade ----
await guarded("crossing", async () => {
  const { context, page, state } = await visit(STOP_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday") });
  state.weather = weatherFor("night");
  await page.waitForTimeout(4500); // SWR ignores focus for 5 s after mount (focusThrottleInterval, swr index.mjs:545) and dedupes for 2 s
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  results.crossing.cloneSeen = await seen(page, ".sr-stopfade", 6000);
  results.crossing.ariaHidden = await page.evaluate(() => document.querySelector(".sr-stopfade")?.getAttribute("aria-hidden") === "true");
  results.crossing.inert = await page.evaluate(() => !!document.querySelector(".sr-stopfade")?.inert);
  await page.waitForTimeout(4500); // fade is 3 s, removal timeout 3.4 s
  results.crossing.strayClones = await page.locator(".sr-stopfade").count();
  results.crossing.scopeIntact = await page.evaluate(() => document.querySelector('[data-kiosk-theme="sunroom"]') !== null);
  await context.close();
});

// ---- controls (PR 2): N11 targets, N12 live transitions, N18 tone words, N14 reduced motion; rest + open states ----
const CONTROLS = () => {
  const small = [...document.querySelectorAll("button, [role=button], input, a")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .map(({ el, r }) => `${el.getAttribute("aria-label") ?? el.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
  const live = [...document.querySelectorAll("[data-sr-live]")]
    .filter((el) => getComputedStyle(el).transitionDuration.split(",").some((d) => parseFloat(d) > 0) && !el.closest("[data-sr-vitals-fill]"))
    .map((el) => el.className || el.tagName);
  const tone = [...document.querySelectorAll("[data-sr-tone]")].filter((el) => !(el.textContent ?? "").trim()).map((el) => el.className || el.tagName);
  return { n11Small: small, n12LiveTransitions: live, n18ToneWithoutWord: tone };
};
/** Before a rest shot: no focus ring, no dialog, no finite animation still running (infinite ambient loops don't count). Times out at 5 s and carries on. */
const settleRest = (page) =>
  page
    .waitForFunction(
      () =>
        !document.querySelector('[data-kiosk-focus="on"]') &&
        !document.querySelector("[role=dialog]") &&
        document.getAnimations().filter((a) => a.playState === "running" && isFinite(a.effect?.getTiming().iterations)).length === 0,
      null,
      { timeout: 5000 },
    )
    .then(() => true, () => false);
results.controls = { seen: {}, reduced: {} };
for (const size of SIZES) {
  await guarded(`controls ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
    const seenTile = await seen(page, ".sr-climate", 15_000);
    results.controls.seen[size.name] = { tile: seenTile, chip: await page.locator("button.sr-chip").count(), switchTrack: await page.locator(".sr-switch-track").count() };
    const out = (results.controls[size.name] = {});
    if (!seenTile) {
      // a missing tile is a failure, not a pass: record it and skip nothing silently
      out.rest = { missing: ".sr-climate", ...((await crashed(page)) && { crashed: true }) };
      out.restSettled = await settleRest(page);
      await page.screenshot({ path: join(OUT_DIR, `controls-rest-${size.name}.png`) });
      await context.close();
      return;
    }
    out.restSettled = await settleRest(page);
    await page.screenshot({ path: join(OUT_DIR, `controls-rest-${size.name}.png`) });
    out.rest = await page.evaluate(CONTROLS);
    // (a) the AC auto-off pill opens its sheet; close it with its Close button before the next step
    page.step = "sheet";
    const pill = page.getByRole("button", { name: /^AC auto-off/ });
    if (await pill.count()) {
      await pill.click();
      if (await seen(page, "[role=dialog]", 5000)) {
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT_DIR, `controls-sheet-${size.name}.png`) });
        out.sheet = await page.evaluate(CONTROLS);
        // the sheet is the only place .sr-switch-track renders (SunSwitchTrack in kiosk-climate-auto-off.tsx:325); Fan/Heater are ToggleChips
        out.sheet.switchTrack = await page.locator(".sr-switch-track").count();
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await page.waitForSelector("[role=dialog]", { state: "detached", timeout: 5000 }).catch(() => (out.sheet.stuckOpen = true));
      } else out.sheet = { missing: "[role=dialog]" };
    } else out.sheet = { missing: "AC auto-off pill" };
    // (b) a plain ToggleChip (role=switch, "Toggle <name>") flips in place: data-lit/aria-checked and the .sr-state word
    page.step = "chip";
    const chip = page.getByRole("switch", { name: /^Toggle / }).first();
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT_DIR, `controls-chip-${size.name}.png`) });
      out.chipAfterClick = await chip.evaluate((el) => ({ name: el.getAttribute("aria-label"), lit: el.getAttribute("data-lit") ?? el.getAttribute("aria-checked"), word: el.querySelector(".sr-state")?.textContent ?? "" }));
    } else out.chipAfterClick = { missing: "Toggle chip" };
    // (c) the climate modal
    page.step = "modal";
    const expand = page.getByRole("button", { name: /Advanced controls for Living/ });
    if (await expand.count()) {
      await expand.click();
      await seen(page, "[role=dialog]", 5000);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT_DIR, `controls-modal-${size.name}.png`) });
      out.modal = await page.evaluate(CONTROLS);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else out.modal = { missing: "Advanced controls for Living" };
    await context.close();
  });
  await guarded(`controls reduced ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, reduced: true, ha: true });
    if (!(await seen(page, ".sr-climate", 15_000))) {
      results.controls.reduced[size.name] = { missing: ".sr-climate" };
      await context.close();
      return;
    }
    const chip = page.getByRole("switch", { name: /^Toggle / }).first();
    if (await chip.count()) await chip.click();
    await page.waitForTimeout(300);
    const running = (await page.evaluate(SCAN)).running;
    results.controls.reduced[size.name] = { n14Running: running };
    await context.close();
  });
}

// ---- overlays (PR 3): N11 targets, N13 ancestors, N14 reduced motion, N16, N18/N19 with each overlay open ----
// JSON keys: overlays.<size>.<state>.{n13Ancestors,n13PanelEmpty,inHost,hostIsScopeChild,n19Backdrop,n19Defocus,titlePx,n11Small,n12LiveTransitions,n18ToneWithoutWord}
// (or {missing}), overlays.pin.{wrongShake,lockedMsg,keysDisabled}, overlays.elevated.{admin,appearance}, overlays.reduced.<size>.<state>.n14Running.
// States: autoOff (sheet), climateModal (dialog), timers (sheet), pin (PIN pad), radar (its unconfigured card). The doorbell, the alert takeover and tray,
// and the downloads tray and toast need their own mocked answers: see overlays.extra below.
const OVERLAY_SCAN = () => {
  const dlg = document.querySelector("[data-sr-face]") ?? document.querySelector("[role=dialog]");
  const host = document.querySelector("[data-sr-overlay-host]");
  const scope = document.querySelector('[data-kiosk-theme="sunroom"]');
  const ancestors = [];
  for (let el = dlg?.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none") ancestors.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
  }
  const title = document.querySelector("[data-sr-title]");
  return {
    bottomGap: dlg ? Math.round((innerHeight - dlg.getBoundingClientRect().bottom) * 10) / 10 : null, // viewport height minus the overlay's bottom edge: >= 0 for sheets
    n13Ancestors: ancestors,
    n13PanelEmpty: dlg ? getComputedStyle(dlg).getPropertyValue("--sr-panel").trim() === "" : true,
    inHost: !!(dlg && host && host.contains(dlg)),
    hostIsScopeChild: !!host && host.parentElement === scope,
    n19Backdrop: [...document.querySelectorAll("*")].filter((el) => { const b = getComputedStyle(el).backdropFilter; return b && b !== "none"; }).length,
    n19Defocus: [...document.querySelectorAll(".kiosk-defocus")].filter((el) => getComputedStyle(el).filter !== "none").length,
    titlePx: title ? getComputedStyle(title).fontSize : null,
  };
};
const OVERLAY_STATES = [
  { key: "autoOff", open: (p) => p.getByRole("button", { name: /^AC auto-off/ }), close: (p) => p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click() },
  { key: "climateModal", shot1024: true, open: (p) => p.getByRole("button", { name: /Advanced controls for Living/ }), close: (p) => p.keyboard.press("Escape") },
  { key: "timers", open: (p) => p.getByRole("button", { name: /^Timers/ }), close: (p) => p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click() },
  { key: "pin", shot1024: true, open: (p) => p.getByRole("button", { name: /^Admin/ }).first(), close: (p) => p.keyboard.press("Escape") },
  { key: "radar", open: (p) => p.getByRole("button", { name: "Open the rain radar" }), close: (p) => p.keyboard.press("Escape") },
];
/** Waits until the overlay's own animations are done (getAnimations() empty), capped at 1 s, then 100 ms. */
async function settle(page, sel = "[data-sr-face]") {
  await page.evaluate(async (q) => {
    const el = document.querySelector(q);
    if (!el) return;
    const running = [el, el.parentElement].flatMap((n) => (n ? n.getAnimations() : []));
    await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1000))]);
  }, sel);
  await page.waitForTimeout(100);
}
/** Open one overlay; resolves the locator's presence, the dialog's arrival, then runs `then`; always closes and waits for the dialog to go. */
async function withOverlay(page, st, then) {
  const trigger = st.open(page);
  if (!(await trigger.count())) return { missing: `${st.key} trigger` };
  await trigger.click();
  if (!(await seen(page, "[role=dialog]", 5000))) return { missing: `${st.key} dialog` };
  await settle(page);
  const r = await then();
  await st.close(page);
  await page.waitForSelector("[role=dialog]", { state: "detached", timeout: 5000 }).catch(() => (r.stuckOpen = true));
  await page.waitForTimeout(300);
  return r;
}
results.overlays = { reduced: {} };
for (const size of SIZES) {
  await guarded(`overlays ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
    await seen(page, ".sr-climate", 15_000);
    const out = (results.overlays[size.name] = {});
    for (const st of OVERLAY_STATES) {
      page.step = `overlay ${st.key}`;
      out[st.key] = await withOverlay(page, st, async () => {
        if (size.name === "1180x820" || st.shot1024) await page.screenshot({ path: join(OUT_DIR, `overlay-${st.key}-${size.name}.png`) });
        return { ...(await page.evaluate(OVERLAY_SCAN)), ...(await page.evaluate(CONTROLS)) }; // CONTROLS is node-side: run it in the page on its own
      });
    }
    await context.close();
  });
  await guarded(`overlays reduced ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, reduced: true, ha: true });
    await seen(page, ".sr-climate", 15_000);
    const out = (results.overlays.reduced[size.name] = {});
    for (const st of OVERLAY_STATES) {
      page.step = `overlay reduced ${st.key}`;
      out[st.key] = await withOverlay(page, st, async () => ({ n14Running: (await page.evaluate(SCAN)).running }));
    }
    await context.close();
  });
}
// the PIN pad's guards in the fixture world: a 429 shows the countdown word with the keys disabled; a 200 elevates (the admin panel and appearance appear)
await guarded("overlays pin lockout", async () => {
  const { context, page } = await visit(CONTROLS_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
  await page.route("**/api/auth/kiosk", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 429, json: { error: "Too many attempts", lockedUntil: Date.parse(PINNED_ISO) + 60_000 } }) : route.fallback(),
  );
  const admin = page.getByRole("button", { name: /^Admin/ }).first();
  if (!(await admin.count())) return void (results.overlays.pin = { missing: "Admin button" });
  await admin.click();
  await seen(page, "[role=dialog]", 5000);
  for (const d of "0000") await page.getByRole("button", { name: `digit ${d}` }).click(); // placeholder PIN: the route is mocked
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT_DIR, "overlay-pin-locked-1180x820.png") });
  results.overlays.pin = await page.evaluate(() => ({
    lockedMsg: document.querySelector(".sr-pin-msg")?.textContent ?? "",
    msgTone: document.querySelector(".sr-pin-msg [data-sr-tone]")?.getAttribute("data-sr-tone") ?? null,
    keysDisabled: [...document.querySelectorAll('[role=dialog] button[aria-label^="digit"]')].every((b) => b.disabled),
  }));
  await context.close();
});
await guarded("overlays elevated", async () => {
  const { context, page } = await visit(CONTROLS_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
  await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { ok: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }) : route.fallback()));
  // the page re-asks /refresh on activity; an unmocked answer would drop the elevated window
  await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: { elevated: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }));
  const admin = page.getByRole("button", { name: /^Admin/ }).first();
  if (!(await admin.count())) return void (results.overlays.elevated = { missing: "Admin button" });
  await admin.click();
  await seen(page, "[role=dialog]", 5000);
  for (const d of "0000") await page.getByRole("button", { name: `digit ${d}` }).click();
  await page.waitForTimeout(1500);
  results.overlays.elevated = { appearance: await page.getByRole("tablist", { name: "Personalisation" }).count(), admin: await page.getByText(/elevated · locks in/).count() };
  if (!results.overlays.elevated.admin || !results.overlays.elevated.appearance) results.overlays.elevated.missing = "Personalisation tablist or the elevated timer not found after a mocked 200 and /refresh";
  if (results.overlays.elevated.admin) await page.screenshot({ path: join(OUT_DIR, "overlay-elevated-1180x820.png") });
  await context.close();
});

// ---- overlays.extra: the doorbell, the alert takeover and tray, the downloads toast and tray (real API shapes, mocked per path) ----
// Own visits: a real clock (SWR's dedupe and focus throttle read Date.now, which a pinned clock freezes) and ?period=day against the night overlay.
// Keys: overlays.extra.<state>.{present,inHost,face,n13Ancestors,chimeOscillators} (or {missing}). Radar's loop (status ok) needs real image URLs, so it is shot unconfigured above.
const EXTRA_URL = `${CONTROLS_URL}&period=day`;
const DOORBELL_OK = { status: "ok", cameras: [{ entityId: "camera.front_door", name: "Front door", available: true }], triggers: [], latest: null, autoOpen: true, viewCamera: null, lastSeenAt: "2026-06-15T04:32:00.000Z" }; // HaDoorbellSnapshot (types/ha.ts:193)
const ATTENTION_WARN = { status: "attention", severity: "warn", headline: "A container stopped", detail: "Placeholder detail for the capture.", action: "Open the dashboard", since: "2026-06-15T09:00:00+10:00" }; // AttentionResult (attention.ts:62)
const ATTENTION_DOORBELL = { status: "attention", severity: "warn", headline: "Front door camera has gone quiet", detail: "No motion reported for 68 days.", action: "Reload its integration in Home Assistant; it may need signing in.", since: "2026-06-15T09:00:00+10:00" }; // copy from doorbellQuietCopy (attention-copy.ts)
const downloads = (n) => ({ status: "ok", items: Array.from({ length: n }, (_, i) => ({ hash: `h${i}`, name: `Placeholder download ${i + 1}`, progress: 0.3 + i * 0.2, dlspeed: 2_500_000, size: 4_000_000_000, eta: 900 })) }); // KioskDownloadsResult (types/downloads.ts:29)
// counts the oscillators the chime makes: Web Audio is locked until a gesture, so the page gets a running stub
const AUDIO_STUB = "window.__osc = 0; window.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() { return Promise.resolve(); } createOscillator() { window.__osc++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };";
const SCAN_AT = (sel) => {
  const el = document.querySelector(sel);
  const host = document.querySelector("[data-sr-overlay-host]");
  const ancestors = [];
  for (let a = el?.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none") ancestors.push(`${a.tagName.toLowerCase()}.${String(a.className).slice(0, 40)}`);
  }
  return { bottomGap: el ? Math.round((innerHeight - el.getBoundingClientRect().bottom) * 10) / 10 : null, present: !!el, inHost: !!(el && host && host.contains(el)), face: el ? getComputedStyle(el).boxShadow !== "none" : false, n13Ancestors: ancestors };
};
const extraVisit = (routes, viewport = SIZES[0].viewport) => visit(EXTRA_URL, { viewport, weather: weatherFor("midday"), fixedTime: "flow", ha: true, routes, initScript: AUDIO_STUB });
// The hook seeds its FIRST poll as already-seen (no takeover on reload), so the takeover needs a quiet first poll, then a new alert on a later one.
const raiseAlert = async (routes, page, alert) => {
  await page.waitForTimeout(5500); // past SWR's 5 s focus throttle, first poll landed
  routes["/kiosk/api/attention"] = alert;
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await focus();
  // SHOTS-N3: a slow first poll can swallow the focus; one retry past the throttle if the takeover has not shown.
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 6000))) await focus();
};
// KIOSK-S1: the takeover wash must cover the room (alpha >= 0.88). Computed color-mix serialises as rgba(...) or color(srgb r g b / a).
const SCRIM_AT = () => {
  const cs = getComputedStyle(document.querySelector('[data-sr-overlay="takeover"]'));
  const bg = cs.backgroundColor;
  return { scrimAlpha: bg.includes("/") ? parseFloat(bg.split("/")[1]) : bg.startsWith("rgba") ? parseFloat(bg.split(",")[3]) : 1, backdropFilter: cs.backdropFilter };
};
const checkScrim = (name, take) => { if (!(take.scrimAlpha >= 0.88)) results.errors.push(`${name}: takeover scrim alpha ${take.scrimAlpha} < 0.88`); };
results.overlays.extra = {};
await guarded("overlays extra doorbell", async () => {
  const { context, page } = await extraVisit({ "/kiosk/api/doorbell": DOORBELL_OK });
  const out = (results.overlays.extra.doorbell = {});
  const trigger = page.getByRole("button", { name: "View the front door camera" });
  if (!(await trigger.count())) return void (out.missing = "doorbell trigger");
  await trigger.click();
  if (!(await seen(page, "[role=dialog]", 5000))) return void (out.missing = "doorbell dialog");
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, "overlay-doorbell-1180x820.png") });
  Object.assign(out, await page.evaluate(SCAN_AT, "[data-sr-face]"));
  await context.close();
});
// kiosk-door-link: /kiosk?door=1 opens the doorbell modal by itself, then drops `door` from the URL (the other params stay). No cropElement helper exists in this repo, so a plain screenshot.
for (const size of SIZES) {
  await guarded(`overlays extra door link ${size.name}`, async () => {
    const { context, page } = await visit(`${BASE_URL}/kiosk?door=1&theme=sunroom&wx=overcast&wxsun=day`, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: "flow", ha: true, routes: { "/kiosk/api/doorbell": DOORBELL_OK }, initScript: AUDIO_STUB });
    const out = (results.overlays.extra[`doorLink-${size.name}`] = {});
    if (!(await seen(page, "[role=dialog]", 8000))) return void (out.missing = "door link did not open the dialog");
    await settle(page);
    await page.screenshot({ path: join(OUT_DIR, `kiosk-door-link-${size.name}.png`) });
    out.search = new URL(page.url()).search;
    out.dialogs = await page.locator("[role=dialog]").count();
    await context.close();
  });
}
await guarded("overlays extra alerts", async () => {
  const routes = { "/kiosk/api/attention": { status: "quiet" } };
  const { context, page } = await extraVisit(routes);
  const take = (results.overlays.extra.alertTakeover = {});
  await raiseAlert(routes, page, ATTENTION_WARN);
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 8000))) return void (take.missing = "takeover did not open for one raised alert");
  await settle(page, '[data-sr-overlay="takeover"] [data-sr-face], [data-sr-overlay="takeover"]');
  await page.screenshot({ path: join(OUT_DIR, "overlay-alert-takeover-1180x820.png") });
  Object.assign(take, await page.evaluate(SCAN_AT, '[data-sr-overlay="takeover"]'), { chimeOscillators: await page.evaluate(() => window.__osc) }, await page.evaluate(SCRIM_AT));
  checkScrim("alertTakeover", take);
  await page.getByRole("status").filter({ hasText: "A container stopped" }).first().click(); // a tap dismisses
  await page.waitForSelector('[data-sr-overlay="takeover"]', { state: "detached", timeout: 8000 }).catch(() => (take.stuckOpen = true));
  const tray = (results.overlays.extra.alertTray = {});
  const btn = page.getByRole("button", { name: /^\d+ alerts?\b/ });
  if (!(await btn.count())) return void (tray.missing = "alerts button after the takeover");
  await btn.click();
  if (!(await seen(page, '[role=dialog][aria-label="Alerts"]', 5000))) return void (tray.missing = "alerts tray");
  await settle(page, '[role=dialog][aria-label="Alerts"]');
  await page.screenshot({ path: join(OUT_DIR, "overlay-alert-tray-1180x820.png") });
  Object.assign(tray, await page.evaluate(SCAN_AT, '[role=dialog][aria-label="Alerts"]'));
  await context.close();
});
// SHOTS-N4: the takeover at night. Pinned as the night stop is (wx=off, the night weather mock, a flowing clock) with ?period=day so the night overlay stays out of the way.
// Keys: overlays.extra.alertTakeoverNight.{scrimAlpha,washColor,headline:{color,fontPx,contrast},caption:{color,fontPx,contrast},since:{text,fontPx,contrast}|null}; contrast is the worst over a black and a white backdrop, must be >= 4.5.
const NIGHT_CONTRAST_AT = () => {
  const rgba = (c) => { const n = c.match(/-?[\d.]+/g).map(Number); return c.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const wash = rgba(getComputedStyle(document.querySelector('[data-sr-overlay="takeover"]')).backgroundColor);
  const over = (bd) => wash.slice(0, 3).map((v, i) => v * wash[3] + bd * (1 - wash[3]));
  const text = (el) => { const cs = getComputedStyle(el); const fg = rgba(cs.color).slice(0, 3); return { color: cs.color, fontPx: parseFloat(cs.fontSize), contrast: Math.round(Math.min(ratio(fg, over(0)), ratio(fg, over(255))) * 100) / 100 }; };
  const status = document.querySelector('[role="status"][aria-live="assertive"]');
  return { washColor: getComputedStyle(document.querySelector('[data-sr-overlay="takeover"]')).backgroundColor, headline: text(status.querySelector("p")), caption: text(status.querySelectorAll("p")[1]), since: (() => { const p = [...status.querySelectorAll("p")].find((e) => e.textContent.startsWith("Standing for")); return p ? { text: p.textContent, ...text(p) } : null; })() };
};
await guarded("overlays extra alert takeover night", async () => {
  const routes = { "/kiosk/api/attention": { status: "quiet" } };
  const { context, page } = await visit(`${STOP_URL}&layout=standard&period=day`, { viewport: SIZES[0].viewport, weather: weatherFor("night"), fixedTime: "flow", ha: true, routes, initScript: AUDIO_STUB });
  const take = (results.overlays.extra.alertTakeoverNight = {});
  await raiseAlert(routes, page, ATTENTION_WARN);
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 8000))) return void (take.missing = "takeover did not open for one raised alert at night");
  await settle(page, '[data-sr-overlay="takeover"] [data-sr-face], [data-sr-overlay="takeover"]');
  await page.screenshot({ path: join(OUT_DIR, "overlay-alert-takeover-night-1180x820.png") }); // plain screenshot, as the day state: this script has no cropElement helper
  Object.assign(take, await page.evaluate(SCAN_AT, '[data-sr-overlay="takeover"]'), { chimeOscillators: await page.evaluate(() => window.__osc) }, await page.evaluate(SCRIM_AT), await page.evaluate(NIGHT_CONTRAST_AT));
  checkScrim("alertTakeoverNight", take);
  for (const k of ["headline", "caption"]) if (!(take[k].contrast >= 4.5)) results.errors.push(`alertTakeoverNight: ${k} contrast ${take[k].contrast} < 4.5`);
  if (take.since && (take.since.fontPx < 18 || take.since.contrast < 4.5)) results.errors.push(`alertTakeoverNight: since line ${take.since.fontPx}px, contrast ${take.since.contrast} (needs >= 18px and >= 4.5)`); else if (!take.since) results.errors.push("alertTakeoverNight: standing-for line missing");
  await context.close();
});
await guarded("overlays extra alert doorbell", async () => {
  const routes = { "/kiosk/api/attention": { status: "quiet" } };
  const { context, page } = await extraVisit(routes);
  const take = (results.overlays.extra.alertDoorbell = {});
  await raiseAlert(routes, page, ATTENTION_DOORBELL);
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 8000))) return void (take.missing = "takeover did not open for the doorbell alert");
  await settle(page, '[data-sr-overlay="takeover"] [data-sr-face], [data-sr-overlay="takeover"]');
  await page.screenshot({ path: join(OUT_DIR, "kiosk-alert-doorbell-1180x820.png") }); // state kiosk-alert-doorbell
  Object.assign(take, await page.evaluate(SCAN_AT, '[data-sr-overlay="takeover"]'), await page.evaluate(SCRIM_AT));
  checkScrim("alertDoorbell", take);
  await context.close();
});
// overlays.extra.stale.{alerts,downloads}: a failed re-poll after a good one keeps the data and adds ONE Stale tag (alerts: on the button; downloads: in the open tray).
// Keys: staleTags (must be 1), buttonCount (alerts: the count still shown), rows (downloads: rows still shown).
results.overlays.extra.stale = {};
await guarded("overlays extra stale", async () => {
  const { context, page } = await extraVisit({ "/kiosk/api/attention": ATTENTION_WARN, "/kiosk/api/downloads": downloads(2) });
  const out = results.overlays.extra.stale;
  await page.waitForTimeout(5500); // past SWR's 5 s focus throttle, first polls landed
  await page.route(/\/kiosk\/api\/(attention|downloads)$/, (route) => route.fulfill({ status: 500, json: { error: "down" } })); // registered last, so it wins
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(3000);
  const takeover = page.getByRole("status").filter({ hasText: "A container stopped" }).first();
  if (await takeover.count()) await takeover.click().catch(() => {}); // a tap dismisses it, so it cannot cover the buttons
  const alerts = page.getByRole("button", { name: /^\d+ alerts?\b/ });
  out.alerts = (await alerts.count()) ? { staleTags: await alerts.locator(".sr-stale").count(), buttonCount: (await alerts.first().innerText()).replace(/\D/g, "") } : { missing: "alerts button" };
  const dl = page.getByRole("button", { name: /^\d+ downloads? in progress/ });
  // Tray closed: the tag must not widen the alerts button or push it over the downloads button.
  if ((await alerts.count()) && (await dl.count())) {
    const m = await page.evaluate(() => {
      const q = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") ?? ""));
      const a = q(/^\d+ alerts?\b/), d = q(/^\d+ downloads? in progress/), tag = a?.querySelector(".sr-stale");
      const ar = a.getBoundingClientRect(), dr = d.getBoundingClientRect(), tr = tag?.getBoundingClientRect();
      return {
        alertsWidthPx: Math.round(ar.width),
        overlapPx: Math.max(0, Math.round(Math.min(ar.right, dr.right) - Math.max(ar.left, dr.left))),
        tagBelow: !!tr && tr.top >= ar.bottom - 0.5,
        clip: { x: Math.max(0, Math.min(ar.left, dr.left) - 24), y: Math.max(0, Math.min(ar.top, dr.top) - 24), width: Math.max(ar.right, dr.right) - Math.min(ar.left, dr.left) + 48, height: Math.max(tr ? tr.bottom : 0, ar.bottom, dr.bottom) - Math.min(ar.top, dr.top) + 48 },
      };
    });
    const { clip, ...nums } = m;
    Object.assign(out.alerts, nums);
    await page.screenshot({ path: join(OUT_DIR, "stale-alerts-button-1180x820.png"), clip });
  }
  if (!(await dl.count())) out.downloads = { missing: "downloads button" };
  else {
    await dl.click();
    await seen(page, '[role=dialog][aria-label="Downloads"]', 5000);
    await settle(page, '[role=dialog][aria-label="Downloads"]');
    out.downloads = await page.evaluate(() => {
      const tray = document.querySelector('[role=dialog][aria-label="Downloads"]');
      return { staleTags: tray?.querySelectorAll(".sr-stale").length ?? 0, rows: tray?.querySelectorAll("[tabindex]").length ?? 0 };
    });
    await page.screenshot({ path: join(OUT_DIR, "stale-downloads-tray-1180x820.png") });
  }
  await context.close();
});
// overlays.extra.downloadsOverlap.<size>: px² where the downloads button meets any forecast cell; must be 0.
results.overlays.extra.downloadsOverlap = {};
for (const size of SIZES) {
  await guarded(`downloads overlap ${size.name}`, async () => {
    const { context, page } = await extraVisit({ "/kiosk/api/downloads": downloads(1) }, size.viewport);
    await page.waitForSelector('[data-testid="kiosk-forecast-rail"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(6000); // first poll
    results.overlays.extra.downloadsOverlap[size.name] = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /downloads? in progress/.test(b.getAttribute("aria-label") ?? ""));
      const rail = document.querySelector('[data-testid="kiosk-forecast-rail"]');
      if (!btn || !rail) return { missing: !btn ? "downloads button" : "forecast rail" };
      const a = btn.getBoundingClientRect();
      let area = 0;
      for (const cell of rail.children) {
        const b = cell.getBoundingClientRect();
        area += Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      }
      return { area: Math.round(area) };
    });
    await context.close();
  });
}
await guarded("overlays extra downloads", async () => {
  const routes = { "/kiosk/api/downloads": downloads(1) };
  const { context, page } = await extraVisit(routes);
  const toast = (results.overlays.extra.downloadsToast = {});
  await page.waitForTimeout(5500); // past SWR's 5 s focus throttle, with the first poll adopted as history
  routes["/kiosk/api/downloads"] = downloads(2); // a newly started torrent is the toast's edge
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  if (!(await seen(page, "[role=status][data-sr-face]", 15_000))) toast.missing = "toast did not fire after a second download appeared";
  else {
    await settle(page, "[role=status][data-sr-face]");
    await page.screenshot({ path: join(OUT_DIR, "overlay-downloads-toast-1180x820.png") });
    Object.assign(toast, await page.evaluate(SCAN_AT, "[role=status][data-sr-face]"));
  }
  const tray = (results.overlays.extra.downloadsTray = {});
  const btn = page.getByRole("button", { name: /^\d+ downloads? in progress/ });
  if (!(await btn.count())) return void (tray.missing = "downloads button");
  await btn.click({ force: true }); // the toast may still sit over the corner
  if (!(await seen(page, '[role=dialog][aria-label="Downloads"]', 5000))) return void (tray.missing = "downloads tray");
  await settle(page, '[role=dialog][aria-label="Downloads"]');
  await page.screenshot({ path: join(OUT_DIR, "overlay-downloads-tray-1180x820.png") });
  Object.assign(tray, await page.evaluate(SCAN_AT, '[role=dialog][aria-label="Downloads"]'));
  await context.close();
});

// ---- rain zones: every visible control in the floor band (y >= 0.75h, where rings spawn) sits inside a [data-rain-zone] rect ----
const RAIN_ZONE_COVER = () => {
  const vis = (r) => r.width > 0 && r.height > 0;
  const zones = [...document.querySelectorAll("[data-rain-zone]")].map((el) => el.getBoundingClientRect()).filter(vis);
  const floor = innerHeight * 0.75;
  const inside = (r) => zones.some((z) => r.left >= z.left - 2 && r.top >= z.top - 2 && r.right <= z.right + 2 && r.bottom <= z.bottom + 2);
  return [...document.querySelectorAll('button, a, [role=button], [role=group][aria-label^="Now playing"], [aria-pressed]')]
    .filter((el) => !el.closest("[aria-hidden=true], nextjs-portal") && getComputedStyle(el).visibility !== "hidden")
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => vis(r) && r.bottom > floor)
    .filter(({ r }) => !inside(r))
    .map(({ el, r }) => `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
};
results.rainZoneCover = {};
for (const name of Object.keys(RAIN_STATES)) {
  await guarded(`rain ${name}`, async () => {
    const { context, page } = await visit(`${BASE_URL}/kiosk?theme=sunroom`, {
      viewport: { width: 1280, height: 800 },
      weather: rainWeatherFor(name),
      fixedTime: true,
      ha: true,
      nowPlaying: true,
      rain: true,
      reduced: !!RAIN_STATES[name].reduced,
    });
    await seen(page, '[data-rain-zone="playing"]', 15_000);
    await page.waitForTimeout(RAIN_STATES[name].day ? 4000 : 2500); // rects are re-read once a second; let the rings fill the floor (a day ring lives 0.9 s: about 13 alive by then)
    await page.screenshot({ path: join(OUT_DIR, `rain-${name}-full.png`) });
    await page.screenshot({ path: join(OUT_DIR, `rain-${name}-floor.png`), clip: { x: 0, y: 700, width: 1280, height: 100 } });
    // Day states: a padded crop of the whole ring band (0.75H = y 600) so the slate rings and crests read at pixel size.
    if (RAIN_STATES[name].day) await page.screenshot({ path: join(OUT_DIR, `rain-${name}-floor-pad.png`), clip: { x: 0, y: 560, width: 1280, height: 240 } });
    results.rainZoneCover[name] = await page.evaluate(RAIN_ZONE_COVER);
    await context.close();
  });
}

// ---- ambient and data (PR 4): N11/N12/N17/N18 on the glance main, a stale pane, now playing, a carousel page change; main at midday and night ----
// results.ambient.<state>: { n11Small, n12LiveTransitions, n18ToneWithoutWord } from CONTROLS, plus the state's own counts.
// Shots: ambient-<state>-<size>.png. Shoot after .sr-stopfade has gone (visit() waits for it).
results.ambient = {};
const AMBIENT_CHECKS = (page) => page.evaluate(CONTROLS);
for (const size of SIZES) {
  for (const stop of ["midday", "night"]) {
    await guarded(`ambient main ${stop} ${size.name}`, async () => {
      const { context, page } = await visit(STOP_URL, { viewport: size.viewport, weather: weatherFor(stop), fixedTime: true });
      await page.screenshot({ path: join(OUT_DIR, `ambient-main-${stop}-${size.name}.png`), fullPage: true });
      results.ambient[`main-${stop}-${size.name}`] = await AMBIENT_CHECKS(page);
      await context.close();
    });
  }
}
// ambient.radarGap: px from the radar button's right edge to the first forecast cell's left edge in the standard layout; must be >= 16
results.ambient.radarGap = {};
for (const size of SIZES) {
  await guarded(`ambient radarGap ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
    results.ambient.radarGap[size.name] = await page.evaluate(() => {
      const b = document.querySelector("[data-sr-radar]")?.getBoundingClientRect();
      const c = document.querySelector(".sr-fc")?.getBoundingClientRect();
      return b && c ? Math.round((c.left - b.right) * 10) / 10 : null;
    });
    await context.close();
  });
}
// pq3.radarHit: the radar button keeps its 32 px ring but presses at >= 44x44 (elementFromPoint 6 px outside each corner
// still lands on the button; 8 px outside does not), its glyph stays 15 px, and the forecast row height is recorded
results.pq3 = {};
for (const theme of ["sunroom", "terminal"]) {
  const size = SIZES[1];
  await guarded(`pq3 radarHit ${theme}`, async () => {
    const { context, page } = await visit(CONTROLS_URL.replace("theme=sunroom", `theme=${theme}`), { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
    results.pq3[theme] = await page.evaluate(() => {
      const b = document.querySelector("[data-sr-radar]");
      const r = b.getBoundingClientRect();
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
      const svg = b.querySelector("svg").getBoundingClientRect();
      const rail = document.querySelector('[data-testid="kiosk-forecast-rail"]').getBoundingClientRect();
      const cell = document.querySelector(".sr-fc")?.getBoundingClientRect();
      return {
        ring: [r.width, r.height],
        hit6: [hit(r.left - 5, r.top - 5), hit(r.right + 5, r.bottom + 5)].every(Boolean),
        miss8: !hit(r.left - 7, r.top - 7),
        hitBox: hit(r.left - 5, r.top - 5) && hit(r.right + 5, r.bottom + 5) ? [r.width + 12, r.height + 12] : [r.width, r.height],
        glyph: [svg.width, svg.height],
        railHeight: rail.height,
        cellHeight: cell?.height ?? null,
        clip: { x: Math.max(0, r.left - 16), y: Math.max(0, r.top - 16), width: 360, height: Math.max(rail.height, r.height) + 32 },
      };
    });
    const m = results.pq3[theme];
    await page.screenshot({ path: join(OUT_DIR, `pq3-radar-row-${theme}-1024x768.png`), clip: m.clip });
    await page.screenshot({ path: join(OUT_DIR, `pq3-full-${theme}-1024x768.png`), fullPage: true });
    await context.close();
  });
}
// main at rest after a 10 s idle (N17: nothing animates), glance is the default layout
await guarded("ambient rest", async () => {
  const { context, page } = await visit(MAIN_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true });
  await page.waitForTimeout(10_000);
  await page.screenshot({ path: join(OUT_DIR, "ambient-rest-1180x820.png"), fullPage: true });
  results.ambient.rest = { ...(await AMBIENT_CHECKS(page)), n17Running: (await page.evaluate(SCAN)).running };
  await context.close();
});
// a stale weather pane: the first poll answers, the next says unreachable, so the view keeps the last good data and shows the tag
await guarded("ambient stale", async () => {
  // fixedTime "ticking": midday, but Date.now() advances (setFixedTime never does, and the real 2 am clock shows the night overlay). no ?wx=: every preset, wx=off included, replaces the weather with a fresh ok payload (WX_PRESETS), which would mask the mocked outage.
  const { context, page, state } = await visit(SA_STALE_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: "ticking" });
  state.weather = { status: "unreachable", detail: "mocked outage" };
  await page.clock.fastForward(6000); // SWR ignores focus for 5 s after mount
  let tag = false;
  for (let k = 0; k < 4 && !tag; k++) {
    await page.clock.fastForward(6000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    tag = await seen(page, ".sr-stale", 3000);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, "ambient-stale-1180x820.png") });
  results.ambient.stale = { ...(await AMBIENT_CHECKS(page)), tagSeen: tag, tagCount: await page.locator(".sr-stale").count(), tagText: await page.locator(".sr-stale").first().textContent().catch(() => null) };
  await context.close();
  if (!tag) throw new Error("the stale tag never showed (.sr-stale)"); // lands in results.errors via guarded
});
// now playing: the pill carries a pip and the word, no icon
await guarded("ambient now playing", async () => {
  const { context, page } = await visit(MAIN_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true, nowPlaying: true });
  const np = await seen(page, "[data-sr-np]", 15_000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT_DIR, "ambient-nowplaying-1180x820.png") });
  results.ambient.nowPlaying = { ...(await AMBIENT_CHECKS(page)), seen: np, word: await page.locator("[data-sr-np] .sr-state").first().textContent().catch(() => null), pip: await page.locator("[data-sr-np] .sr-pip").count() };
  await context.close();
});
// a carousel page change: tap the second dot; the 24x8 pill slides 44 px (transform only). pillOffset = pill centre minus the current dot's centre, before and after; each within 1 px
const pillOffset = (page, idx) => page.evaluate((n) => {
  const p = document.querySelector(".sr-dots-pill")?.getBoundingClientRect();
  const d = document.querySelectorAll('button[aria-label^="Show "] > span')[n]?.getBoundingClientRect();
  if (!p || !d) return null;
  return { dx: +((p.left + p.width / 2) - (d.left + d.width / 2)).toFixed(2), dy: +((p.top + p.height / 2) - (d.top + d.height / 2)).toFixed(2) };
}, idx);
for (const size of SIZES) {
  await guarded(`ambient carousel ${size.name}`, async () => {
    const key = size.name === "1024x768" ? "carousel" : `carousel-${size.name}`;
    const { context, page } = await visit(MAIN_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true });
    const pill = page.locator(".sr-dots-pill").first();
    const has = await seen(page, ".sr-dots-pill", 15_000);
    const dot = page.locator('button[aria-label^="Show "]').nth(1);
    if (!has || !(await dot.count())) {
      results.ambient[key] = { missing: has ? "second dot" : ".sr-dots-pill" };
      await context.close();
      return;
    }
    const before = await pill.evaluate((el) => el.style.transform);
    const offBefore = await pillOffset(page, 0);
    await page.screenshot({ path: join(OUT_DIR, `ambient-carousel-before-${size.name}.png`) });
    await dot.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT_DIR, `ambient-carousel-after-${size.name}.png`) });
    const offAfter = await pillOffset(page, 1);
    const ok = (o) => !!o && Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 1;
    results.ambient[key] = { ...(await AMBIENT_CHECKS(page)), before, after: await pill.evaluate((el) => el.style.transform), pillBox: await pill.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }), pillOffset: { before: offBefore, after: offAfter, within1px: ok(offBefore) && ok(offAfter) } };
    await context.close();
  });
}

// ---- kiosk polish round (P1-P7): numeric checks at ?theme=sunroom&wx=overcast&wxsun=day (MAIN_URL); P4 also at the night stop ----
// results.polish.<key>. P1 on the glance main, containers page (capture polish-containers-<size>.png; ambient-carousel-after covers the second page).
// P3 on ambient-nowplaying-1180x820. P4 on ambient-main-midday/night-<size>. P5, P6 and P7 on controls-rest-<size> (standard layout).
results.polish = {};
await guarded("polish P1 containers page", async () => {
  const { context, page } = await visit(MAIN_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true });
  const dot = page.locator('button[aria-label="Show Containers"]');
  if (!(await seen(page, ".sr-dots-pill", 15_000)) || !(await dot.count())) results.polish.p1 = { missing: "Containers dot" };
  else {
    await dot.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT_DIR, "polish-containers-1180x820.png") });
    // innerText skips visibility:hidden, so this counts what a person can read
    results.polish.p1 = { runningCount: await page.evaluate(() => (document.body.innerText.match(/\brunning\b/g) ?? []).length) }; // must be 1
  }
  await context.close();
});
await guarded("polish P3 progress inset", async () => {
  const { context, page } = await visit(MAIN_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: true, nowPlaying: true });
  if (!(await seen(page, "[data-sr-np-progress]", 15_000))) results.polish.p3 = { missing: "[data-sr-np-progress]" };
  else {
    // layout offsets, not the rect: the bar is scaleX-ed
    results.polish.p3 = await page.evaluate(() => {
      const b = document.querySelector("[data-sr-np-progress]");
      const p = b.offsetParent;
      return { left: b.offsetLeft, right: p.clientWidth - b.offsetLeft - b.offsetWidth, bottom: p.clientHeight - b.offsetTop - b.offsetHeight, radius: getComputedStyle(b).borderBottomLeftRadius }; // left, right, bottom >= 2
    });
  }
  await context.close();
});
for (const size of SIZES) {
  for (const stop of ["midday", "night"]) {
    await guarded(`polish P4 ${stop} ${size.name}`, async () => {
      const { context, page } = await visit(STOP_URL, { viewport: size.viewport, weather: weatherFor(stop), fixedTime: stop === "midday" });
      results.polish[`p4-${stop}-${size.name}`] = await page.evaluate(() =>
        [...document.querySelectorAll("[data-sr-admin]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { fontPx: parseFloat(getComputedStyle(el).fontSize), w: Math.round(r.width), h: Math.round(r.height) }; // fontPx >= 15, w and h >= 44
        }));
      await context.close();
    });
  }
}
for (const size of SIZES) {
  await guarded(`polish P5 P6 P7 ${size.name}`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: size.viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
    if (!(await seen(page, ".sr-climate", 15_000))) results.polish[`controls-${size.name}`] = { missing: ".sr-climate" };
    else {
      await settleRest(page);
      results.polish[`controls-${size.name}`] = await page.evaluate(() => {
        const out = {};
        const pill = document.querySelector('button[aria-label^="AC auto-off"]');
        if (pill) {
          const r = pill.getBoundingClientRect();
          const row = pill.parentElement.getBoundingClientRect();
          const grid = document.querySelector(".sr-climate").parentElement.getBoundingClientRect();
          // right <= vw - 20; the pill's centre sits inside the CLIMATE header row; right matches the tile grid's right edge
          out.p5 = { right: +r.right.toFixed(1), limit: innerWidth - 20, gridRight: +grid.right.toFixed(1), centreInRow: r.top + r.height / 2 >= row.top && r.top + r.height / 2 <= row.bottom, top: +r.top.toFixed(1), rowTop: +row.top.toFixed(1), rowBottom: +row.bottom.toFixed(1) };
        } else out.p5 = { missing: "auto-off pill" };
        const study = [...document.querySelectorAll(".sr-climate-name")].find((n) => /Study/.test(n.textContent ?? ""));
        const nm = study?.firstElementChild;
        out.p6 = nm ? { scrollWidth: nm.scrollWidth, clientWidth: nm.clientWidth } : { missing: "Study name" }; // scrollWidth <= clientWidth
        out.p7 = [...document.querySelectorAll('button.sr-chip[role="switch"][aria-checked="true"]')].map((c) => c.querySelectorAll(".sr-pip, .dot").length); // each must be 1
        return out;
      });
      await page.screenshot({ path: join(OUT_DIR, `polish-controls-${size.name}.png`) });
    }
    await context.close();
  });
}

// ---- kiosk UV and air: N1-N8 (glance pane `sun-air` and the Standard inline) ----
// results.sunAir.{N1..N11}: true | false (each needs every one of its entries; a missing entry fails it), results.sunAir.entries.<Nx>[] the numbers,
// results.sunAir.states.<state>-<size> (glance) and .std.<state>-<size> (Standard), results.sunAir.failed[] (why, one line each).
// Shots: sunair-<state>-<size>.png (the band and its dots) and sunair-std-<state>-<size>.png (the weather line). The run exits 1 when any N is false.
// The URLs keep ?wx=overcast: applyWxPreview must keep uv and air, or every pane check below fails on an empty pane (a dropped field shows as `want` missing).
const SA = (results.sunAir = { entries: {}, states: {}, std: {}, failed: [] });
const NS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11"];
for (const n of NS) SA.entries[n] = [];
const saRecord = (n, key, ok, detail) => { SA.entries[n].push({ key, ok, ...detail }); if (!ok) SA.failed.push(`${n} ${key} ${JSON.stringify(detail)}`); };
const saRun = (name, fn) => guarded(`sunAir ${name}`, async () => { try { await fn(); } catch (e) { SA.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const textHas = (text, want = [], not = []) => ({ missing: want.filter((w) => !text.includes(w)), present: not.filter((w) => text.includes(w)) });

/** The pane's measurements: N1 (height in the band), N2 (width, no clipped word), N3 (figure size = the rail's), N4 (type floor), N5 (dots = panes). */
const SUN_AIR_PANE = () => {
  const root = document.querySelector("[data-sun-air]");
  const track = document.querySelector("div.relative.w-full.overflow-hidden > div.flex.h-full.w-full");
  const panes = track ? [...track.children].filter((c) => !/200%/.test(c.style.transform)).length : null;
  const dots = document.querySelectorAll('button[aria-label^="Show "]').length;
  if (!root) return { present: false, panes, dots };
  const band = root.closest(".overflow-hidden").getBoundingClientRect();
  const r = root.getBoundingClientRect();
  const probe = Object.assign(document.createElement("span"), { className: "text-xl" });
  root.append(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  const visible = [...root.querySelectorAll("[aria-hidden]")];
  const small = [];
  const clipped = [];
  for (const el of visible.flatMap((v) => [v, ...v.querySelectorAll("*")])) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) clipped.push(el.textContent.trim().slice(0, 30));
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !el.closest(".microlabel, .sr-stale") && parseFloat(getComputedStyle(el).fontSize) < floor - 0.01) small.push(`${el.textContent.trim().slice(0, 20)} ${getComputedStyle(el).fontSize}`);
  }
  // N9-N11 (worst state): each column's text boxes against the column's centre, the band word's colour against the pane's ink token, one baseline for the UV figure and the air word
  const mid = (b) => (b.left + b.right) / 2;
  const rowMid = (el) => { const k = [...el.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0); return k.length ? (Math.min(...k.map((b) => b.left)) + Math.max(...k.map((b) => b.right))) / 2 : null; };
  const textMid = (el) => { const g = document.createRange(); g.selectNodeContents(el); return mid(g.getBoundingClientRect()); };
  const cols = [...root.querySelectorAll("[data-sun-col]")].map((col) => {
    const [cap, row, sub] = [...col.children];
    return { col: col.dataset.sunCol, centre: mid(col.getBoundingClientRect()), caption: rowMid(cap), row: rowMid(row), sub: textMid(sub) };
  });
  const inkProbe = Object.assign(document.createElement("span"), { className: "text-ink", textContent: "x" });
  root.append(inkProbe);
  const ink = getComputedStyle(inkProbe).color;
  inkProbe.remove();
  const colourOf = (sel) => { const e = root.querySelector(sel); return e ? getComputedStyle(e).color : null; };
  // a zero-size inline-block sits on its line's baseline: its bottom is that baseline
  const baselineOf = (sel) => {
    const e = root.querySelector(sel);
    if (!e) return null;
    const p = Object.assign(document.createElement("span"), { style: "display:inline-block;width:0;height:0" });
    e.append(p);
    const y = p.getBoundingClientRect().bottom;
    p.remove();
    return y;
  };
  const tone = { ink, band: colourOf("[data-sun-band]"), figure: colourOf("[data-sun-figure]"), air: colourOf("[data-sun-air-word]") };
  const baseline = { figure: baselineOf("[data-sun-figure]"), air: baselineOf("[data-sun-air-word]") };
  const fig = root.querySelector("[data-sun-figure]");
  const railHi = document.querySelector('[data-testid="kiosk-forecast-rail"] .sr-fc-hi');
  return {
    present: true, panes, dots, cols, tone, baseline,
    text: visible.map((v) => v.textContent).join(" | "),
    bandH: Math.round(band.height * 10) / 10, paneH: Math.round(r.height * 10) / 10,
    bandW: Math.round(band.width * 10) / 10, paneW: Math.round(r.width * 10) / 10,
    clipped, small, floor,
    figurePx: fig ? parseFloat(getComputedStyle(fig).fontSize) : null,
    railPx: railHi ? parseFloat(getComputedStyle(railHi).fontSize) : null,
    staleTags: root.querySelectorAll(".sr-stale").length,
    staleInCaption: [...root.querySelectorAll(".sr-stale")].filter((t) => t.parentElement?.querySelector(":scope > .microlabel")).length,
    clip: { x: Math.max(0, band.left - 8), y: Math.max(0, band.top - 8), width: band.width + 16, height: band.height + 52 },
  };
};

const SA_STALE_STATE = "stale";
for (const size of SIZES) {
  for (const state of Object.keys(SUN_AIR_STATES)) {
    const key = `${state}-${size.name}`;
    await saRun(`glance ${key}`, async () => {
      const def = SUN_AIR_STATES[state];
      const stale = state === SA_STALE_STATE;
      // stale needs an outage after a good poll, which any ?wx= preset (wx=off included) would paper over: no ?wx=, the real fixture days (sunset 19:42)
      const { context, page, state: st } = await visit(stale ? SA_STALE_URL : MAIN_URL, { viewport: size.viewport, weather: sunAirWeatherFor(state), fixedTime: stale ? "ticking" : true, instant: sunAirInstant(state) });
      if (stale) {
        st.weather = { status: "unreachable", detail: "mocked outage" };
        await page.clock.fastForward(6000);
        for (let k = 0; k < 4 && !(await seen(page, "[data-sun-air] .sr-stale", 3000)); k++) {
          await page.clock.fastForward(6000);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        }
      }
      const m = await page.evaluate(SUN_AIR_PANE);
      SA.states[key] = m;
      if (def.quiet) {
        saRecord("N5", key, !m.present && m.panes === m.dots, { present: m.present, panes: m.panes, dots: m.dots, expect: "no pane, dots equal panes" });
        await context.close();
        return;
      }
      const t = textHas(m.text ?? "", def.want, def.not);
      saRecord("N5", key, m.present && t.missing.length === 0 && t.present.length === 0 && m.panes === m.dots, { present: m.present, panes: m.panes, dots: m.dots, ...t });
      if (m.present) {
        if (["ordinary", "crowded", "stale", "worst"].includes(state)) saRecord("N1", key, m.paneH <= m.bandH, { paneH: m.paneH, bandH: m.bandH });
        saRecord("N2", key, m.paneW <= m.bandW + 0.5 && m.clipped.length === 0, { paneW: m.paneW, bandW: m.bandW, clipped: m.clipped });
        if (def.uv) saRecord("N3", key, m.figurePx !== null && m.figurePx === m.railPx, { figurePx: m.figurePx, railPx: m.railPx }); // no figure on an air-only pane
        if (state === "worst") {
          const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1; // 1 px rounding tolerance
          saRecord("N9", key, m.cols.length === 2 && m.cols.every((c) => near(c.caption, c.centre) && near(c.row, c.centre) && near(c.sub, c.centre)), { cols: m.cols });
          saRecord("N10", key, m.tone.band === m.tone.ink && m.tone.band !== m.tone.figure && m.tone.band !== m.tone.air, m.tone);
          saRecord("N11", key, near(m.baseline.figure, m.baseline.air), m.baseline); // zero-size baseline probes in both spans, not line-box bottoms
        }
        saRecord("N4", key, m.small.length === 0, { floor: m.floor, small: m.small });
        if (stale) saRecord("N5", `${key} one stale tag`, m.staleTags === 1 && m.staleInCaption === 1, { staleTags: m.staleTags, staleInCaption: m.staleInCaption });
        await page.locator('button[aria-label="Show UV and air"]').first().click().catch(() => {});
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(OUT_DIR, `sunair-${key}.png`), clip: m.clip });
      }
      await context.close();
    });
  }
}

/** Standard: the weather line (day, evening) or the datum row (morning). N6 sizes against the same moment without UV or air; N8 no item overlaps another. */
const STD_LINE = () => {
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? null;
  const line = document.querySelector("[data-weather-line]");
  const datums = document.querySelector("[data-weather-datums]");
  const el = line ?? datums;
  if (!el) return { present: false, header };
  const kids = [...el.children].map((c) => c.getBoundingClientRect());
  const overlaps = [];
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const w = Math.min(kids[i].right, kids[j].right) - Math.max(kids[i].left, kids[j].left);
      const h = Math.min(kids[i].bottom, kids[j].bottom) - Math.max(kids[i].top, kids[j].top);
      if (w > 0.5 && h > 0.5) overlaps.push([i, j]);
    }
  }
  const r = el.getBoundingClientRect();
  return { present: true, kind: line ? "line" : "datums", header, h: Math.round(r.height * 10) / 10, rowTops: [...new Set(kids.map((k) => Math.round(k.top)))].length, firstTop: kids[0] && Math.round(kids[0].top), lastTop: kids.length ? Math.round(kids[kids.length - 1].top) : null, overlaps, text: el.textContent, clip: { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 } };
};
for (const size of SIZES) {
  for (const state of Object.keys(SUN_AIR_STD)) {
    const key = `${state}-${size.name}`;
    if (size.name !== SIZES[1].name && !["ordinary", "crowded", "worst", "morning"].includes(state)) continue; // 1024 is the tight width; 1180 covers the main four
    await saRun(`standard ${key}`, async () => {
      const at = sunAirInstant(state);
      const withIt = await visit(CONTROLS_URL, { viewport: size.viewport, weather: sunAirWeatherFor(state), fixedTime: true, instant: at });
      const a = await withIt.page.evaluate(STD_LINE);
      await withIt.page.screenshot({ path: join(OUT_DIR, `sunair-std-${key}.png`), clip: a.clip });
      await withIt.context.close();
      const baseIt = await visit(CONTROLS_URL, { viewport: size.viewport, weather: sunAirWeatherFor(state, { base: true }), fixedTime: true, instant: at });
      const b = await baseIt.page.evaluate(STD_LINE);
      await baseIt.context.close();
      SA.std[key] = { with: a, base: b };
      const w = SUN_AIR_STD[state];
      const t = textHas(a.text ?? "", w.want, w.not);
      saRecord("N6", `${key} text`, a.present && t.missing.length === 0 && t.present.length === 0, t);
      if (a.present && b.present) {
        if (a.kind === "line") {
          const grew = Math.round((a.h - b.h) * 10) / 10;
          // 0 rows, or one `text-sm` line plus `gap-y-1.5` (about 20 + 6 px)
          saRecord("N6", `${key} line`, (grew === 0 || (grew >= 20 && grew <= 30)) && a.header === b.header, { grewPx: grew, headerWith: a.header, headerBase: b.header });
        } else {
          saRecord("N6", `${key} datums`, a.rowTops === b.rowTops && a.firstTop === a.lastTop && a.header === b.header, { rowTopsWith: a.rowTops, rowTopsBase: b.rowTops, firstTop: a.firstTop, lastTop: a.lastTop, headerWith: a.header, headerBase: b.header });
        }
        saRecord("N8", key, a.overlaps.length === 0, { overlaps: a.overlaps });
      }
    });
  }
}

// N7 runs in node (no page): warn and bad on bg, panel and panel-2 in every theme and sunroom stop
await saRun("N7 contrast", async () => {
  const c = await uvContrast();
  saRecord("N7", "contrast", c.pass && c.unresolved.length === 0, { checked: c.checked, lowest: c.lowest, failures: c.failures, unresolved: c.unresolved });
});

// every N needs its entries: N1 4 states x 2 sizes, N2-N5 each pane state x size (N3 not air-only), N6 and N8 the Standard states (1024 all 11, 1180 four), N7 one
const NEED = { N1: 8, N2: 22, N3: 20, N4: 22, N5: 22, N6: 30, N7: 1, N8: 15, N9: 2, N10: 2, N11: 2 }; // N9-N11: the worst state at both sizes
for (const n of NS) {
  const e = SA.entries[n];
  SA[n] = e.length >= NEED[n] && e.every((x) => x.ok);
  if (e.length < NEED[n]) SA.failed.push(`${n} has ${e.length} entries, needs ${NEED[n]}`);
}
if (SA.failed.length) process.exitCode = 1;

// ---- kiosk shared list: numeric checks L1-L16 (plan "Numeric checks" 1-14, fix round 1: L15 the full list fits, L16 long names) and the capture states ----
// results.lists.{L1..L14}: true | false (each needs its entries; a missing entry fails it), results.lists.entries.<Lx>[] the numbers,
// results.lists.states.<state> {ok, missing[], present[]} (every state first asserts its own defining text), results.lists.registry (test 25),
// results.lists.failed[] (one line each). Shots: list-<state>-<size>.png. The run exits 1 when any L is false or any state or registry check fails.
// Writes are answered by listFake (per-state `cfg`): it applies add/done/clear to cfg.body and does not re-implement dedupe or the cap; a state that
// needs another answer sets cfg.post.<action> = {status, json} | "abort". Only placeholder PIN digits are typed, and /api/auth/kiosk is mocked.
const LS = (results.lists = { entries: {}, states: {}, registry: {}, failed: [] });
const LNS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12", "L13", "L14", "L15", "L16", "L17"];
for (const n of LNS) LS.entries[n] = [];
const lRecord = (n, key, ok, detail = {}) => { LS.entries[n].push({ key, ok, ...detail }); if (!ok) LS.failed.push(`${n} ${key} ${JSON.stringify(detail)}`); };
const lRun = (name, fn) => guarded(`lists ${name}`, async () => { try { await fn(); } catch (e) { LS.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
/** A state's defining text must be present (and `not` absent); a miss is a failure, never a skip. */
// innerText applies text-transform, so the uppercase microlabels ("Often added", "Ticked", "Stale") only match with case folded.
const lWant = (name, text, want = [], not = []) => {
  const low = text.toLowerCase();
  const t = { missing: want.filter((w) => !low.includes(w.toLowerCase())), present: not.filter((w) => low.includes(w.toLowerCase())) };
  const ok = t.missing.length === 0 && t.present.length === 0;
  LS.states[name] = { ok, ...t };
  if (!ok) LS.failed.push(`state ${name} ${JSON.stringify(t)}`);
  return ok;
};
const LIST_RE = /\/kiosk\/api\/list(\/|\?|$)/;
const SHEET = "[data-list-sheet]";
const L_STD = CONTROLS_URL; // the header button only renders in the pinned standard layout
const L_SIZE = SIZES[1]; // 1024x768 is the sheet's reference size (design rule 16)
const ELEVATION_MS = 120_000;

function listFake(cfg) {
  return async (route) => {
    try {
      const req = route.request();
      if (req.method() === "GET") {
        if (cfg.hold) await cfg.hold;
        cfg.gets = (cfg.gets ?? 0) + 1;
        const status = typeof cfg.getStatus === "function" ? cfg.getStatus(cfg.gets) : (cfg.getStatus ?? 200);
        return await (status >= 400 ? route.fulfill({ status, json: { error: "store" } }) : route.fulfill({ json: cfg.body }));
      }
      const action = new URL(req.url()).pathname.split("/").pop();
      const b = req.postDataJSON() ?? {};
      (cfg.posts ??= []).push({ action, body: b });
      const o = cfg.post?.[action];
      if (o === "abort") return await route.abort("internetdisconnected");
      if (o) return await route.fulfill({ status: o.status, json: o.json ?? {} });
      const items = cfg.body.items;
      const set = (next) => { cfg.body = { ...cfg.body, items: next }; };
      if (action === "add") {
        const item = { id: b.id, listId: "shopping", text: b.text, done: false, createdAt: Date.now(), doneAt: null, updatedAt: Date.now() };
        set([item, ...items]);
        return await route.fulfill({ json: { result: "added", item } });
      }
      if (action === "done") {
        const item = items.find((i) => i.id === b.id);
        if (!item) return await route.fulfill({ status: 404, json: { error: "missing" } });
        const next = { ...item, done: b.done, doneAt: b.done ? Date.now() : null };
        set(items.map((i) => (i.id === b.id ? next : i)));
        return await route.fulfill({ json: { item: next } });
      }
      if (action === "clear-ticked" || action === "clear-all") {
        if (action === "clear-all" && !cfg.elevated) return await route.fulfill({ status: 403, json: { error: "elevation" } });
        const removed = items.filter((i) => action === "clear-all" || i.done);
        cfg.removed = removed;
        set(items.filter((i) => !removed.includes(i)));
        return await route.fulfill({ json: { removed } });
      }
      if (action === "restore") {
        const back = (cfg.removed ?? []).filter((i) => b.ids?.includes(i.id));
        set([...items, ...back]);
        return await route.fulfill({ json: { restored: back, skipped: [] } });
      }
      return await route.fulfill({ status: 404, json: { error: "unknown_action" } });
    } catch {
      // the page closed while a held answer was still pending: nothing left to answer
    }
  };
}

/** Opens one list page: the list fake and the PIN mocks are registered before the first request, on a moving clock (SWR dedupe reads Date.now)
 *  that starts at the pinned instant: on the real clock a run after 22:00 met the night overlay and could not press the list button. */
async function listVisit(cfg, { url = L_STD, size = L_SIZE, ...o } = {}) {
  cfg.body ??= LIST_EMPTY;
  return visit(url, {
    viewport: size.viewport, weather: weatherFor("midday"), fixedTime: "flow", ...o,
    setup: async (page) => {
      await page.route(LIST_RE, listFake(cfg));
      await page.route("**/api/auth/kiosk", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        cfg.elevated = true;
        return route.fulfill({ json: { ok: true, expiresAt: Date.now() + ELEVATION_MS } });
      });
      await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: cfg.elevated ? { elevated: true, expiresAt: Date.now() + ELEVATION_MS } : { elevated: false } }));
    },
  });
}
async function withList(name, cfg, opts, fn) {
  await lRun(name, async () => {
    const v = await listVisit(cfg, opts);
    try { await fn(v); } finally { await v.context.close(); }
  });
}
const lButton = (page) => page.locator('button[aria-label^="Shopping list"]').first();
async function openSheet(page) {
  await lButton(page).click();
  await seen(page, SHEET, 5000);
  await page.waitForTimeout(700);
}
/** The sheet's visible text plus its input placeholders (a placeholder is not in innerText). */
const sheetText = (page) => page.locator(SHEET).evaluate((el) => [el.innerText, ...[...el.querySelectorAll("input")].map((i) => i.placeholder)].join("\n"));
const lShot = async (page, name, locator) => {
  const b = await locator.boundingBox();
  if (b) await page.screenshot({ path: join(OUT_DIR, `list-${name}.png`), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 } });
};
const typeAdd = async (page, text) => {
  await page.locator(`${SHEET} input`).fill(text);
  await page.locator(SHEET).getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(500);
};
const enterPin = async (page) => { for (const d of "0000") await page.getByRole("button", { name: `digit ${d}` }).click(); await page.waitForTimeout(900); };
const lQueue = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("kiosk-list-queue") ?? "[]"));

/** The glance pane's measurements: L1 (size, type floor), L10 (alignment), L11 (one stale tag in the caption), and the dot count. */
const LIST_PANE = () => {
  const root = document.querySelector("[data-lists-pane]");
  const track = document.querySelector("div.relative.w-full.overflow-hidden > div.flex.h-full.w-full");
  const panes = track ? [...track.children].filter((c) => !/200%/.test(c.style.transform)).length : null;
  const dots = document.querySelectorAll('button[aria-label^="Show "]').length;
  if (!root) return { present: false, panes, dots };
  const band = root.closest(".overflow-hidden").getBoundingClientRect();
  const carousel = root.parentElement.closest(".max-w-xl");
  const r = root.getBoundingClientRect();
  const cap = root.querySelector(".microlabel");
  const body = root.querySelector("[data-lists-body]");
  const cs = getComputedStyle(body);
  const probe = Object.assign(document.createElement("span"), { className: "text-xl" });
  root.append(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  const small = [];
  for (const el of [...root.querySelectorAll("[aria-hidden]")].flatMap((v) => [v, ...v.querySelectorAll("*")])) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !el.closest(".microlabel, .sr-stale") && parseFloat(getComputedStyle(el).fontSize) < floor - 0.01) small.push(`${el.textContent.trim().slice(0, 20)} ${getComputedStyle(el).fontSize}`);
  }
  const bb = body.getBoundingClientRect();
  return {
    present: true, panes, dots,
    text: [...root.querySelectorAll("[aria-hidden]")].map((v) => v.textContent).join(" | "),
    paneH: Math.round(r.height * 10) / 10, bandH: Math.round(band.height * 10) / 10, paneW: Math.round(r.width * 10) / 10, carouselW: Math.round(carousel.getBoundingClientRect().width * 10) / 10,
    bodyH: Math.round(bb.height * 10) / 10, lineH: parseFloat(cs.lineHeight), floor, small,
    capLeft: cap.getBoundingClientRect().left, bodyLeft: bb.left, textAlign: cs.textAlign,
    staleTags: root.querySelectorAll(".sr-stale").length, staleInCaption: [...root.querySelectorAll(".sr-stale")].filter((t) => t.parentElement?.querySelector(":scope > .microlabel")).length,
    clip: { x: Math.max(0, band.left - 8), y: Math.max(0, band.top - 8), width: band.width + 16, height: band.height + 52 },
  };
};

/** The sheet's measurements: L3 (no scroll, inside the scrim, rows = items), L4 (>= 44 px, row widths), L5 (chips), L6 (field position), L10 (left edges), L13 (focus). */
const LIST_SHEET = () => {
  const dlg = document.querySelector("[data-list-sheet]");
  if (!dlg) return { present: false };
  const r = (e) => e.getBoundingClientRect();
  const px = (v) => Math.round(v * 10) / 10;
  const scrim = dlg.parentElement;
  const scroll = [dlg, ...dlg.querySelectorAll("*")].filter((e) => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1).map((e) => `${e.tagName.toLowerCase()}${e.hasAttribute("data-sr-sheet-body") ? "[body]" : ""}`);
  const rows = [...dlg.querySelectorAll("[role=checkbox]")];
  const controls = [...dlg.querySelectorAll("button, input")];
  const small = controls.filter((c) => r(c).height < 43.5).map((c) => `${c.getAttribute("aria-label") ?? c.textContent.trim().slice(0, 16)} ${px(r(c).height)}`);
  const header = dlg.querySelector(".border-b");
  const field = dlg.querySelector("input");
  const chipRow = dlg.querySelector("[data-list-chips]");
  const chips = chipRow ? [...chipRow.children] : [];
  const gap = parseFloat(getComputedStyle(dlg).rowGap);
  const group = rows[0]?.closest("[role=group]");
  const gridW = group ? r(group).width : 0;
  const lefts = [...new Set(rows.map((x) => Math.round(r(x).left)))];
  const wraps = rows.map((x) => r(x.parentElement).width);
  const a = document.activeElement;
  const as = a ? getComputedStyle(a) : null;
  const sp = scrim ? parseFloat(getComputedStyle(scrim).paddingTop) : 24;
  return {
    present: true, scroll, rowCount: rows.length, small,
    panelTop: px(r(dlg).top), panelBottom: px(r(dlg).bottom), scrimPad: sp, vh: innerHeight,
    fieldGap: field && header ? px(r(field).top - r(header).bottom) : null, panelGap: gap,
    chipCount: chips.length, chipTops: [...new Set(chips.map((c) => Math.round(r(c).top)))].length, chipH: chips.length ? px(r(chips[0]).height) : null,
    gridW: px(gridW), rowWraps: [...new Set(wraps.map(px))], lefts,
    fieldLeft: field ? px(r(field).left) : null, chipLeft: chips.length ? px(r(chips[0]).left) : null, rowLeft: rows.length ? px(r(rows[0]).left) : null,
    rects: rows.map((x) => { const q = r(x); return [px(q.left), px(q.top), px(q.width), px(q.height)].join(","); }),
    active: a ? (a.getAttribute("aria-label") ?? a.tagName) : null, activeInSheet: !!a && dlg.contains(a),
    ring: as ? (as.boxShadow !== "none" || (as.outlineStyle !== "none" && parseFloat(as.outlineWidth) > 0)) : null,
  };
};

// ---- the glance pane ----
const paneState = async (name, cfg, { stale = false, size = SIZES[1] } = {}) => {
  await withList(`pane ${name}-${size.name}`, cfg, { url: MAIN_URL, size, fixedTime: stale ? "ticking" : "flow", instant: PINNED_ISO }, async ({ page }) => {
    if (stale) {
      cfg.getStatus = (n) => (n === 1 ? 200 : 500); // the first answer was good; every later one fails
      for (let k = 0; k < 4 && !(await seen(page, "[data-lists-pane] .sr-stale", 3000)); k++) {
        await page.clock.fastForward(31_000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      }
    }
    await page.locator('button[aria-label="Show Shopping list"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(700);
    const m = await page.evaluate(LIST_PANE);
    const key = `pane-${name}-${size.name}`;
    if (name.endsWith("dropped")) {
      LS.states[key] = { ok: !m.present && m.panes === m.dots, present: m.present, panes: m.panes, dots: m.dots };
      if (!LS.states[key].ok) LS.failed.push(`state ${key} ${JSON.stringify(LS.states[key])}`);
      return;
    }
    const want = { ordinary: LIST_STATES.ordinary.want, crowded: LIST_STATES.crowded.want, stale: LIST_STATES.ordinary.want }[name];
    if (!m.present) return void lWant(key, "", want);
    lWant(key, m.text, want);
    lRecord("L1", key, m.paneH <= 132 && m.paneW <= m.carouselW + 0.5 && m.bodyH <= 2 * m.lineH + 1 && m.small.length === 0, { paneH: m.paneH, bandH: m.bandH, paneW: m.paneW, carouselW: m.carouselW, bodyH: m.bodyH, lineH: m.lineH, small: m.small });
    lRecord("L10", key, Math.abs(m.capLeft - m.bodyLeft) <= 0.5 && /^(start|left)$/.test(m.textAlign), { capLeft: m.capLeft, bodyLeft: m.bodyLeft, textAlign: m.textAlign });
    if (name === "stale") lRecord("L11", key, m.staleTags === 1 && m.staleInCaption === 1, { staleTags: m.staleTags, staleInCaption: m.staleInCaption });
    await page.screenshot({ path: join(OUT_DIR, `list-${key}.png`), clip: m.clip });
  });
};
for (const size of SIZES) {
  await paneState("ordinary", { body: LIST_STATES.ordinary.body }, { size });
  await paneState("crowded", { body: LIST_STATES.crowded.body }, { size });
}
await paneState("stale", { body: LIST_STATES.ordinary.body }, { stale: true });
await paneState("empty-dropped", { body: LIST_EMPTY });
await paneState("failed-dropped", { body: LIST_EMPTY, getStatus: 500 });

// ---- the header button (L2 size, L14 copy) ----
for (const [name, cfg, label, aria] of [
  ["button-count", { body: LIST_STATES.crowded.body }, "Shopping 9", "Shopping list, 9 to get"],
  ["button-zero", { body: LIST_EMPTY }, "Shopping 0", "Shopping list, empty"],
  ["button-failed", { body: LIST_EMPTY, getStatus: 500 }, "Shopping", "Shopping list, not loaded"],
]) {
  await withList(name, cfg, {}, async ({ page }) => {
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label^="Shopping list"]');
      const header = document.querySelector("header");
      if (!b || !header) return { present: false };
      const h1 = header.getBoundingClientRect().height;
      b.style.display = "none";
      const h0 = header.getBoundingClientRect().height;
      b.style.display = "";
      return { present: true, label: b.innerText.replace(/\s+/g, " ").trim(), aria: b.getAttribute("aria-label"), h: b.getBoundingClientRect().height, headerWith: h1, headerWithout: h0 };
    });
    lWant(name, m.present ? `${m.label} | ${m.aria}` : "", [label, aria]);
    if (!m.present) return;
    lRecord("L14", name, m.label === label && m.aria === aria, { label: m.label, aria: m.aria, want: [label, aria] });
    if (name === "button-count") {
      lRecord("L2", name, Math.abs(m.h - 56) <= 0.5 && m.label.length <= 16 && Math.abs(m.headerWith - m.headerWithout) <= 1, { h: m.h, label: m.label.length, headerWith: m.headerWith, headerWithout: m.headerWithout });
      await lShot(page, name, page.locator('[data-rain-zone="dock"]').first());
    }
  });
}

// ---- the sheet at every count (L3 no scroll and rows = items, L4, L5, L6, L10; shots for the named states) ----
const COUNTS = [[0, listBody(0), "sheet-empty-with-chips"], [3, LIST_STATES.ordinary.body, "sheet-ordinary"], [6, listBody(6), null], [7, listBody(7), null], [9, LIST_STATES.crowded.body, "sheet-crowded"], [13, LIST_STATES.full.body, null]];
const captionTops = {};
for (const [n, body, shot] of COUNTS) {
  await withList(`sheet count ${n}`, { body }, {}, async ({ page }) => {
    await page.waitForTimeout(600);
    await openSheet(page);
    const m = await page.evaluate(LIST_SHEET);
    const key = `n${n}`;
    lRecord("L3", key, m.present && m.scroll.length === 0 && m.panelTop >= m.scrimPad - 0.5 && m.panelBottom <= m.vh - m.scrimPad + 0.5 && m.rowCount === n, { scroll: m.scroll, panelTop: m.panelTop, panelBottom: m.panelBottom, pad: m.scrimPad, rows: m.rowCount, want: n });
    const twoCol = n > 6;
    const rowsOk = n === 0 || (twoCol ? m.rowWraps.every((w) => Math.abs(w - (m.gridW - 16) / 2) <= 1.5) : m.rowWraps.every((w) => Math.abs(w - m.gridW) <= 1));
    lRecord("L4", key, m.small.length === 0 && rowsOk, { small: m.small, rowWraps: m.rowWraps, gridW: m.gridW, twoCol });
    lRecord("L5", key, m.chipCount <= 4 && m.chipTops === 1 && m.chipH === 44, { chips: m.chipCount, rowsOfChips: m.chipTops, chipH: m.chipH });
    lRecord("L6", key, m.fieldGap !== null && Math.abs(m.fieldGap - m.panelGap) <= 1, { fieldGap: m.fieldGap, panelGap: m.panelGap });
    lRecord("L10", `sheet ${key}`, m.lefts.length <= (twoCol ? 2 : 1) && m.fieldLeft === m.chipLeft && (n === 0 || m.chipLeft === m.rowLeft), { lefts: m.lefts, fieldLeft: m.fieldLeft, chipLeft: m.chipLeft, rowLeft: m.rowLeft });
    const text = await sheetText(page);
    if (n === 0) lWant("sheet-empty-with-chips", text, LIST_STATES.emptyChips.want);
    if (n === 3) lWant("sheet-ordinary", text, ["Often added", "Clear list", "Add an item"]);
    if (n === 9) lWant("sheet-crowded", text, ["Clear list"]);
    if (n === 13) lWant("sheet-full", text, LIST_STATES.full.want);
    if (n === 3 || n === 13) captionTops[n] = await page.evaluate(() => { const cap = [...document.querySelectorAll("[data-list-sheet] .microlabel")].find((e) => /often added/i.test(e.textContent)); const fld = document.querySelector('[data-list-sheet] input[aria-label="Add an item"]'); return cap && fld ? cap.getBoundingClientRect().top - fld.getBoundingClientRect().bottom : null; });
    if (shot) await lShot(page, shot, page.locator(SHEET));
  });
}
// L17: the hint line is reserved, so the "Often added" caption's top minus the bottom of the "Add an item" field is the same (within 1 px) in the ordinary (3 rows) and the full (13 rows) sheet; page-level tops differ because the sheet is centred
lRecord("L17", "caption offset below add field, ordinary vs full", captionTops[3] != null && captionTops[13] != null && Math.abs(captionTops[3] - captionTops[13]) <= 1, { ordinary: captionTops[3], full: captionTops[13] });

// ---- L15: the full list (11 open + 2 ticked) fits at both sizes: the last ticked row ends above the footer and the body does not scroll ----
const LIST_FIT = () => {
  const d = document.querySelector("[data-list-sheet]");
  const body = d?.querySelector("[data-sr-sheet-body]");
  const foot = d?.querySelector("[data-list-footer]");
  if (!d || !body || !foot) return { present: false };
  const ticked = [...d.querySelectorAll('[role=group][aria-label="Ticked"] [role=checkbox]')];
  const px = (v) => Math.round(v * 10) / 10;
  const scroll = [d, ...d.querySelectorAll("*")].filter((e) => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1).map((e) => e.tagName.toLowerCase()); // any element in the sheet, as L3 does
  return { present: true, ticked: ticked.length, lastBottom: px(Math.max(...ticked.map((x) => x.getBoundingClientRect().bottom))), footTop: px(foot.getBoundingClientRect().top), scrollH: body.scrollHeight, clientH: body.clientHeight, scroll };
};
for (const size of SIZES) {
  await withList(`sheet-full ${size.name}`, { body: LIST_STATES.full.body }, { size }, async ({ page }) => {
    await openSheet(page);
    const text = await sheetText(page);
    const ok = lWant(`sheet-full-${size.name}`, text, LIST_STATES.full.want);
    const m = await page.evaluate(LIST_FIT);
    lRecord("L15", size.name, ok && m.present && m.ticked === 2 && m.lastBottom <= m.footTop && m.scrollH <= m.clientH && m.scroll.length === 0, m);
    await lShot(page, `sheet-full-${size.name}`, page.locator(SHEET));
  });
}

// ---- L16: two 60-character names. Design rule 16 (kiosk-lists.md line 65): each row is one line and the name is truncated, the button keeps the full name; the pane names are max-w-[45%] truncate ----
const LIST_LONG = (scope) => {
  const root = document.querySelector(scope);
  if (!root) return { present: false };
  const names = [...root.querySelectorAll("span.truncate")];
  const bad = [];
  let truncated = 0;
  for (const el of names) {
    const cs = getComputedStyle(el);
    const box = (el.closest("[role=checkbox]")?.parentElement ?? root).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cut = el.scrollWidth > el.clientWidth + 1;
    if (cut) truncated++;
    const ellipsis = cs.textOverflow === "ellipsis" && cs.overflow.startsWith("hidden") && cs.whiteSpace === "nowrap";
    if (r.right > box.right + 0.5 || r.height > parseFloat(cs.lineHeight) * 1.5 || !ellipsis) bad.push(`${el.textContent.slice(0, 18)} right ${Math.round(r.right)} box ${Math.round(box.right)} h ${Math.round(r.height)} ellipsis ${ellipsis}`);
  }
  const full = [...root.querySelectorAll("span.truncate")].filter((e) => e.textContent.length === 60).length;
  return { present: true, names: names.length, truncated, long60: full, bad };
};
for (const [name, n, scope] of [["sheet-long-names-1col", 3, "[data-list-sheet]"], ["sheet-long-names-2col", 9, "[data-list-sheet]"]]) {
  await withList(name, { body: longNamesBody(n) }, {}, async ({ page }) => {
    await openSheet(page);
    const ok = lWant(name, await sheetText(page), [...LONG_NAMES]);
    const m = await page.evaluate(LIST_LONG, scope);
    lRecord("L16", name, ok && m.present && m.long60 === 2 && m.bad.length === 0, m);
    await lShot(page, name === "sheet-long-names-1col" ? "sheet-long-names" : "sheet-long-names-2col", page.locator(SHEET));
  });
}
await withList("pane-long-names", { body: longNamesBody(3) }, { url: MAIN_URL, instant: PINNED_ISO }, async ({ page }) => {
  await page.locator('button[aria-label="Show Shopping list"]').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  const m = await page.evaluate(LIST_LONG, "[data-lists-body]");
  const pane = page.locator("[data-lists-pane]");
  const ok = lWant("pane-long-names", m.present ? await pane.innerText() : "", [LONG_NAMES[0]]);
  lRecord("L16", "pane", ok && m.present && m.long60 === 2 && m.truncated >= 1 && m.bad.length === 0, m);
  await lShot(page, "pane-long-names-1024x768", pane);
});

// ---- states that need their own fixture or a write ----
await withList("sheet-empty-no-chips", { body: LIST_STATES.emptyNoChips.body }, {}, async ({ page }) => {
  await openSheet(page);
  lWant("sheet-empty-no-chips", await sheetText(page), LIST_STATES.emptyNoChips.want, LIST_STATES.emptyNoChips.not);
  await lShot(page, "sheet-empty-no-chips", page.locator(SHEET));
});

await withList("sheet-with-ticked", { body: LIST_STATES.ticked.body }, {}, async ({ page }) => {
  await openSheet(page);
  lWant("sheet-with-ticked", await sheetText(page), LIST_STATES.ticked.want);
  const before = (await page.evaluate(LIST_SHEET)).rects;
  await page.locator(`${SHEET} [role=checkbox]`).first().click(); // tick the newest open row
  await page.waitForTimeout(500);
  const after = await page.evaluate(LIST_SHEET);
  lRecord("L9", "tick moves no row", before.length > 0 && before.length === after.rects.length && before.every((q, i) => q === after.rects[i]), { before, after: after.rects });
  // L7: the check mark's transition is the house fade and ease; the reduced-motion context below shows it gone
  const t = await page.evaluate(() => {
    const el = document.querySelector("[data-list-sheet] [role=checkbox] svg");
    const dlg = document.querySelector("[data-list-sheet]");
    const cs = getComputedStyle(el);
    return { dur: cs.transitionDuration.split(",")[0].trim(), ease: cs.transitionTimingFunction.split(/,(?![^(]*\))/)[0].replace(/\s+/g, ""), prop: cs.transitionProperty, fade: getComputedStyle(dlg).getPropertyValue("--kiosk-fade-ms").trim(), easeVar: getComputedStyle(dlg).getPropertyValue("--kiosk-ease-out").replace(/\s+/g, "") };
  });
  lRecord("L7", "tick transition", Math.round(parseFloat(t.dur) * 1000) === parseFloat(t.fade) && t.ease === t.easeVar && /transform/.test(t.prop), t);
  await lShot(page, "sheet-with-ticked", page.locator(SHEET));
});
await withList("sheet-reduced-motion", { body: LIST_STATES.ticked.body }, { reduced: true }, async ({ page }) => {
  await openSheet(page);
  // motion-reduce:transition-none sets the property to none and leaves the duration, so either one counts.
  const t = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector("[data-list-sheet] [role=checkbox] svg")); return { prop: cs.transitionProperty, dur: cs.transitionDuration.split(",")[0].trim() }; });
  lRecord("L7", "reduced motion: no transform transition", t.prop === "none" || parseFloat(t.dur) === 0, t);
});

await withList("sheet-loading", { body: LIST_STATES.ordinary.body, hold: new Promise((res) => setTimeout(res, 9000)) }, {}, async ({ page }) => {
  await openSheet(page);
  lWant("sheet-loading", await sheetText(page), ["Loading the list…"]);
  if (!(await page.locator(`${SHEET} input`).isDisabled())) LS.failed.push("state sheet-loading: the field is not disabled");
  await lShot(page, "sheet-loading", page.locator(SHEET));
});
await withList("sheet-failed", { body: LIST_EMPTY, getStatus: 500 }, {}, async ({ page }) => {
  await openSheet(page);
  lWant("sheet-failed", await sheetText(page), ["Couldn't load the shopping list.", "Try again"]);
  if (!(await page.locator(`${SHEET} input`).isDisabled())) LS.failed.push("state sheet-failed: the field is not disabled");
  await lShot(page, "sheet-failed", page.locator(SHEET));
  await page.locator(SHEET).getByRole("button", { name: "Try again" }).click();
  await page.waitForTimeout(900);
  lWant("sheet-failed-retry", await sheetText(page), ["Still no answer from the server."]);
  await lShot(page, "sheet-failed-retry", page.locator(SHEET));
});
await withList("sheet-stale", { body: LIST_STATES.ordinary.body, getStatus: (n) => (n === 1 ? 200 : 500) }, {}, async ({ page }) => {
  await page.waitForTimeout(800);
  await openSheet(page); // opening revalidates: the second answer fails, so the cached list is marked stale
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => { const tags = [...document.querySelectorAll("[data-list-sheet] .sr-stale")]; return { tags: tags.length, inTitle: tags.filter((t) => t.parentElement?.querySelector(":scope > [data-sr-title]")).length }; });
  lWant("sheet-stale", await sheetText(page), ["Oat milk", "Stale"]);
  lRecord("L11", "sheet title", m.tags === 1 && m.inTitle === 1, m);
  await lShot(page, "sheet-stale", page.locator(SHEET));
});

// ---- writes: save failed, offline queue, hints ----
await withList("sheet-save-failed", { body: LIST_STATES.ordinary.body, post: { add: { status: 500, json: { error: "store" } } } }, {}, async ({ page }) => {
  await openSheet(page);
  await typeAdd(page, "Tea");
  lWant("sheet-save-failed", await sheetText(page), ["Tea", "Not saved"]);
  const retry = await page.locator(SHEET).getByRole("button", { name: "Retry saving Tea" }).count();
  const q = await lQueue(page);
  if (retry !== 1 || q.length !== 1 || q[0].op !== "add") LS.failed.push(`state sheet-save-failed: retry buttons ${retry}, queue ${JSON.stringify(q)}`);
  await lShot(page, "sheet-save-failed", page.locator(SHEET));
});
{
  const cfg = { body: LIST_STATES.ordinary.body, post: { add: "abort" } };
  await withList("sheet-offline-queued", cfg, {}, async ({ page }) => {
    await openSheet(page);
    await typeAdd(page, "Tea");
    lWant("sheet-offline-queued", await sheetText(page), ["Tea", "Not saved"]);
    const q = await lQueue(page);
    if (q.length !== 1) LS.failed.push(`state sheet-offline-queued: queue ${JSON.stringify(q)}`);
    await lShot(page, "sheet-offline-queued", page.locator(SHEET));
    delete cfg.post.add; // the network is back: a reload flushes the queue
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const after = await lQueue(page);
    await openSheet(page);
    const t = await sheetText(page);
    if (after.length !== 0 || !t.includes("Tea") || t.includes("Not saved")) LS.failed.push(`state sheet-offline-queued: after reload queue ${after.length}, text has Tea ${t.includes("Tea")}, still unsaved ${t.includes("Not saved")}`);
  });
}
for (const [name, body, typed, want] of [
  ["sheet-hint-dupe", LIST_STATES.ordinary.body, "oat   MILK", ["Oat milk is already on the list."]],
  ["sheet-hint-revive", LIST_STATES.ticked.body, "eggs", ["Eggs is back on the list."]],
  ["sheet-hint-60", LIST_STATES.ordinary.body, "a".repeat(70), ["60 characters at most."]],
]) {
  await withList(name, { body }, {}, async ({ page }) => {
    await openSheet(page);
    if (name === "sheet-hint-60") {
      await page.locator(`${SHEET} input`).fill(typed);
      const len = await page.locator(`${SHEET} input`).evaluate((i) => i.value.length);
      if (len !== 60) LS.failed.push(`state ${name}: the field holds ${len} characters, not 60`);
    } else await typeAdd(page, typed);
    lWant(name, await sheetText(page), want);
    await lShot(page, name, page.locator(SHEET));
  });
}

// ---- the PIN gate (only "Clear list") ----
await withList("sheet-confirm", { body: LIST_STATES.crowded.body }, {}, async ({ page }) => {
  await openSheet(page);
  await page.locator(SHEET).getByRole("button", { name: "Clear list" }).click();
  await page.waitForTimeout(400);
  lWant("sheet-confirm-needs-pin", await sheetText(page), ["Clear all 9 items? This needs the PIN.", "Cancel", "Enter PIN"]);
  await lShot(page, "sheet-confirm-needs-pin", page.locator(SHEET));
  await page.locator(SHEET).getByRole("button", { name: "Enter PIN" }).click();
  await seen(page, "[role=dialog]:not([data-list-sheet])", 5000);
  await page.waitForTimeout(700);
  const pin = await page.evaluate(() => {
    const pads = [...document.querySelectorAll("[role=dialog]")].filter((d) => !d.hasAttribute("data-list-sheet"));
    const pad = pads[pads.length - 1];
    if (!pad) return { present: false };
    const q = pad.getBoundingClientRect();
    const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return { present: true, inside: !!hit && pad.contains(hit) };
  });
  lRecord("L12", "pin pad above the sheet", pin.present && pin.inside, pin);
  LS.states["sheet-pin-over-sheet"] = { ok: pin.present && pin.inside };
  await page.screenshot({ path: join(OUT_DIR, "list-sheet-pin-over-sheet.png") });
  await enterPin(page);
  lWant("sheet-confirm-elevated", await sheetText(page), ["Clear all 9 items?", "Clear 9 items"], ["This needs the PIN."]);
  await lShot(page, "sheet-confirm-elevated", page.locator(SHEET));
  // the elevation lapsed on the server: the clear answers 403 and the row goes back to the first form
  await page.unroute(LIST_RE);
  await page.route(LIST_RE, (route) => (route.request().method() === "POST" ? route.fulfill({ status: 403, json: { error: "elevation" } }) : route.fulfill({ json: LIST_STATES.crowded.body })));
  await page.locator(SHEET).getByRole("button", { name: "Clear 9 items" }).click();
  await page.waitForTimeout(700);
  lWant("sheet-confirm-403-lapse", await sheetText(page), ["Clear all 9 items? This needs the PIN."]);
  await lShot(page, "sheet-confirm-403-lapse", page.locator(SHEET));
});

// ---- undo ----
await withList("sheet-undo-ticked", { body: LIST_STATES.ticked.body }, {}, async ({ page }) => {
  await openSheet(page);
  await page.locator(SHEET).getByRole("button", { name: "Clear 2 ticked" }).click();
  await page.waitForTimeout(600);
  lWant("sheet-undo-ticked", await sheetText(page), ["Cleared 2 ticked items.", "Undo"]);
  const undoH = await page.locator(SHEET).getByRole("button", { name: "Undo" }).evaluate((b) => b.getBoundingClientRect().height);
  lRecord("L4", "undo button", undoH >= 43.5, { undoH });
  await lShot(page, "sheet-undo-ticked", page.locator(SHEET));
});
await withList("sheet-undo-all", { body: LIST_STATES.crowded.body, elevated: true }, {}, async ({ page }) => {
  await openSheet(page);
  await page.locator(SHEET).getByRole("button", { name: "Clear list" }).click();
  await page.waitForTimeout(400);
  lWant("sheet-undo-all already elevated", await sheetText(page), ["Clear all 9 items?", "Clear 9 items"], ["This needs the PIN."]);
  await page.locator(SHEET).getByRole("button", { name: "Clear 9 items" }).click();
  await page.waitForTimeout(700);
  lWant("sheet-undo-all", await sheetText(page), ["Cleared 9 items.", "Undo"]);
  await lShot(page, "sheet-undo-all", page.locator(SHEET));
  await page.locator(SHEET).getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(800);
  const back = await page.locator(`${SHEET} [role=checkbox]`).count();
  if (back !== 9) LS.failed.push(`state sheet-undo-all: ${back} rows after Undo, want 9`);
});

// ---- L13 initial focus ----
await withList("sheet-focus", { body: LIST_STATES.ordinary.body }, {}, async ({ page }) => {
  await openSheet(page);
  const m = await page.evaluate(LIST_SHEET);
  lRecord("L13", "on open", m.active === "Close" && m.activeInSheet && m.ring === false, { active: m.active, ring: m.ring });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  const k = await page.evaluate(LIST_SHEET);
  lRecord("L13", "after a key", k.activeInSheet && k.active !== "Close" && k.ring === true, { active: k.active, ring: k.ring });
});

// ---- night: nothing (the overlay owns the screen) ----
await withList("night-none", { body: LIST_STATES.ordinary.body }, { url: `${L_STD}&period=night` }, async ({ page }) => {
  await page.waitForTimeout(800);
  const n = await page.evaluate(() => ({ pane: document.querySelectorAll("[data-lists-pane]").length, button: document.querySelectorAll('button[aria-label^="Shopping list"]').length }));
  LS.states["night-none"] = { ok: n.pane === 0 && n.button === 0, ...n };
  if (!LS.states["night-none"].ok) LS.failed.push(`state night-none ${JSON.stringify(n)}`);
});

// ---- test 25: the widget registry (a fresh layout shows the pane right after UV and air; a saved layout without `lists` shows none) ----
await lRun("registry", async () => {
  const labels = (page) => page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Show "]')].map((b) => b.getAttribute("aria-label")));
  const o = { url: MAIN_URL, size: SIZES[1], weather: sunAirWeatherFor("ordinary"), fixedTime: true, instant: sunAirInstant("ordinary") };
  const a = await listVisit({ body: LIST_STATES.ordinary.body }, o);
  await a.page.waitForTimeout(800);
  const fresh = await labels(a.page);
  await a.context.close();
  const i = fresh.indexOf("Show UV and air");
  LS.registry.fresh = { labels: fresh, ok: i >= 0 && fresh[i + 1] === "Show Shopping list" };
  const saved = JSON.stringify({ glance: ["forecast", "sun-air", "news", "climate", "containers"], full: [] });
  const b = await listVisit({ body: LIST_STATES.ordinary.body }, { ...o, initScript: `localStorage.setItem("kiosk-widgets", ${JSON.stringify(saved)})` });
  await b.page.waitForTimeout(800);
  const old = await labels(b.page);
  await b.context.close();
  LS.registry.saved = { labels: old, ok: old.length > 0 && !old.includes("Show Shopping list") };
  for (const [k, v] of Object.entries(LS.registry)) if (!v.ok) LS.failed.push(`registry ${k} ${JSON.stringify(v.labels)}`);
});

// L8 runs in node (no page): ink, ink-dim and ink-faint on bg, panel and panel-2 in every theme and sunroom stop
await lRun("L8 contrast", async () => {
  const c = await uvContrast(["ink", "ink-dim", "ink-faint"]);
  lRecord("L8", "contrast", c.pass && c.unresolved.length === 0, { checked: c.checked, lowest: c.lowest, failures: c.failures, unresolved: c.unresolved });
});

// every L needs its entries (a missing one fails it): L1 five pane states, L3-L6 six counts, L10 five panes + six counts, L11 stale pane and sheet
const L_NEED = { L1: 5, L2: 1, L3: 6, L4: 7, L5: 6, L6: 6, L7: 2, L8: 1, L9: 1, L10: 11, L11: 2, L12: 1, L13: 2, L14: 3, L15: 2, L16: 3, L17: 1 };
for (const n of LNS) {
  const e = LS.entries[n];
  LS[n] = e.length >= L_NEED[n] && e.every((x) => x.ok);
  if (e.length < L_NEED[n]) LS.failed.push(`${n} has ${e.length} entries, needs ${L_NEED[n]}`);
}
if (LS.failed.length) process.exitCode = 1;

// ---- kiosk bin night: numeric checks N1-N9 and N11 (N10 is src/lib/bin-night.test.ts) and the capture states ----
// results.bins.{N1..N9,N11}: true | false (each needs its entries; a missing entry fails it), results.bins.entries.<Nx>[] the numbers,
// results.bins.states.<key> the measurements, results.bins.settings.<state> {ok, missing[], present[], ...}, results.bins.failed[] (one line each).
// Shots: bins-<key>.png (+ -crop.png) and bins-settings-<state>.png. The run exits 1 when any N is false or any state fails.
// ONE date: binInstant() pins the clock and every mocked night.date is BIN_TODAY (fixtures.mjs). The evening states assert the line IS there with its exact
// sentence, so the absence checks (N9) cannot pass with the feature broken. /kiosk/api/bins is answered per state through visit()'s `routes`.
const BN = (results.bins = { entries: {}, states: {}, settings: {}, failed: [] });
const BNS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N11", "P3"];
for (const n of BNS) BN.entries[n] = [];
const bnRecord = (n, key, ok, detail = {}) => { BN.entries[n].push({ key, ok, ...detail }); if (!ok) BN.failed.push(`${n} ${key} ${JSON.stringify(detail)}`); };
const bnRun = (name, fn) => guarded(`bins ${name}`, async () => { try { await fn(); } catch (e) { BN.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const bnNear = (a, b, tol = 0.5) => typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
// the clock's date and every mocked night.date are one value; only stale-bins is meant to differ, and it must
for (const [k, s] of Object.entries(BIN_STATES)) {
  const same = !s.body.night || s.body.night.date === binInstant(s.at).slice(0, 10);
  if (same === (k === "stale-bins")) BN.failed.push(`fixture ${k}: night.date ${same ? "matches" : "differs from"} the fake clock's date`);
}
const BIN_THEME_URL = (theme, std = false) => `${BASE_URL}/kiosk?theme=${theme}&wx=overcast&wxsun=day${std ? "&layout=standard" : ""}`;
const binsVisit = (state, url, size) => visit(url, { viewport: size.viewport, weather: binWeatherFor(state), fixedTime: true, instant: binInstant(BIN_STATES[state].at), routes: { "/kiosk/api/bins": BIN_STATES[state].body } });

/** Glance: the line, the stack around it and the probes the checks compare against. Every number is read from the house class it measures. */
const BIN_GLANCE = () => {
  // probes sit inside the measured stack, so the kiosk scope's type rules apply to them as to the line
  const probe = (cls, host) => {
    const el = Object.assign(document.createElement("span"), { className: cls, textContent: "x" });
    host.append(el);
    const cs = getComputedStyle(el);
    const o = { lineHeight: parseFloat(cs.lineHeight), fontSize: parseFloat(cs.fontSize), maxWidth: parseFloat(cs.maxWidth) };
    el.remove();
    return o;
  };
  const shown = [...document.querySelectorAll('[data-rain-zone="sentence"] p')].filter((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const line = document.querySelector('[data-bin-night="line"]');
  const out = { nodes: document.querySelectorAll("[data-bin-night]").length, prose: shown.length, proseTexts: shown.map((p) => p.textContent.trim()), rendered: !!document.querySelector("[data-kiosk-theme]") };
  if (!line) return out;
  const r = line.getBoundingClientRect();
  const wrap = line.parentElement;
  const wr = wrap.getBoundingClientRect();
  const next = wrap.nextElementSibling;
  const nr = next ? next.getBoundingClientRect() : null;
  const stack = wrap.parentElement;
  // in-flow children only: the fixed corner cluster is a sibling of the stack's own content (KioskGlance returns a fragment)
  const kids = [...stack.children].filter((c) => getComputedStyle(c).position !== "fixed").map((c) => c.getBoundingClientRect()).filter((k) => k.height > 0);
  const cluster = document.querySelector('[data-rain-zone="tiles"]');
  const svg = line.querySelector("svg")?.getBoundingClientRect();
  const base = probe("text-base", wrap); // the 16 px glyph reference (N5)
  const lead = probe("text-xl", wrap); // the band panes' lead class, which the line now uses (N1, P3)
  const top = Math.max(0, Math.min(wr.top, ...(nr ? [nr.top] : [])) - 16);
  return {
    ...out, text: line.textContent, h: r.height, scrollW: line.scrollWidth, clientW: line.clientWidth, w: r.width,
    lineHeight: lead.lineHeight, leadPx: lead.fontSize, linePx: parseFloat(getComputedStyle(line).fontSize), fontSize: base.fontSize, maxW: probe("max-w-xl", wrap).maxWidth,
    gapToNext: nr ? nr.top - wr.bottom : null, nextText: next ? next.textContent.trim() : null, rowGap: parseFloat(getComputedStyle(stack).rowGap),
    glyph: svg ? { w: svg.width, h: svg.height } : null,
    stackBottom: Math.max(...kids.map((k) => k.bottom)), clusterTop: cluster ? cluster.getBoundingClientRect().top : null, stackOverflow: stack.scrollHeight - stack.clientHeight,
    clip: { x: Math.max(0, wr.left - 16), y: top, width: wr.width + 32, height: (nr ? nr.bottom : wr.bottom) - top + 16 },
  };
};

/** Standard: the row, its neighbours, the header and the hub's top. */
const BIN_STD = () => {
  const row = document.querySelector('[data-bin-night="row"]');
  const anchor = document.querySelector("[data-weather-line]") ?? document.querySelector("[data-weather-datums]");
  const root = anchor ? document.querySelector(".max-w-6xl.grid-cols-12") : null; // the board grid (the weather line lives in the hero now)
  const out = {
    nodes: document.querySelectorAll("[data-bin-night]").length, rendered: !!document.querySelector("[data-kiosk-theme]"),
    header: document.querySelector("header")?.getBoundingClientRect().height ?? null,
    hubTop: root && root.lastElementChild ? root.lastElementChild.getBoundingClientRect().top : null,
  };
  if (!row) return out;
  const r = row.getBoundingClientRect();
  const prev = row.previousElementSibling ? row.previousElementSibling.getBoundingClientRect() : null;
  const svg = row.querySelector("svg")?.getBoundingClientRect();
  const sunset = document.querySelector("[data-weather-line] svg.lucide-sunset")?.getBoundingClientRect();
  return {
    ...out, text: row.textContent, h: r.height, lineHeight: parseFloat(getComputedStyle(row).lineHeight), gap: prev ? r.top - prev.bottom : null,
    // space-y-3 is a margin between siblings: top of this row on Tailwind 3, bottom of the previous sibling on 4
    margin: parseFloat(getComputedStyle(row).marginTop) + (row.previousElementSibling ? parseFloat(getComputedStyle(row.previousElementSibling).marginBottom) : 0),
    scrollW: row.scrollWidth, clientW: row.clientWidth, glyph: svg ? { w: svg.width, h: svg.height } : null, sunsetW: sunset ? sunset.width : null,
    clip: { x: Math.max(0, r.left - 16), y: Math.max(0, (prev ? prev.top : r.top) - 8), width: r.width + 32, height: r.bottom - (prev ? prev.top : r.top) + 24 },
  };
};

// glance: present states first (N1-N5, N11), then absent ones (N9, N11)
const BIN_GLANCE_PRESENT = [
  { key: "evening-1180-sunroom", state: "evening", theme: "sunroom", size: SIZES[0] },
  { key: "evening-1024-sunroom", state: "evening", theme: "sunroom", size: SIZES[1] },
  { key: "evening-folio", state: "evening", theme: "folio", size: SIZES[1] },
  { key: "evening-default", state: "evening", theme: "default", size: SIZES[1] },
  { key: "crowded-glance-1024", state: "crowded", theme: "sunroom", size: SIZES[1] },
  { key: "two-bin-fallback", state: "two-bin-fallback", theme: "sunroom", size: SIZES[1] },
];
const BIN_ABSENT = ["quiet", "ordinary", "morning", "crowded-am", "fail-bins", "stale-bins", "unconf", "night-wake"];
const binWake = async (page, state) => {
  if (state !== "night-wake") return;
  await page.mouse.click(SIZES[1].viewport.width / 2, SIZES[1].viewport.height / 2); // a wake tap: Standard then runs as "day"
  await page.waitForTimeout(800);
};
for (const g of BIN_GLANCE_PRESENT) {
  await bnRun(`glance ${g.key}`, async () => {
    const { context, page } = await binsVisit(g.state, BIN_THEME_URL(g.theme), g.size);
    const m = await page.evaluate(BIN_GLANCE);
    BN.states[g.key] = m;
    const want = BIN_STATES[g.state].want;
    // the defining text first: a state without its exact sentence fails every check below it
    const has = m.nodes === 1 && m.text === want;
    bnRecord("N11", g.key, has && m.prose <= 2, { prose: m.prose, texts: m.proseTexts, want, text: m.text ?? null });
    bnRecord("N1", g.key, has && bnNear(m.h, m.lineHeight), { h: m.h, lineHeight: m.lineHeight });
    // P3: the bin line is the band panes' lead size (text-xl): its computed size equals the text-xl probe the calendar lead uses (see calendar P1)
    bnRecord("P3", g.key, has && bnNear(m.linePx, m.leadPx, 0.01), { linePx: m.linePx, leadPx: m.leadPx });
    bnRecord("N2", g.key, has && m.scrollW <= m.clientW && m.w <= m.maxW + 0.5, { scrollW: m.scrollW, clientW: m.clientW, w: m.w, maxW: m.maxW });
    bnRecord("N3", g.key, has && /^tomorrow /.test(m.nextText ?? "") && bnNear(m.gapToNext, m.rowGap), { gapToNext: m.gapToNext, rowGap: m.rowGap, next: m.nextText });
    bnRecord("N4", g.key, has && m.clusterTop !== null && m.stackBottom < m.clusterTop && m.stackOverflow <= 1, { stackBottom: m.stackBottom, clusterTop: m.clusterTop, stackOverflow: m.stackOverflow });
    bnRecord("N5", g.key, has && !!m.glyph && m.glyph.w === 16 && m.glyph.h === 16 && m.glyph.w === m.fontSize, { glyph: m.glyph, fontSize: m.fontSize });
    await page.screenshot({ path: join(OUT_DIR, `bins-${g.key}.png`) });
    if (has) await page.screenshot({ path: join(OUT_DIR, `bins-${g.key}-crop.png`), clip: m.clip });
    await context.close();
  });
}
for (const state of BIN_ABSENT) {
  await bnRun(`glance absent ${state}`, async () => {
    const { context, page } = await binsVisit(state, BIN_THEME_URL("sunroom"), SIZES[1]);
    await binWake(page, state);
    const m = await page.evaluate(BIN_GLANCE);
    const key = `glance-${state}`;
    BN.states[key] = m;
    bnRecord("N9", key, m.nodes === 0 && m.rendered && !(await crashed(page)), { nodes: m.nodes, rendered: m.rendered });
    bnRecord("N11", key, m.prose <= 2, { prose: m.prose, texts: m.proseTexts });
    if (["morning", "fail-bins", "unconf"].includes(state)) await page.screenshot({ path: join(OUT_DIR, `bins-${state}.png`) });
    await context.close();
  });
}

// standard: the row, then the same moment (same clock, same weather) with no rule, for N7 and N8
const BIN_STD_PRESENT = [
  { key: "evening-std-1180", state: "evening", size: SIZES[0], base: "unconf" },
  { key: "evening-std-1024", state: "evening", size: SIZES[1], base: "unconf" },
  { key: "crowded-standard-1024", state: "crowded", size: SIZES[1], base: "unconf-crowded" },
];
const stdVisit = async (state, size) => {
  const v = await binsVisit(state, BIN_THEME_URL("sunroom", true), size);
  return { ...v, m: await v.page.evaluate(BIN_STD) };
};
const baseline = {};
for (const [state, size] of [["unconf", SIZES[0]], ["unconf", SIZES[1]], ["unconf-crowded", SIZES[1]]]) {
  await bnRun(`standard baseline ${state} ${size.name}`, async () => {
    const { context, m } = await stdVisit(state, size);
    baseline[`${state}|${size.name}`] = m;
    BN.states[`std-${state}-${size.name}`] = m;
    bnRecord("N9", `std-${state}-${size.name}`, m.nodes === 0 && m.rendered, { nodes: m.nodes, rendered: m.rendered });
    await context.close();
  });
}
for (const s of BIN_STD_PRESENT) {
  await bnRun(`standard ${s.key}`, async () => {
    const { context, page, m } = await stdVisit(s.state, s.size);
    BN.states[s.key] = m;
    const has = m.nodes === 1 && m.text === BIN_STATES[s.state].want;
    const base = baseline[`${s.base}|${s.size.name}`];
    bnRecord("N5", s.key, has && !!m.glyph && m.glyph.w === 12 && m.glyph.h === 12 && (m.sunsetW === null || m.glyph.w === m.sunsetW), { glyph: m.glyph, sunsetW: m.sunsetW });
    bnRecord("N6", s.key, has && bnNear(m.h, m.lineHeight) && bnNear(m.gap, 8) && m.scrollW <= m.clientW, { h: m.h, lineHeight: m.lineHeight, gap: m.gap, margin: m.margin, scrollW: m.scrollW, clientW: m.clientW });
    // a missing baseline leaves N7 and N8 one entry short, which fails them
    if (base) {
      bnRecord("N7", s.key, has && m.hubTop - base.hubTop >= -1 && m.hubTop - base.hubTop <= m.h + m.gap + 1, { hubTop: m.hubTop, baseHubTop: base.hubTop, rowH: m.h, gap: m.gap });
      bnRecord("N8", s.key, has && bnNear(m.header, base.header, 1), { header: m.header, baseHeader: base.header });
    }
    await page.screenshot({ path: join(OUT_DIR, `bins-${s.key}.png`) });
    if (has) await page.screenshot({ path: join(OUT_DIR, `bins-${s.key}-crop.png`), clip: m.clip });
    await context.close();
  });
}
for (const state of BIN_ABSENT) {
  await bnRun(`standard absent ${state}`, async () => {
    const { context, page } = await binsVisit(state, BIN_THEME_URL("sunroom", true), SIZES[1]);
    await binWake(page, state);
    const m = await page.evaluate(BIN_STD);
    BN.states[`std-${state}`] = m;
    bnRecord("N9", `std-${state}`, m.nodes === 0 && m.rendered && !(await crashed(page)), { nodes: m.nodes, rendered: m.rendered });
    await context.close();
  });
}

// ---- the Settings card: GET /api/settings is answered here, so only the page itself is real ----
// The settings page sits behind the login: each state signs in on its own context (the test stack takes any password).
async function binsSettings(name, rule, { viewport = { width: 1024, height: 768 }, drive = null, want = [], not = [], mark = null, after = null } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: ZONE });
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  await context.clock.setFixedTime(new Date(binInstant("19:00")));
  const page = await context.newPage();
  page.on("pageerror", (e) => { pageErrors++; BN.failed.push(`settings ${name} pageerror ${String(e?.message ?? e).slice(0, 120)}`); });
  await page.route((u) => u.pathname === "/api/settings", (r) => (r.request().method() === "GET" ? r.fulfill({ json: settingsFullFor(rule) }) : r.fallback()));
  const intro = page.getByText("The wall kiosk shows a line from 5 pm to 10 pm");
  const consoleErrs = []; page.on("console", (m) => { if (m.type() === "error" && consoleErrs.length < 3) consoleErrs.push(m.text().slice(0, 120)); });
  try {
  await page.goto(`${BASE_URL}/settings#bins`, { waitUntil: "domcontentloaded" });
  await intro.waitFor({ state: "attached", timeout: 20_000 });
  if (!(await intro.isVisible().catch(() => false))) await page.getByRole("button", { name: /Bin night/ }).first().click().catch(() => {});
  await intro.waitFor({ state: "visible", timeout: 10_000 });
  } catch (err) { // diagnostics: say what the page showed instead of the card
    await page.screenshot({ path: join(OUT_DIR, `bins-settings-${name}-FAILED.png`), fullPage: true }).catch(() => {});
    const body = await page.evaluate(() => document.body.innerText).catch(() => "");
    BN.failed.push(`settings ${name} FAILED ${page.url()} body=${JSON.stringify(String(body).slice(0, 300))} console=${JSON.stringify(consoleErrs)}`);
    throw err;
  }
  await page.waitForTimeout(600);
  if (drive) await drive(page);
  await page.waitForTimeout(300);
  const t = textHas(await page.evaluate(() => document.body.innerText), want, not);
  const extra = mark ? await mark(page) : {};
  const textOk = t.missing.length === 0 && t.present.length === 0;
  BN.settings[name] = { ...t, ...extra, ok: textOk && extra.ok !== false };
  if (!textOk) BN.failed.push(`settings ${name} ${JSON.stringify(t)}`);
  if (extra.ok === false) BN.failed.push(`settings ${name} ${JSON.stringify(extra)}`);
  // The fixed bottom tab bar would float over the first name field in a full-page 390 shot; hide it for this capture only.
  if (viewport.width === 390) await page.addStyleTag({ content: "nav.fixed.bottom-0, nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: join(OUT_DIR, `bins-settings-${name}.png`), fullPage: true });
  // a11y checks that change the card run after the capture; anything but ok === true is a failure, never a skip
  if (after) { const a = await after(page); BN.settings[name].after = a; if (a.ok !== true) BN.failed.push(`settings ${name} after ${JSON.stringify(a)}`); }
  await context.close();
}
const BIN_ERRORS = ["Name this bin, or remove it.", "Bin names are 20 characters at most.", "Use letters or numbers in the bin name.", "Another bin already has this name.", "Pick any date this bin is collected.", "Pick a date between 2000 and 2099."];
const binCard = (page) => page.getByText("The wall kiosk shows a line from 5 pm to 10 pm").locator(".."); // the intro is the card root's first child
// where focus is: the control's name, or "body" when it was lost
const focusOf = (page) => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? { tag: a.tagName, ph: a.getAttribute("placeholder"), label: a.getAttribute("aria-label"), text: (a.textContent || "").trim().slice(0, 30), value: a.value ?? null, describedText: a.getAttribute("aria-describedby") ? document.getElementById(a.getAttribute("aria-describedby"))?.textContent?.slice(0, 40) ?? null : null } : { tag: "body" }; });
const binGroups = (page) => binCard(page).locator("[data-bin-row]").evaluateAll((els) => els.map((e) => ({ role: e.getAttribute("role"), label: e.getAttribute("aria-label") })));
const saveDisabled = (page) => binCard(page).getByRole("button", { name: "Save" }).isDisabled();
await bnRun("settings empty", () => binsSettings("settings-empty", null, {
  want: ["Nothing saved yet. The wall shows no bin line."], not: [...BIN_ERRORS, "Pick the day the truck comes."],
  mark: async (page) => ({ ok: await saveDisabled(page) }), // nothing typed, nothing to save, nothing flagged
}));
await bnRun("settings two bins", () => binsSettings("settings-two-bins", BIN_RULE_TWO, {
  want: ['Next on the wall: Monday 15 Jun, 5 pm to 10 pm. "Recycling and Garden organics go out tonight"', "A COLLECTION DATE"], not: BIN_ERRORS, // innerText gives a Label as the CSS upper-cases it
  // no segment label may be cut to an ellipsis at desktop width
  mark: async (page) => {
    const clipped = await binCard(page).locator("button[aria-pressed]").evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent));
    const groups = await binGroups(page); // each row is a named group: "Bin 1: Recycling"
    const named = groups.length === 2 && groups.every((g, i) => g.role === "group" && new RegExp(`^Bin ${i + 1}: .+`).test(g.label ?? ""));
    return { ok: !(await saveDisabled(page)) && clipped.length === 0 && named, clipped, groups };
  },
  after: async (page) => {
    const card = binCard(page);
    await card.getByRole("button", { name: /^Remove / }).nth(1).click(); // the last row goes: focus to the row before
    await page.waitForTimeout(200);
    const removed = await focusOf(page);
    await card.getByRole("button", { name: "Clear bin schedule" }).click();
    await page.waitForTimeout(200);
    const asked = await focusOf(page); // Cancel, reading the question
    await page.route((u) => u.pathname === "/api/settings/integrations", (r) => r.fulfill({ json: { ok: true } }));
    await page.getByRole("button", { name: "Yes, clear" }).click();
    await page.waitForTimeout(800);
    const cleared = await focusOf(page);
    const ok = removed.tag === "INPUT" && removed.ph === "Bin name" && asked.text === "Cancel" && /^Removes the bin schedule/.test(asked.describedText ?? "") && cleared.tag === "INPUT" && cleared.ph === "Bin name";
    return { ok, removed, asked, cleared };
  },
}));
await bnRun("settings errors", () => binsSettings("settings-errors", BIN_RULE_TWO, {
  drive: async (page) => {
    await page.getByRole("button", { name: "Add a bin" }).click(); // a third row copies Tuesday and every second week, name blank
    await page.locator('input[placeholder="Bin name"]').nth(2).fill("recycling"); // the first row's name in another case
    await page.locator('input[type="date"]').nth(1).fill("2026-11-18"); // a Wednesday on a Tuesday bin
    await page.getByRole("button", { name: "Add a bin" }).click(); // a fourth, blank row; the button then goes
  },
  want: ["Another bin already has this name.", "18 Nov 2026 is a Wednesday. Pick a Tuesday, or change the collection day.", "Name this bin, or remove it."],
  mark: async (page) => {
    // a shown field error is an alert and its input is aria-invalid
    const errs = await binCard(page).locator("[role=alert]").count();
    const names = await binCard(page).locator('input[placeholder="Bin name"]').evaluateAll((is) => is.map((i) => i.getAttribute("aria-invalid")));
    const dates = await binCard(page).locator('input[type="date"]').evaluateAll((is) => is.map((i) => i.getAttribute("aria-invalid")));
    const a11y = errs >= 3 && names[2] === "true" && names[3] === "true" && dates[1] === "true";
    return { ok: (await saveDisabled(page)) && (await binCard(page).getByRole("button", { name: "Add a bin" }).count()) === 0 && a11y, alerts: errs, names, dates };
  },
  after: async (page) => {
    await binCard(page).getByRole("button", { name: /^Remove / }).first().click(); // the first row goes: focus to the new first row
    await page.waitForTimeout(200);
    const f = await focusOf(page);
    const first = await binCard(page).locator("[data-bin-row]").first().getAttribute("aria-label");
    return { ok: f.tag === "INPUT" && f.ph === "Bin name" && first === "Bin 1: " + f.value, f, first };
  },
}));
await bnRun("settings night too long", () => binsSettings("settings-night-long", BIN_RULE_WED, {
  drive: async (page) => {
    await page.getByRole("button", { name: "Add a bin" }).click(); // copies Wednesday and weekly
    await page.locator('input[placeholder="Bin name"]').nth(2).fill("Cans");
  },
  want: ["Tuesday night's line is too long for the wall (47 of 44 characters). Shorten a bin name."],
  mark: async (page) => ({ ok: await saveDisabled(page) }),
}));
await bnRun("settings 390", () => binsSettings("settings-390", BIN_RULE_TWO, {
  viewport: { width: 390, height: 844 },
  want: ["COLLECTION DAY", "Every second week"],
  // Vision principle 7: each of the seven day buttons is at least 44 px wide, and the page does not scroll sideways
  mark: async (page) => page.evaluate(() => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const w = [...document.querySelectorAll("button[aria-label]")].filter((b) => days.includes(b.getAttribute("aria-label")) && b.getBoundingClientRect().width > 0).map((b) => Math.round(b.getBoundingClientRect().width * 10) / 10);
    // Remove (item 6): at least the house tap minimum. The repo defines no --tap-min token, so read it when present and fall back to 44 (h-11, the day-button floor).
    const tapMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-min")) || 44;
    const rm = [...document.querySelectorAll("button[aria-label^='Remove ']")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
    const removeOk = rm.length >= 2 && Math.min(...rm) >= tapMin;
    return { ok: w.length >= 14 && Math.min(...w) >= 44 && document.documentElement.scrollWidth <= 390 && removeOk, narrowestDay: w.length ? Math.min(...w) : null, dayButtons: w.length, pageScrollW: document.documentElement.scrollWidth, removeOk, removeH: rm.length ? Math.min(...rm) : null, removeButtons: rm.length, tapMin };
  }),
}));

// every N needs its entries (a missing one fails it): N1-N4 six glance states, N5 six glance + three Standard, N6-N8 three Standard, N9 eight glance + three baselines + eight Standard, N11 six present + eight absent
const BN_NEED = { N1: 6, N2: 6, N3: 6, N4: 6, N5: 9, N6: 3, N7: 3, N8: 3, N9: 19, N11: 14, P3: 6 };
for (const n of BNS) {
  const e = BN.entries[n];
  BN[n] = e.length >= BN_NEED[n] && e.every((x) => x.ok);
  if (e.length < BN_NEED[n]) BN.failed.push(`${n} has ${e.length} entries, needs ${BN_NEED[n]}`);
}
for (const s of ["settings-empty", "settings-two-bins", "settings-errors", "settings-night-long", "settings-390"]) if (!BN.settings[s]) BN.failed.push(`settings ${s} never ran`);
if (BN.failed.length) process.exitCode = 1;

// ---- Kiosk calendar (kiosk-calendar): the Glance pane `agenda`, the Standard section and the Settings card ----
// results.calendar.{C1..C6,C8,C9} true | false (each needs every entry it was scheduled for; a run that threw leaves it short), results.calendar.entries.<Cx>[],
// results.calendar.states.<key> the measurements, results.calendar.settings.<state> {ok, missing[], present[], ...}, results.calendar.failed[] (one line each).
// Checks (shape brief section 9): C1 pane height <= the band and no inner overflow; C2 pane width <= the carousel's max-w-xl and every cut title ends in an ellipsis;
// C3 pane text >= text-xl (caption and stale tag excepted) and the lead figure = the rail's figure size; C4 Standard: <= 3 rows + 1 more row, section height within P3's allowance,
// no inner scroll (S1), header unchanged (S2), the hub's top moved by no more than the allowance (S3), the hub still starts in the first viewport on the crowded states (S4);
// C5 the section's top border = `border-t border-line`; C6 quiet and unconf leave no node and the dots equal the panes; C8 contrast of the three ink tokens. Check 7 (time strings) is a unit test.
// Shots: calendar-<state>-<size>.png (the band), calendar-std-<state>-<size>.png (the section), calendar-full-<state>-<size>.png, calendar-settings-<state>.png.
// The route is answered per state through visit()'s `routes`; no link, address or host exists in any fixture, and nothing is fetched out.
const CL = (results.calendar = { entries: {}, states: {}, settings: {}, failed: [] });
const CNS = ["C1", "C2", "C3", "C4", "C5", "C6", "C8", "C9", "C10", "C11"];
const cExpected = {};
for (const n of CNS) CL.entries[n] = [];
const cPlan = (n) => { cExpected[n] = (cExpected[n] ?? 0) + 1; };
const cRecord = (n, key, ok, detail = {}) => { CL.entries[n].push({ key, ok, ...detail }); if (!ok) CL.failed.push(`${n} ${key} ${JSON.stringify(detail)}`); };
const cRun = (name, fn) => guarded(`calendar ${name}`, async () => { try { await fn(); } catch (e) { CL.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const cNear = (a, b, tol = 1) => typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const CAL_URL = (theme, std = false) => `${BASE_URL}/kiosk?theme=${theme}&wx=overcast&wxsun=day${std ? "&layout=standard" : ""}`;
// `body` overrides the state's route answer (the Standard baselines ask the same moment with the calendar unset)
const calVisit = (state, url, size, body = CAL_STATES[state].body) => visit(url, {
  viewport: size.viewport, weather: calWeatherFor(state), fixedTime: true, instant: calInstant(CAL_STATES[state].at), ha: true,
  routes: { "/kiosk/api/calendar": body, ...(CAL_STATES[state].crowded ? { "/kiosk/api/bins": BIN_STATES.crowded.body } : {}) },
});

/** The pane's measurements, every number read from the house class it measures (the band, the carousel, `text-xl`, the rail's figure). */
const CAL_PANE = () => {
  const root = document.querySelector("[data-agenda-pane]");
  const track = document.querySelector("div.relative.w-full.overflow-hidden > div.flex.h-full.w-full");
  const panes = track ? [...track.children].filter((c) => !/200%/.test(c.style.transform)).length : null;
  const dots = document.querySelectorAll('button[aria-label^="Show "]').length;
  if (!root) return { present: false, panes, dots };
  const band = root.closest(".overflow-hidden").getBoundingClientRect();
  const carousel = root.parentElement.closest(".max-w-xl");
  const r = root.getBoundingClientRect();
  const probe = Object.assign(document.createElement("span"), { className: "text-xl" });
  root.append(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  const visible = [...root.querySelectorAll("[aria-hidden]")];
  const small = [];
  const cut = [];
  const inner = [];
  for (const el of visible.flatMap((v) => [v, ...v.querySelectorAll("*")])) {
    // only an element that can clip or scroll counts: visible overflow (the leading-none time figure) clips nothing
    if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && getComputedStyle(el).overflowY !== "visible") inner.push(el.textContent.trim().slice(0, 30)); // the sr-only sentence is skipped: it is 1 px high by design
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) cut.push({ text: el.textContent.trim().slice(0, 30), ellipsis: getComputedStyle(el).textOverflow === "ellipsis" });
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !el.closest(".microlabel, .sr-stale") && parseFloat(getComputedStyle(el).fontSize) < floor - 0.01) small.push(`${el.textContent.trim().slice(0, 20)} ${getComputedStyle(el).fontSize}`);
  }
  // C9: the horizontal centre of each row's text box (a row's children for the two flex rows; the text range for the count line, its box when it is cut) against the pane's
  const mid = (b) => (b.left + b.right) / 2;
  const rowMid = (row) => { const k = [...row.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0); return k.length ? (Math.min(...k.map((b) => b.left)) + Math.max(...k.map((b) => b.right))) / 2 : null; };
  const [capRow, leadRow, moreRow] = [...root.children].filter((c) => c.hasAttribute("aria-hidden"));
  const textMid = (el) => { if (el.scrollWidth > el.clientWidth + 1) return mid(el.getBoundingClientRect()); const g = document.createRange(); g.selectNodeContents(el); return mid(g.getBoundingClientRect()); };
  const lead = leadRow ? [...leadRow.children].find((c) => c.className.includes("truncate")) : null;
  const align = { pane: mid(r), caption: capRow ? rowMid(capRow) : null, lead: leadRow ? rowMid(leadRow) : null, more: moreRow ? textMid(moreRow) : null,
    leadCut: lead ? lead.scrollWidth > lead.clientWidth + 1 : false, leadEllipsis: lead ? getComputedStyle(lead).textOverflow === "ellipsis" : null, leadPx: lead ? parseFloat(getComputedStyle(lead).fontSize) : null };
  const fig = root.querySelector("[data-agenda-figure]");
  const railHi = document.querySelector('[data-testid="kiosk-forecast-rail"] .sr-fc-hi');
  return {
    present: true, panes, dots, align,
    text: visible.map((v) => v.textContent).join(" | "),
    bandH: Math.round(band.height * 10) / 10, paneH: Math.round(r.height * 10) / 10,
    carouselW: Math.round(carousel.getBoundingClientRect().width * 10) / 10, paneW: Math.round(r.width * 10) / 10,
    cut, small, inner, floor,
    figurePx: fig ? parseFloat(getComputedStyle(fig).fontSize) : null,
    railPx: railHi ? parseFloat(getComputedStyle(railHi).fontSize) : null,
    staleTags: root.querySelectorAll(".sr-stale").length, staleInCaption: [...root.querySelectorAll(".sr-stale")].filter((t) => t.parentElement?.querySelector(":scope > .microlabel")).length,
    clip: { x: Math.max(0, band.left - 8), y: Math.max(0, band.top - 8), width: band.width + 16, height: band.height + 52 },
  };
};

/** The Standard section and what it pushes: the hub's top (as the bins checks read it), the header, the border. */
const CAL_STD = () => {
  const sec = document.querySelector("[data-calendar-section]");
  const anchor = document.querySelector("[data-weather-line]") ?? document.querySelector("[data-weather-datums]");
  const root = anchor ? document.querySelector(".max-w-6xl.grid-cols-12") : null; // the board grid (the weather line lives in the hero now)
  const out = {
    nodes: document.querySelectorAll("[data-calendar-section]").length, rendered: !!document.querySelector("[data-kiosk-theme]"), vh: innerHeight,
    header: document.querySelector("header")?.getBoundingClientRect().height ?? null,
    hubTop: root && root.lastElementChild ? root.lastElementChild.getBoundingClientRect().top : null,
  };
  // C11: the board's cells (direct section.panel children of the grid) by heading: Today and Climate share row 1, Lights starts row 2
  const cellOf = (name) => (root ? [...root.querySelectorAll(":scope > section.panel")].find((x) => new RegExp(`^${name}`, "i").test((x.querySelector("h2")?.textContent ?? "").trim())) : null);
  const [tc, cc, lc] = [cellOf("today"), cellOf("climate"), cellOf("lights")].map((el) => (el ? el.getBoundingClientRect() : null));
  out.hub = { today: tc && { bottom: tc.bottom }, climate: cc && { bottom: cc.bottom, gapToToday: tc ? cc.left - tc.right : null }, lights: lc && { gapToRow1: tc && cc ? lc.top - Math.max(tc.bottom, cc.bottom) : null } };
  if (!sec) return out;
  const r = sec.getBoundingClientRect();
  const cs = getComputedStyle(sec);
  const ref = Object.assign(document.createElement("div"), { className: "border-t border-line" });
  sec.parentElement.append(ref);
  const rs = getComputedStyle(ref);
  const border = { w: cs.borderTopWidth, color: cs.borderTopColor, refW: rs.borderTopWidth, refColor: rs.borderTopColor };
  ref.remove();
  const inner = [];
  for (let el = sec; el && el.tagName !== "MAIN" && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible") inner.push(el.tagName);
  }
  for (const el of sec.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible") inner.push(el.tagName);
  const clipped = [...sec.querySelectorAll("[data-agenda-row] > span")].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => ({ text: s.textContent.slice(0, 30), ellipsis: getComputedStyle(s).textOverflow === "ellipsis" }));
  return {
    ...out, text: sec.innerText, h: r.height, rows: sec.querySelectorAll("[data-agenda-row]").length, more: sec.querySelectorAll("[data-agenda-more]").length,
    heading: sec.closest("section.panel")?.querySelector("h2")?.tagName ?? null, staleTags: (sec.closest("section.panel") ?? sec).querySelectorAll(".sr-stale").length, border, inner, clipped,
    clip: { x: Math.max(0, r.left - 16), y: Math.max(0, r.top + scrollY - 8), width: r.width + 32, height: r.height + 24 },
  };
};

// ---- the glance pane ----
const CAL_PANE_STATES = ["ordinary", "on-now", "tomorrow-only", "crowded", "six-four", "long-title", "mixed", "gaps", "stale"];
const CAL_PANE_ABSENT = ["quiet", "unconf", "failed"];
const CAL_THEMES = [{ theme: "folio", state: "ordinary" }, { theme: "default", state: "ordinary" }];
const calPane = async (key, state, theme, size) => {
  const def = CAL_STATES[state];
  const present = def.pane !== false;
  if (present) for (const n of ["C1", "C2", "C3"]) cPlan(n);
  else cPlan("C6");
  if (present && def.stale && theme === "sunroom") cPlan("C1"); // the one-stale-tag entry
  if (present && state === "crowded") cPlan("C9");
  if (present && state === "long-title") cPlan("C10");
  await cRun(`pane ${key}`, async () => {
    const { context, page } = await calVisit(state, CAL_URL(theme), size);
    await page.locator('button[aria-label="Show Calendar"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(700);
    const m = await page.evaluate(CAL_PANE);
    CL.states[`pane-${key}`] = m;
    if (!present) {
      cRecord("C6", `pane-${key}`, !m.present && m.panes === m.dots && !(await crashed(page)), { present: m.present, panes: m.panes, dots: m.dots, expect: "no pane, dots equal panes" });
      await context.close();
      return;
    }
    const t = textHas(m.text ?? "", def.want, def.not);
    if (!m.present || t.missing.length || t.present.length) CL.failed.push(`pane ${key} text ${JSON.stringify({ present: m.present, ...t })}`);
    if (m.present) {
      cRecord("C1", `pane-${key}`, m.paneH <= m.bandH && m.inner.length === 0, { paneH: m.paneH, bandH: m.bandH, inner: m.inner });
      cRecord("C2", `pane-${key}`, m.paneW <= m.carouselW + 0.5 && m.cut.every((c) => c.ellipsis), { paneW: m.paneW, carouselW: m.carouselW, cut: m.cut });
      cRecord("C3", `pane-${key}`, m.small.length === 0 && m.figurePx !== null && m.figurePx === m.railPx, { floor: m.floor, small: m.small, figurePx: m.figurePx, railPx: m.railPx });
      if (state === "crowded") {
        const a = m.align;
        const centred = [a.caption, a.lead, a.more].every((x) => cNear(x, a.pane, 1)); // 1 px rounding tolerance
        cRecord("C9", `pane-${key}`, centred && (!a.leadCut || a.leadEllipsis === true), a);
      }
      // C10: the long-title fixture really truncates: the lead's text is wider than its box and shows an ellipsis
      if (state === "long-title") cRecord("C10", `pane-${key}`, m.align.leadCut === true && m.align.leadEllipsis === true, { leadCut: m.align.leadCut, leadEllipsis: m.align.leadEllipsis });
      if (def.stale && theme === "sunroom") cRecord("C1", `pane-${key} one stale tag`, m.staleTags === 1 && m.staleInCaption === 1, { staleTags: m.staleTags, staleInCaption: m.staleInCaption });
      await page.screenshot({ path: join(OUT_DIR, `calendar-${key}.png`), clip: m.clip });
    }
    await context.close();
  });
};
for (const size of SIZES) for (const state of [...CAL_PANE_STATES, ...CAL_PANE_ABSENT]) await calPane(`${state}-${size.name}`, state, "sunroom", size);
for (const t of CAL_THEMES) await calPane(`${t.state}-${t.theme}`, t.state, t.theme, SIZES[1]);

// ---- Standard ----
const calBase = {};
const calWake = async (page, size, state) => {
  if (state !== "woken-night") return;
  await page.mouse.click(size.viewport.width / 2, size.viewport.height / 2); // a wake tap: Standard then runs as "day"
  await page.waitForTimeout(800);
};
const calBaseline = async (state, size, theme) => {
  const def = CAL_STATES[state];
  const key = `${def.at}|${def.crowded ? 1 : 0}|${size.name}|${theme}`;
  if (!calBase[key]) {
    const { context, page } = await calVisit(state, CAL_URL(theme, true), size, { status: "unconfigured" });
    await calWake(page, size, state);
    calBase[key] = await page.evaluate(CAL_STD);
    await context.close();
  }
  return calBase[key];
};
const calStd = async (key, state, theme, size) => {
  const def = CAL_STATES[state];
  const absent = ["quiet", "unconf"].includes(state);
  if (absent) cPlan("C6");
  else for (const n of ["C4", "C5"]) cPlan(n);
  if (def.stale && theme === "sunroom") cPlan("C4"); // the one-stale-tag entry
  if (state === "crowded" && theme === "sunroom") cPlan("C11");
  await cRun(`standard ${key}`, async () => {
    const { context, page } = await calVisit(state, CAL_URL(theme, true), size);
    await calWake(page, size, state);
    const m = await page.evaluate(CAL_STD);
    CL.states[`std-${key}`] = m;
    if (absent) {
      cRecord("C6", `std-${key}`, m.nodes === 0 && m.rendered && !(await crashed(page)), { nodes: m.nodes, rendered: m.rendered });
      await context.close();
      return;
    }
    const t = textHas(m.text ?? "", def.failedLine ? ["Calendar unavailable."] : def.std, def.failedLine ? [] : ["Calendar unavailable."]);
    if (m.nodes !== 1 || t.missing.length || t.present.length) CL.failed.push(`std ${key} text ${JSON.stringify({ nodes: m.nodes, ...t })}`);
    const base = await calBaseline(state, size, theme);
    const n = m.rows + m.more;
    const allowance = 97 + 24 * (n - 2); // P3 S3: 2 rows 97 px, 4 rows 145 px (a row is text-sm 20 + space-y-1 4)
    const shift = typeof m.hubTop === "number" && typeof base.hubTop === "number" ? m.hubTop - base.hubTop : null;
    const rowsOk = def.failedLine ? m.rows === 0 && m.more === 0 : m.rows === def.rows && m.more === (def.more ? 1 : 0) && m.rows <= 3 && m.more <= 1;
    cRecord("C4", `std-${key}`,
      rowsOk && m.heading === "H2" && m.inner.length === 0 && m.clipped.every((c) => c.ellipsis) && cNear(m.header, base.header, 1)
        && (def.failedLine || (shift !== null && shift <= allowance + 1)) && (!def.crowded || size.name !== "1024x768" || (typeof m.hubTop === "number" && m.hubTop < m.vh)),
      { rows: m.rows, more: m.more, want: { rows: def.rows ?? 0, more: def.more ? 1 : 0 }, heading: m.heading, inner: m.inner, clipped: m.clipped, header: m.header, baseHeader: base.header, shift, allowance, hubTop: m.hubTop, vh: m.vh });
    cRecord("C5", `std-${key}`, parseFloat(m.border.w) === 0, m.border); // the agenda has no top rule inside the Today cell
    if (def.stale && theme === "sunroom") cRecord("C4", `std-${key} one stale tag`, m.staleTags === 1, { staleTags: m.staleTags });
    if (state === "crowded" && theme === "sunroom") {
      // C11: Climate shares Today's row (equal bottoms, one board gap between them) and Lights starts one board gap below row 1
      const c = m.hub?.climate, l = m.hub?.lights, t = m.hub?.today;
      cRecord("C11", `std-${key}`, !!c && !!l && !!t && cNear(c.bottom, t.bottom, 1) && cNear(c.gapToToday, 12, 1) && cNear(l.gapToRow1, 12, 1), { climate: c, lights: l, today: t });
    }
    await page.screenshot({ path: join(OUT_DIR, `calendar-std-${key}.png`), fullPage: true, clip: m.clip });
    if (theme === "sunroom" && ["crowded", "six-four", "ordinary"].includes(state)) await page.screenshot({ path: join(OUT_DIR, `calendar-full-${key}.png`), fullPage: true });
    await context.close();
  });
};
for (const size of SIZES) for (const state of Object.keys(CAL_STATES)) await calStd(`${state}-${size.name}`, state, "sunroom", size);
for (const t of CAL_THEMES) await calStd(`${t.state}-${t.theme}`, t.state, t.theme, SIZES[1]);

// C8 runs in node (no page): the three ink tokens on bg, panel and panel-2 in every theme and sunroom stop
cPlan("C8");
await cRun("C8 contrast", async () => {
  const c = await uvContrast(["ink", "ink-dim", "ink-faint"]);
  cRecord("C8", "contrast", c.pass && c.unresolved.length === 0, { checked: c.checked, lowest: c.lowest, failures: c.failures, unresolved: c.unresolved });
});

// ---- the Settings card: GET /api/settings is answered here and the save is mocked, so no link is typed or stored anywhere ----
// The settings page sits behind the login: each state signs in on its own context (the test stack takes any password).
const CAL_INTRO = "The private link from your calendar's sharing settings";
async function calSettings(name, status, { viewport = { width: 1024, height: 768 }, drive = null, saveReply = { status: 200, json: { ok: true } }, want = [], not = [], mark = null, after = null } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: ZONE });
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  await context.clock.setFixedTime(new Date(calInstant("19:00")));
  const page = await context.newPage();
  page.on("pageerror", (e) => { pageErrors++; CL.failed.push(`settings ${name} pageerror ${String(e?.message ?? e).slice(0, 120)}`); });
  await page.route((u) => u.pathname === "/api/settings", (r) => (r.request().method() === "GET" ? r.fulfill({ json: settingsFullFor(null, status) }) : r.fallback()));
  await page.route((u) => u.pathname === "/api/settings/integrations", (r) => (r.request().method() === "POST" ? r.fulfill(saveReply) : r.fallback()));
  const intro = page.getByText(CAL_INTRO);
  try {
    await page.goto(`${BASE_URL}/settings#calendar`, { waitUntil: "domcontentloaded" });
    await intro.waitFor({ state: "attached", timeout: 20_000 });
    if (!(await intro.isVisible().catch(() => false))) await page.getByRole("button", { name: /Calendar/ }).first().click().catch(() => {});
    await intro.waitFor({ state: "visible", timeout: 10_000 });
  } catch (err) {
    await page.screenshot({ path: join(OUT_DIR, `calendar-settings-${name}-FAILED.png`), fullPage: true }).catch(() => {});
    CL.failed.push(`settings ${name} FAILED ${page.url()}`);
    throw err;
  }
  await page.waitForTimeout(600);
  if (drive) await drive(page);
  await page.waitForTimeout(300);
  const t = textHas(await page.evaluate(() => document.body.innerText), want, not);
  const extra = mark ? await mark(page) : {};
  const textOk = t.missing.length === 0 && t.present.length === 0;
  CL.settings[name] = { ...t, ...extra, ok: textOk && extra.ok !== false };
  if (!textOk) CL.failed.push(`settings ${name} ${JSON.stringify(t)}`);
  if (extra.ok === false) CL.failed.push(`settings ${name} ${JSON.stringify(extra)}`);
  await page.screenshot({ path: join(OUT_DIR, `calendar-settings-${name}.png`), fullPage: true });
  if (after) { const a = await after(page); CL.settings[name].after = a; if (a.ok !== true) CL.failed.push(`settings ${name} after ${JSON.stringify(a)}`); }
  await context.close();
}
// every helper is scoped to the card (its intro's parent), as binCard is: the page holds other Save buttons, fields and Test buttons
const calCard = (page) => page.getByText(CAL_INTRO).locator("..");
const calField = (page) => calCard(page).getByLabel("Private calendar link");
const calSave = (page) => calCard(page).getByRole("button", { name: "Save" });
const calFieldFacts = (page) => calField(page).evaluate((i) => ({ placeholder: i.placeholder, maxLength: i.maxLength, type: i.type, value: i.value, describedBy: i.getAttribute("aria-describedby") }));
const calTypeAndSave = async (page) => { await calField(page).fill(CAL_DRAFT); await calSave(page).click(); await page.waitForTimeout(500); };
/** The error span the field points at: shown whole (not cut to an ellipsis) and in the bad tone. */
const calErrorFacts = (page) => calField(page).evaluate((i) => {
  const e = i.getAttribute("aria-describedby") ? document.getElementById(i.getAttribute("aria-describedby")) : null;
  return e ? { text: e.textContent, whole: e.scrollWidth <= e.clientWidth + 1, tone: getComputedStyle(e).color } : null;
});
const CAL_SET_STATES = ["settings-empty", "settings-configured", "settings-error", "settings-warn", "settings-replace", "settings-390"];
await cRun("settings empty", () => calSettings("settings-empty", CAL_SETTINGS.empty, {
  want: ["PRIVATE CALENDAR LINK"], not: [CAL_LONGEST_ERROR, "Calendar connected", "Not syncing"], // innerText gives a Label as the CSS upper-cases it
  mark: async (page) => { const f = await calFieldFacts(page); return { ok: f.placeholder === "Paste the private calendar link" && f.maxLength === 2048 && f.type === "password" && (await calSave(page).isDisabled()), ...f }; },
}));
await cRun("settings configured", () => calSettings("settings-configured", CAL_SETTINGS.configured, {
  want: ["configured · last saved", "Calendar connected · 14 events this week", "Replace", "Clear"], not: ["Not syncing", CAL_LONGEST_ERROR],
  mark: async (page) => { const n = await calCard(page).getByRole("button", { name: /^Test/ }).count(); return { ok: n === 0, testButtons: n }; }, // Save is the test
}));
await cRun("settings error", () => calSettings("settings-error", CAL_SETTINGS.empty, {
  saveReply: { status: 400, json: { error: CAL_LONGEST_ERROR } }, drive: calTypeAndSave, want: [CAL_LONGEST_ERROR],
  mark: async (page) => {
    const e = await calErrorFacts(page); const f = await calFieldFacts(page);
    const alertOk = (await calCard(page).locator("[role=alert]").count()) === 1 && (await calField(page).getAttribute("aria-invalid")) === "true";
    return { ok: !!e && e.text === CAL_LONGEST_ERROR && e.whole && f.value === CAL_DRAFT && !!f.describedBy && alertOk, error: e, draftKept: f.value === CAL_DRAFT, alertOk };
  },
}));
await cRun("settings warn", () => calSettings("settings-warn", CAL_SETTINGS.warn, {
  want: ["Not syncing since Thu 2:40 pm: the calendar refused the link (copy a fresh private link and Replace)."], not: ["Calendar connected"],
  mark: async (page) => page.getByText(/^Not syncing since/).evaluate((el) => ({ ok: el.className.includes("text-warn"), className: el.className })),
}));
await cRun("settings replace", () => calSettings("settings-replace", CAL_SETTINGS.replace, {
  drive: (page) => page.getByRole("button", { name: "Replace" }).click(), want: ["Cancel", "Clear", "Calendar connected · 14 events this week"],
  mark: async (page) => { const f = await calFieldFacts(page); const on = await focusOf(page); return { ok: f.placeholder === "Paste the new link" && !(await calSave(page).isDisabled()) && on.tag === "INPUT" && on.ph === "Paste the new link", focusAfterReplace: on, ...f }; }, // blank keeps the saved link, so Save stays on; Replace sent focus to the field
  after: async (page) => {
    await calCard(page).getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(200);
    const on = await focusOf(page);
    const labelled = (await calCard(page).getByRole("button", { name: "Clear calendar link" }).count()) === 1;
    return { ok: on.tag === "BUTTON" && on.text === "Replace" && labelled, focusAfterCancel: on, labelled };
  },
}));
await cRun("settings 390", () => calSettings("settings-390", CAL_SETTINGS.empty, {
  viewport: { width: 390, height: 844 }, saveReply: { status: 400, json: { error: CAL_LONGEST_ERROR } }, drive: calTypeAndSave, want: [CAL_LONGEST_ERROR],
  // the longest error wraps whole, and the page does not scroll sideways
  mark: async (page) => { const e = await calErrorFacts(page); const w = await page.evaluate(() => document.documentElement.scrollWidth); return { ok: !!e && e.whole && w <= 390, error: e, pageScrollW: w }; },
}));
for (const s of CAL_SET_STATES) if (!CL.settings[s]) CL.failed.push(`settings ${s} never ran`);

for (const n of CNS) {
  const e = CL.entries[n];
  CL[n] = e.length >= (cExpected[n] ?? 0) && e.every((x) => x.ok);
  if (e.length < (cExpected[n] ?? 0)) CL.failed.push(`${n} has ${e.length} entries, needs ${cExpected[n]}`);
}
if (CL.failed.length) process.exitCode = 1;

// ---- typeface coverage (type PR 1, spec checks 1 and 2): Sunroom follows the per-device Typeface selection ----
// "kiosk-fonts" is {[theme]: {sans?, mono?}} (src/lib/kiosk-fonts.ts). Lexend and Roboto Mono, as the spec names them (Roboto Mono joined the catalog in type PR 2).
const TF = { failed: [], states: {} };
results.typeface = TF;
const TF_OVERRIDE = `localStorage.setItem("kiosk-fonts", ${JSON.stringify(JSON.stringify({ sunroom: { sans: "lexend", mono: "roboto-mono" } }))})`;
const TF_SANS = "button.sr-chip-sm, [data-sr-title], [data-sr-face] p, .microlabel, .sr-pin-msg, .sr-word, [data-rain-zone=clock] > [data-sr-live]"; // selector list, each tested only in the state that renders it
const TF_MONO = "button.sr-btn, button.sr-btn-nudge, [data-sr-face] .font-mono, [data-sr-num], [data-rain-zone=clock] > [data-sr-live]"; // [data-sr-num]: weather line, climate value and target, time chip, scene status
/** First computed family of every match of each selector, against the first family the slot's `--font-t-*` var resolves to. */
const tfRead = (page, probes) => page.evaluate(async (list) => {
  await document.fonts.ready;
  const scope = document.querySelector('[data-kiosk-theme="sunroom"]');
  const first = (v) => v.split(",")[0].trim();
  const want = (cssVar) => { const d = document.createElement("div"); d.style.fontFamily = `var(${cssVar})`; scope.appendChild(d); const f = first(getComputedStyle(d).fontFamily); d.remove(); return f; };
  return list.map(({ sel, cssVar, alsoVar }) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
    const expected = want(cssVar);
    // paint check: the name matching is not enough. The first family must have a loaded @font-face (a named but unloaded family, or a system-only name, paints in a fallback).
    const bare = (f) => f.replace(/^["']|["']$/g, "");
    const unpainted = new Set();
    for (const e of els) {
      const cs = getComputedStyle(e), fam = first(cs.fontFamily);
      const loaded = [...document.fonts].some((f) => bare(f.family) === bare(fam) && f.status === "loaded") && document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${fam}`);
      if (!loaded) unpainted.add(`${cs.fontWeight} ${fam}`);
    }
    return { sel, expected, also: alsoVar ? want(alsoVar) : null, found: els.length, got: [...new Set(els.map((e) => first(getComputedStyle(e).fontFamily)))], unpainted: [...unpainted] };
  });
}, probes);
/** One state: record every selector that renders; a selector that renders with any other family fails the check. */
function tfRecord(check, state, rows, need) {
  TF.states[`${check}:${state}`] = rows;
  for (const n of need) if (!rows.some((r) => r.sel === n && r.found)) TF.failed.push(`${check} ${state}: ${n} not rendered`);
  for (const r of rows) if (r.found && r.got.some((g) => g !== r.expected && g !== r.also)) TF.failed.push(`${check} ${state}: ${r.sel} is ${r.got.join("|")}, want ${r.expected}${r.also ? ` or ${r.also}` : ""}`);
  for (const r of rows) if (r.found && r.unpainted.length) TF.failed.push(`${check} ${state}: ${r.sel} not painted in its face (no loaded @font-face: ${r.unpainted.join("|")})`);
  // .microlabel sits on text and numeral elements by design: either face passes, but one must be the text face
  for (const r of rows) if (r.also && r.found && !r.got.includes(r.expected)) TF.failed.push(`${check} ${state}: ${r.sel} has no ${r.expected} element`);
}
for (const [check, init, sansVar, monoVar, tag] of [
  ["check1", TF_OVERRIDE, "--font-t-lexend", "--font-t-roboto-mono", "override"],
  ["check2", null, "--font-t-sunroom-sans", "--font-t-sunroom-mono", "default"],
]) {
  const probes = [...TF_SANS.split(", ").map((sel) => ({ sel, cssVar: sel.includes("clock") ? monoVar : sansVar, alsoVar: sel === ".microlabel" ? monoVar : null })), ...TF_MONO.split(", ").filter((s) => !s.includes("clock")).map((sel) => ({ sel, cssVar: monoVar }))];
  const shoot = (page, name) => (tag === "override" ? page.screenshot({ path: join(OUT_DIR, `typeface-sunroom-${name}-1024x768.png`) }) : null);
  await guarded(`typeface ${check} glance`, async () => {
    const { context, page } = await visit(MAIN_URL, { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, initScript: init });
    tfRecord(check, "glance", await tfRead(page, probes), ["[data-rain-zone=clock] > [data-sr-live]"]);
    await shoot(page, "glance");
    await context.close();
  });
  await guarded(`typeface ${check} standard`, async () => {
    const { context, page } = await visit(CONTROLS_URL, { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true, initScript: init });
    await seen(page, ".sr-climate", 15_000);
    const stdRows = await tfRead(page, probes);
    tfRecord(check, "standard", stdRows, ["button.sr-btn-nudge"]);
    if ((stdRows.find((r) => r.sel === "[data-sr-num]")?.found ?? 0) < 4) TF.failed.push(`${check} standard: fewer than 4 [data-sr-num] numerals rendered`);
    await shoot(page, "standard");
    // a sheet: the climate modal's title, copy, microlabels and numerals
    const modal = OVERLAY_STATES.find((s) => s.key === "climateModal");
    const r = await withOverlay(page, modal, async () => {
      tfRecord(check, "sheet", await tfRead(page, probes), ["[data-sr-title]", ".microlabel"]);
      await shoot(page, "sheet");
      return {};
    });
    if (r.missing) TF.failed.push(`${check} sheet: ${r.missing}`);
    // the PIN pad: the message line (digits follow the controls row)
    const pin = OVERLAY_STATES.find((s) => s.key === "pin");
    const p = await withOverlay(page, pin, async () => {
      tfRecord(check, "pin", await tfRead(page, probes), [".sr-pin-msg"]);
      await shoot(page, "pin");
      return {};
    });
    if (p.missing) TF.failed.push(`${check} pin: ${p.missing}`);
    await context.close();
  });
}
if (TF.failed.length) process.exitCode = 1;

// ---- more typefaces (type PR 2, spec section 5 checks 4, 7, 8 and 9) ----
// Keys: results.typefaces.{failed[], states{}, widths{}, reported[]}. Every check records a failure when false; an error inside one also lands in failed (never skipped).
// The font list is read from src/lib/kiosk-fonts.ts, so a family added later is measured with no edit here.
const TP = { failed: [], states: {}, widths: {}, reported: [] };
results.typefaces = TP;
const FONTS_SRC = readFileSync(new URL("../src/lib/kiosk-fonts.ts", import.meta.url), "utf8");
const TP_FONTS = [...FONTS_SRC.matchAll(/\{ id: "([a-z-]+)", label: "[^"]+", kind: "(sans|serif|mono)", cssVar: ['"]var\((--font-t-[a-z-]+)\)/g)].map(([, id, kind, cssVar]) => ({ id, kind, cssVar }));
const TP_MONO_DEFAULTS = new Set([...FONTS_SRC.matchAll(/mono: "([a-z-]+)" \}/g)].map((m) => m[1])); // the five serif Numerals defaults ride along
const TP_TEXT = TP_FONTS.filter((f) => f.kind !== "mono");
const TP_NUMERALS = TP_FONTS.filter((f) => f.kind === "mono" || TP_MONO_DEFAULTS.has(f.id));
const tpRun = (name, fn) => guarded(`typefaces ${name}`, async () => { try { await fn(); } catch (e) { TP.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const tpWant = (name, ok, detail) => { TP.states[name] = detail; if (!ok) TP.failed.push(`${name} ${JSON.stringify(detail)}`); };
/** Advance widths: each job is one family, one sample list, one `--sr-type-*` token; the face is loaded first so a fallback never gets measured. */
const tpWidths = (page, jobs) => page.evaluate(async (list) => {
  const scope = document.querySelector('[data-kiosk-theme="sunroom"]');
  const out = [];
  for (const { id, cssVar, token, samples } of list) {
    const el = document.createElement("span");
    el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:var(--sr-type-${token});letter-spacing:var(--sr-track-${token});font-family:var(${cssVar}),monospace;font-variant-numeric:tabular-nums`;
    scope.appendChild(el);
    const cs = getComputedStyle(el);
    const widths = [];
    let error = null;
    for (const s of samples) {
      el.textContent = s;
      // the chosen face only: the list also holds next/font's "<Face> Fallback", whose local() source is absent in the capture browser and rejects the whole load
      const spec = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(",")[0]}`;
      // a NetworkError names no family: retry once, then report this family and go on
      try { await document.fonts.load(spec, s); } catch { try { await document.fonts.load(spec, s); } catch (e) { error = String(e?.message ?? e); break; } }
      widths.push(el.getBoundingClientRect().width);
    }
    el.remove();
    out.push(error ? { id, error } : { id, widths });
  }
  return out;
}, jobs);
/** One state's layout numbers (check 7): horizontal overflow per pane, inner scrollers, text clipped without an ellipsis, and what sits above the fold. */
const TP_LAYOUT = () => {
  const shown = (e) => e.getClientRects().length > 0;
  const panes = [...new Set([...document.querySelectorAll("[data-sr-face], [data-lists-pane], [data-rain-zone], main section")].filter(shown))];
  const all = [...document.querySelectorAll("body *")].filter(shown);
  const hasText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  return {
    panes: panes.length,
    paneOverflowX: panes.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    innerScroll: all.filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).length,
    clipped: all.filter((e) => { const s = getComputedStyle(e); return hasText(e) && /hidden|clip/.test(s.overflowX) && s.textOverflow !== "ellipsis" && e.scrollWidth > e.clientWidth + 1; }).length,
    aboveFold: all.filter((e) => e.matches("button, [data-sr-title], [data-sr-face] p")).filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length,
    docOverflowX: document.documentElement.scrollWidth - innerWidth,
  };
};
/** The admin PIN flow the "overlays elevated" visit uses, then the Typeface tab. */
async function tpOpenTypeface(viewport) {
  const v = await visit(CONTROLS_URL, { viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
  const { page } = v;
  await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { ok: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }) : route.fallback()));
  await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: { elevated: true, expiresAt: Date.parse(PINNED_ISO) + 120_000 } }));
  const admin = page.getByRole("button", { name: /^Admin/ }).first();
  if (!(await admin.count())) throw new Error("Admin button not found");
  await admin.click();
  await seen(page, "[role=dialog]", 5000);
  for (const d of "0000") await page.getByRole("button", { name: `digit ${d}` }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: "Typeface" }).click();
  if (!(await seen(page, "#kiosk-tabpanel-typeface", 5000))) throw new Error("Typeface tab panel not found");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  return v;
}

// check 8 and the widest pair: measured once, on Sunroom at 1024x768
let TP_WIDEST = null;
await tpRun("widths", async () => {
  const { context, page } = await visit(MAIN_URL, { viewport: SIZES[1].viewport, weather: weatherFor("midday"), fixedTime: true, ha: true });
  const rawText = await tpWidths(page, TP_TEXT.map((f) => ({ ...f, token: "body", samples: ["Wednesday 28 Thermostat"] })));
  const rawNums = await tpWidths(page, TP_NUMERALS.map((f) => ({ ...f, token: "clock", samples: ["88:88", "11:11"] })));
  await context.close();
  // a family that fails to load stays a failed check, but never hides the rest
  for (const r of [...rawText, ...rawNums]) if (r.error) TP.failed.push(`widths ${r.id}: font failed to load (${r.error})`);
  const text = rawText.filter((r) => !r.error);
  const nums = rawNums.filter((r) => !r.error);
  for (const t of text) TP.widths[`text:${t.id}`] = Math.round(t.widths[0] * 10) / 10;
  for (const n of nums) TP.widths[`numerals:${n.id}`] = { "88:88": Math.round(n.widths[0] * 10) / 10, "11:11": Math.round(n.widths[1] * 10) / 10 };
  const widest = (rows, w) => rows.reduce((a, b) => (w(b) > w(a) ? b : a)).id;
  TP_WIDEST = { sans: widest(text, (t) => t.widths[0]), mono: widest(nums, (n) => n.widths[0]) };
  TP.states.widest = TP_WIDEST;
  // check 8: tabular figures, 11:11 as wide as 88:88 within 1 px; the serif theme defaults are reported, not failed (spec section 2)
  for (const n of nums) {
    const d = Math.abs(n.widths[0] - n.widths[1]);
    const kind = TP_FONTS.find((f) => f.id === n.id).kind;
    if (d <= 1) TP.states[`check8:${n.id}`] = { diff: d };
    // Orbitron and Silkscreen are display faces that predate this check and have no equal-width digits: reported (board card nw-clock-width-display-faces), not failed
    else if (kind === "mono" && !["neon-mono", "pixel-mono"].includes(n.id)) tpWant(`check8:${n.id}`, false, { diff: d });
    else TP.reported.push(`check8 ${n.id} (${kind} theme default): 11:11 differs from 88:88 by ${d.toFixed(2)} px`);
  }
});

// check 7: 1024x768, the crowded Shopping list in the Glance and Standard layouts, the widest Text and Numerals faces, Sunroom and the default theme
if (TP_WIDEST) {
  const override = `localStorage.setItem("kiosk-fonts", ${JSON.stringify(JSON.stringify({ sunroom: TP_WIDEST, default: TP_WIDEST }))})`;
  for (const theme of ["sunroom", "default"]) {
    for (const layout of ["glance", "standard"]) {
      const url = `${MAIN_URL.replace("theme=sunroom", `theme=${theme}`)}${layout === "standard" ? "&layout=standard" : ""}`;
      const seen7 = {};
      for (const tag of ["base", "widest"]) {
        await tpRun(`check7 ${theme} ${layout} ${tag}`, async () => {
          const v = await listVisit({ body: LIST_STATES.crowded.body }, { url, size: SIZES[1], initScript: tag === "widest" ? override : null });
          try {
            await v.page.waitForTimeout(1500);
            await v.page.evaluate(() => document.fonts.ready);
            seen7[tag] = await v.page.evaluate(TP_LAYOUT);
            if (tag === "widest") await v.page.screenshot({ path: join(OUT_DIR, `typeface-${theme}-${layout}-widest-1024x768.png`) });
          } finally { await v.context.close(); }
        });
      }
      const [b, w] = [seen7.base, seen7.widest];
      if (b && w) tpWant(`check7:${theme}-${layout}`, w.panes > 0 && w.paneOverflowX <= b.paneOverflowX && w.innerScroll <= b.innerScroll && w.clipped <= b.clipped && w.aboveFold >= b.aboveFold && w.docOverflowX <= Math.max(0, b.docOverflowX), { base: b, widest: w, faces: TP_WIDEST });
    }
  }
}

// checks 4 and 9: the Typeface tab at 1180x820 and 390 px (Sunroom, day), where the chips and rows are measured and captured
for (const size of [{ name: "1180x820", viewport: SIZES[0].viewport }, { name: "390", viewport: { width: 390, height: 844 } }]) {
  await tpRun(`typeface tab ${size.name}`, async () => {
    const { context, page } = await tpOpenTypeface(size.viewport);
    const m = await page.evaluate(() => {
      const panel = document.querySelector("#kiosk-tabpanel-typeface");
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;height:var(--sr-hit-min)";
      document.querySelector("[data-kiosk-theme]").appendChild(probe);
      const hitMin = probe.getBoundingClientRect().height;
      probe.remove();
      const chips = [...panel.querySelectorAll("button[aria-pressed]")];
      const rows = [...panel.querySelectorAll(".flex-wrap")];
      const tabs = document.querySelector('[role=tablist][aria-label="Personalisation"]');
      return {
        hitMin,
        chipCount: chips.length,
        shortest: Math.min(...chips.map((c) => c.getBoundingClientRect().height)),
        names: chips.map((c) => c.textContent.replace("· default", "").trim()),
        defaults: chips.filter((c) => c.textContent.includes("· default")).length,
        rows: rows.length,
        rowsWrap: rows.every((r) => getComputedStyle(r).flexWrap === "wrap"),
        rowsFit: rows.every((r) => r.scrollWidth <= r.clientWidth + 1),
        tabsFit: tabs.scrollWidth <= tabs.clientWidth + 1,
        docOverflowX: document.documentElement.scrollWidth - innerWidth,
      };
    });
    const NEW = ["Atkinson Hyperlegible Next", "Nunito", "Geist", "Atkinson Hyperlegible Mono", "Geist Mono", "Roboto Mono"];
    tpWant(`new faces offered ${size.name}`, NEW.every((n) => m.names.includes(n)) && m.rows === 3 && m.defaults === 2, { names: m.names, rows: m.rows, defaults: m.defaults });
    tpWant(`check4 ${size.name}`, m.shortest >= 44 && m.shortest >= m.hitMin, { shortest: m.shortest, hitMin: m.hitMin, chips: m.chipCount });
    if (size.name === "390") tpWant("check9", m.rowsWrap && m.rowsFit && m.tabsFit && m.docOverflowX <= 0, { rowsWrap: m.rowsWrap, rowsFit: m.rowsFit, tabsFit: m.tabsFit, docOverflowX: m.docOverflowX });
    await page.locator("#kiosk-tabpanel-typeface").locator("xpath=..").screenshot({ path: join(OUT_DIR, `typeface-tab-sunroom-day-${size.name}.png`) });
    await context.close();
  });
}
if (TP.failed.length) process.exitCode = 1;

await polishbShots();
await glancerowShots();
results.n16ConsoleErrors =consoleErrors;
results.n16ConsoleErrorMessages = consoleErrorMessages;
results.n16ConsoleErrorLog = consoleErrorLog;
results.n16HydrationFull = hydrationFull;
results.n16PageErrors = pageErrors;
// ---- kiosk corner controls: alerts and downloads at the bottom right, no Admin on Glance ----
// results.corner.{checks, failed[]}: every mismatch is recorded in failed (never skipped); results.corner.checks.<key> = {ok, ...measurements}. Shots corner-<state>-<size>.png.
// Checks (shape note section 5): nothing leaves no hit area and Glance has no Admin; downloads-only right edge = innerWidth - 20; alert + downloads gap 12, both >= 56 high;
// 2-digit count unclipped and >= 4.5:1; ring inside the button; trays inside the viewport and 12 above the cluster, no animation under reduced motion; 390 row clears the pill and the
// bottom-left cluster; Glance column / band text never intersects the cluster; Glance does not scroll; Standard header clear and last row >= 84 from the bottom at the end of scroll;
// tab order ends downloads, alert; an open timers sheet and the PIN pad cover the cluster. The weather, sun and clock are pinned (MAIN_URL, fixed time, midday stop).
const CO = (results.corner = { checks: {}, failed: [] });
const coRec = (key, ok, detail = {}) => { CO.checks[key] = { ok, ...detail }; if (!ok) CO.failed.push(`${key} ${JSON.stringify(detail)}`); };
const coRun = (name, fn) => guarded(`corner ${name}`, async () => { try { await fn(); } catch (e) { CO.failed.push(`${name}: ${String(e?.message ?? e).split("\n")[0]}`); throw e; } });
const coNear = (a, b, tol = 1) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const CO_W = weatherFor(STOPS.includes("midday") ? "midday" : STOPS[0]);
const CO_ALERT = { status: "attention", severity: "warn", headline: "Backup is late", detail: "Last run was two days ago.", action: "Check the backup job." };
const coItems = (n) => ({ status: "ok", items: Array.from({ length: n }, (_, i) => ({ hash: `h${i}`, name: `Download number ${i + 1}`, progress: 0.2 + (i % 5) / 10, dlspeed: 1_500_000, size: 4_000_000_000, eta: 900 + i })) });
const CO_SIZES = [...SIZES, { name: "390x844", viewport: { width: 390, height: 844 } }];
const coVisit = (std, size, { alert = false, dl = 0, reduced = false, nowPlaying = false } = {}) => visit(std ? `${MAIN_URL}&layout=standard` : MAIN_URL, {
  viewport: size.viewport, weather: CO_W, fixedTime: true, ha: true, reduced, nowPlaying,
  routes: { "/kiosk/api/attention": alert ? CO_ALERT : { status: "quiet" }, "/kiosk/api/downloads": dl ? coItems(dl) : { status: "unconfigured" } },
});
/** Rects of the cluster wrapper and its two buttons, plus the viewport; every control found by its aria-label. */
const CO_READ = () => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
  const wrap = document.querySelector('div[data-rain-zone="corner"]:not([role])');
  const btn = (re) => [...(wrap?.querySelectorAll("button") ?? [])].find((b) => re.test(b.getAttribute("aria-label") ?? ""));
  const dl = btn(/download/i), al = btn(/alert/i);
  const num = (s) => s.match(/[\d.]+/g).map(Number);
  const lum = (c) => { const [R, G, B] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
  const ink = (el) => {
    let bg = null;
    for (let n = el; n && !bg; n = n.parentElement) { const c = num(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0.5) bg = c.slice(0, 3); }
    const a = lum(num(getComputedStyle(el).color).slice(0, 3)) + 0.05, b = lum(bg ?? [0, 0, 0]) + 0.05;
    return Math.max(a, b) / Math.min(a, b);
  };
  const count = (b) => { const s = b && [...b.querySelectorAll("span")].find((x) => /^\d+$/.test(x.textContent.trim())); return s ? { text: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth + 1, contrast: ink(s) } : null; };
  const ring = dl?.querySelector("svg"), rr = ring?.getBoundingClientRect(), db = dl?.getBoundingClientRect();
  const tray = (name) => r(document.querySelector(`[role="dialog"][aria-label="${name}"]`));
  const zone = (n) => [...document.querySelectorAll(`[data-rain-zone="${n}"]`)].map(r);
  // every visible text node outside the cluster and the trays, for the "no cluster rect intersects any text" check
  const texts = [];
  const wk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = wk.nextNode(); n; n = wk.nextNode()) {
    const p = n.parentElement;
    if (!n.textContent.trim() || !p || p.closest('[data-rain-zone="corner"], [data-rain-zone="dock"], [role="dialog"], script, style, .sr-only, [aria-hidden="true"]') || getComputedStyle(p).visibility === "hidden") continue;
    const g = document.createRange();
    g.selectNodeContents(n);
    const b = g.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) texts.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, t: n.textContent.trim().slice(0, 24) });
  }
  const tab = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((e) => !e.closest('[role="dialog"]'));
  const hit = wrap ? (() => { const b = wrap.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { area: b.width * b.height, within: !!e?.closest('[data-rain-zone="corner"]'), sheet: !!e?.closest('[data-sr-overlay="sheet"], [data-sr-overlay="dialog"], [role="dialog"]') }; })() : null;
  return {
    vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, wrap: r(wrap), dl: r(dl), al: r(al), dlCount: count(dl), alCount: count(al),
    ring: rr && db ? { inside: rr.left >= db.left && rr.right <= db.right && rr.top >= db.top && rr.bottom <= db.bottom } : null,
    hit, admin: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Admin").length, trayDl: tray("Downloads"), trayAl: tray("Alerts"),
    tiles: zone("tiles"), playing: zone("playing"), sentence: zone("sentence"), texts, hdr: r(document.querySelector(".kiosk-hdr-grid")), rail: r(document.querySelector('[data-testid="kiosk-forecast-rail"]')),
    tabTail: tab.slice(-2).map((e) => e.getAttribute("aria-label") ?? e.textContent.trim().slice(0, 20)),
    animating: [...document.querySelectorAll('[role="dialog"]')].flatMap((d) => d.getAnimations()).length,
  };
};
const coHit = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const coShot = (page, name, size) => page.screenshot({ path: join(OUT_DIR, `corner-${name}-${size.name}.png`) });

for (const size of CO_SIZES) {
  const phone = size.name === "390x844";
  await coRun(`both ${size.name}`, async () => {
    const { context, page } = await coVisit(false, size, { alert: true, dl: 12, nowPlaying: phone });
    try {
      await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
      await page.waitForTimeout(600);
      const d = await page.evaluate(CO_READ);
      const k = `${size.name} glance both`;
      coRec(`${k} gap`, coNear(d.al?.left - d.dl?.right, 12), { gap: d.al?.left - d.dl?.right });
      coRec(`${k} height`, d.dl?.h >= 55 && d.al?.h >= 55, { dl: d.dl?.h, al: d.al?.h });
      coRec(`${k} alert at the corner`, coNear(d.al?.right, d.vw - 20), { right: d.al?.right, vw: d.vw });
      coRec(`${k} no Admin`, d.admin === 0, { admin: d.admin });
      coRec(`${k} no scroll`, d.scrollH <= d.vh + 1, { scrollH: d.scrollH, vh: d.vh });
      coRec(`${k} 2-digit count`, !!d.dlCount && !d.dlCount.clipped && d.dlCount.contrast >= 4.5, d.dlCount ?? {});
      coRec(`${k} ring inside`, d.ring?.inside === true, { ring: d.ring });
      coRec(`${k} text clear`, !d.texts.some((t) => coHit(d.wrap, t)), { hits: d.texts.filter((t) => coHit(d.wrap, t)).map((t) => t.t) });
      if (d.tiles.length) coRec(`${k} bottom-left cluster`, Math.max(...d.tiles.map((t) => t.right)) + 11 <= d.wrap.left, { tilesRight: d.tiles.map((t) => t.right), left: d.wrap.left });
      if (d.playing.length) coRec(`${k} pill`, d.playing[0].right + 11 <= d.wrap.left || d.wrap.bottom + 11 <= d.playing[0].top || d.playing[0].bottom + 11 <= d.wrap.top, { pill: d.playing[0], wrap: d.wrap });
      // No column rect meets the cluster grown by 12 (the house gap) on every side.
      const grown = { left: d.wrap.left - 12, right: d.wrap.right + 12, top: d.wrap.top - 12, bottom: d.wrap.bottom + 12 };
      if (d.sentence.length) coRec(`${k} column clear`, !d.sentence.some((s) => coHit(grown, s)), { top: d.wrap.top, colBottom: Math.max(...d.sentence.map((s) => s.bottom)), hits: d.sentence.filter((s) => coHit(grown, s)).map((s) => s.t ?? "") });
      await coShot(page, "glance-both", size);
      if (phone) return;
      // downloads tray, Glance: rises above the cluster, inside the viewport
      await page.getByRole("button", { name: /download/i }).first().click();
      await page.waitForTimeout(500);
      const t = await page.evaluate(CO_READ);
      coRec(`${k} downloads tray`, !!t.trayDl && t.trayDl.left >= 0 && t.trayDl.top >= 0 && t.trayDl.right <= t.vw && t.wrap.top - t.trayDl.bottom >= 11, { tray: t.trayDl, cluster: t.wrap });
      if (size.name === "1024x768") await coShot(page, "glance-dltray", size);
    } finally {
      await context.close();
    }
  });
}

await coRun("downloads only and nothing", async () => {
  const size = SIZES[1];
  {
    const { context, page } = await coVisit(false, size, { dl: 3 });
    try {
      await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
      await page.waitForTimeout(600);
      const d = await page.evaluate(CO_READ);
      coRec("glance downloads only right edge", coNear(d.dl?.right, d.vw - 20), { right: d.dl?.right, vw: d.vw });
      coRec("glance downloads only no Admin", d.admin === 0, { admin: d.admin });
      await coShot(page, "glance-dl-only", size);
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await coVisit(false, size);
    try {
      await page.waitForTimeout(1500);
      const d = await page.evaluate(CO_READ);
      coRec("glance nothing no hit area", !d.wrap || (d.wrap.w === 0 && d.wrap.h === 0), { wrap: d.wrap });
      coRec("glance nothing no Admin", d.admin === 0, { admin: d.admin });
      await coShot(page, "glance-nothing", size);
    } finally {
      await context.close();
    }
  }
});

await coRun("standard", async () => {
  const size = SIZES[1];
  const { context, page } = await coVisit(true, size, { alert: true, dl: 3 });
  try {
    await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
    await page.waitForTimeout(800);
    const d = await page.evaluate(CO_READ);
    coRec("std header clear", !coHit(d.wrap, d.hdr) && (!d.rail || d.rail.right <= d.hdr.right - 11) /* header px-4 (16) less the rail's -mx-1 (4) = 12 inset, 1 px tolerance */, { hdr: d.hdr, rail: d.rail, wrap: d.wrap });
    coRec("std has Admin", d.admin >= 1, { admin: d.admin });
    coRec("std tab order ends downloads, alert", /download/i.test(d.tabTail[0]) && /alert/i.test(d.tabTail[1]), { tail: d.tabTail });
    await coShot(page, "std-header-dl", size);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const e = await page.evaluate(CO_READ);
    const last = Math.max(...e.texts.map((t) => t.bottom));
    coRec("std end of scroll clear", e.vh - last >= 83, { vh: e.vh, lastRowBottom: last });
    await coShot(page, "std-end", size);
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole("button", { name: /alert/i }).first().click();
    await page.waitForTimeout(500);
    const t = await page.evaluate(CO_READ);
    coRec("std alert tray", !!t.trayAl && t.trayAl.left >= 0 && t.trayAl.top >= 0 && t.trayAl.right <= t.vw && t.wrap.top - t.trayAl.bottom >= 11, { tray: t.trayAl, cluster: t.wrap });
    await coShot(page, "std-alerttray", size);
    // one at a time: opening downloads closes the alert tray
    await page.getByRole("button", { name: /download/i }).first().click();
    await page.waitForTimeout(500);
    const o = await page.evaluate(CO_READ);
    coRec("std one tray at a time", !!o.trayDl && !o.trayAl, { dl: !!o.trayDl, al: !!o.trayAl });
    // the PIN pad covers the cluster
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Admin", exact: true }).first().click();
    await page.waitForTimeout(700);
    const p = await page.evaluate(CO_READ);
    coRec("std PIN pad covers cluster", p.hit?.sheet === true, { hit: p.hit });
    await coShot(page, "std-pin", size);
  } finally {
    await context.close();
  }
});

await coRun("timers sheet", async () => {
  const size = SIZES[1];
  const { context, page } = await coVisit(false, size, { alert: true, dl: 3 });
  try {
    await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /^Timers/ }).first().click();
    await page.waitForTimeout(700);
    const d = await page.evaluate(CO_READ);
    coRec("glance timers sheet covers cluster", d.hit?.sheet === true, { hit: d.hit });
    await coShot(page, "glance-timers-sheet", size);
  } finally {
    await context.close();
  }
});

await coRun("reduced motion", async () => {
  const { context, page } = await coVisit(false, SIZES[1], { dl: 3, reduced: true });
  try {
    await seen(page, 'div[data-rain-zone="corner"] button', 15_000);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /download/i }).first().click();
    await page.waitForTimeout(400);
    const d = await page.evaluate(CO_READ);
    coRec("reduced motion tray no animation", !!d.trayDl && d.animating === 0, { animating: d.animating });
  } finally {
    await context.close();
  }
});
if (CO.failed.length) process.exitCode = 1;

await accentShots();
await fullViewBoard();
results.n16PageErrorMessages = pageErrorMessages;
results.n16ForeignRequests = foreign;
await browser.close();
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
