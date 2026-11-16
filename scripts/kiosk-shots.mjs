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
 * Polish round: polish.p1.runningCount (1), polish.p3.{left,right,bottom} (>= 2), polish.p4-<stop>-<size>[] {fontPx >= 15, w, h >= 44}, polish.controls-<size>.{p5,p6,p7}. Shots polish-*.png.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
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
      lRecord("L2", name, Math.abs(m.h - 44) <= 0.5 && m.label.length <= 16 && Math.abs(m.headerWith - m.headerWithout) <= 1, { h: m.h, label: m.label.length, headerWith: m.headerWith, headerWithout: m.headerWithout });
      await lShot(page, name, page.locator("header").first());
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
  const probe = (cls, host) => {
    const el = Object.assign(document.createElement("span"), { className: cls, textContent: "x" });
    host.append(el);
    const v = parseFloat(getComputedStyle(el).lineHeight);
    el.remove();
    return v;
  };
  const row = document.querySelector('[data-bin-night="row"]');
  const anchor = document.querySelector("[data-weather-line]") ?? document.querySelector("[data-weather-datums]");
  const root = anchor ? anchor.closest(".max-w-6xl") : null;
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
    ...out, text: row.textContent, h: r.height, lineHeight: probe("text-sm", row.parentElement), gap: prev ? r.top - prev.bottom : null,
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
    bnRecord("N6", s.key, has && bnNear(m.h, m.lineHeight) && bnNear(m.gap, m.margin) && bnNear(m.gap, 12) && m.scrollW <= m.clientW, { h: m.h, lineHeight: m.lineHeight, gap: m.gap, margin: m.margin, scrollW: m.scrollW, clientW: m.clientW });
    // a missing baseline leaves N7 and N8 one entry short, which fails them
    if (base) {
      bnRecord("N7", s.key, has && bnNear(m.hubTop - base.hubTop, m.h + m.gap, 1), { hubTop: m.hubTop, baseHubTop: base.hubTop, rowH: m.h, gap: m.gap });
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
async function binsSettings(name, rule, { viewport = { width: 1024, height: 768 }, drive = null, want = [], not = [], mark = null } = {}) {
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
  await context.close();
}
const BIN_ERRORS = ["Name this bin, or remove it.", "Bin names are 20 characters at most.", "Use letters or numbers in the bin name.", "Another bin already has this name.", "Pick any date this bin is collected.", "Pick a date between 2000 and 2099."];
const binCard = (page) => page.getByText("The wall kiosk shows a line from 5 pm to 10 pm").locator(".."); // the intro is the card root's first child
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
    return { ok: !(await saveDisabled(page)) && clipped.length === 0, clipped };
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
  mark: async (page) => ({ ok: (await saveDisabled(page)) && (await binCard(page).getByRole("button", { name: "Add a bin" }).count()) === 0 }),
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
  const root = anchor ? anchor.closest(".max-w-6xl") : null;
  const out = {
    nodes: document.querySelectorAll("[data-calendar-section]").length, rendered: !!document.querySelector("[data-kiosk-theme]"), vh: innerHeight,
    header: document.querySelector("header")?.getBoundingClientRect().height ?? null,
    hubTop: root && root.lastElementChild ? root.lastElementChild.getBoundingClientRect().top : null,
  };
  // C11: the hub's Climate and Lights sections: top border (width, colour) and the gap from the preceding content (the Calendar section for Climate) to the section's header
  const hubSecs = root && root.lastElementChild ? [...root.lastElementChild.querySelectorAll("section")].filter((s) => s.parentElement.classList.contains("space-y-2.5")) : [];
  const hubOf = (name) => {
    const s = hubSecs.find((x) => new RegExp(`^${name}`, "i").test((x.firstElementChild?.textContent ?? "").trim()));
    if (!s) return null;
    const prev = s.previousElementSibling ?? sec;
    const bs = getComputedStyle(s);
    return { w: bs.borderTopWidth, color: bs.borderTopColor, gap: prev && s.firstElementChild ? s.firstElementChild.getBoundingClientRect().top - prev.getBoundingClientRect().bottom : null };
  };
  out.hub = { climate: hubOf("climate"), lights: hubOf("lights") };
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
    heading: sec.querySelector("h2")?.tagName ?? null, staleTags: sec.querySelectorAll(".sr-stale").length, border, inner, clipped,
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
    cRecord("C5", `std-${key}`, m.border.w === m.border.refW && m.border.color === m.border.refColor && parseFloat(m.border.w) > 0, m.border);
    if (def.stale && theme === "sunroom") cRecord("C4", `std-${key} one stale tag`, m.staleTags === 1, { staleTags: m.staleTags });
    if (state === "crowded" && theme === "sunroom") {
      // C11: with the Calendar section shown, Climate has Lights' top rule and the same gap above its header (1 px); with no calendar set it has no rule (0 px)
      const c = m.hub?.climate, l = m.hub?.lights, b = base.hub?.climate;
      cRecord("C11", `std-${key}`, !!c && !!l && !!b && c.w === l.w && parseFloat(c.w) > 0 && c.color === l.color && cNear(c.gap, l.gap, 1) && parseFloat(b.w) === 0, { climate: c, lights: l, noCalendarClimate: b });
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
async function calSettings(name, status, { viewport = { width: 1024, height: 768 }, drive = null, saveReply = { status: 200, json: { ok: true } }, want = [], not = [], mark = null } = {}) {
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
  mark: async (page) => { const e = await calErrorFacts(page); const f = await calFieldFacts(page); return { ok: !!e && e.text === CAL_LONGEST_ERROR && e.whole && f.value === CAL_DRAFT && !!f.describedBy, error: e, draftKept: f.value === CAL_DRAFT }; },
}));
await cRun("settings warn", () => calSettings("settings-warn", CAL_SETTINGS.warn, {
  want: ["Not syncing since Thu 2:40 pm: the calendar refused the link (copy a fresh private link and Replace)."], not: ["Calendar connected"],
  mark: async (page) => page.getByText(/^Not syncing since/).evaluate((el) => ({ ok: el.className.includes("text-warn"), className: el.className })),
}));
await cRun("settings replace", () => calSettings("settings-replace", CAL_SETTINGS.replace, {
  drive: (page) => page.getByRole("button", { name: "Replace" }).click(), want: ["Cancel", "Clear", "Calendar connected · 14 events this week"],
  mark: async (page) => { const f = await calFieldFacts(page); return { ok: f.placeholder === "Paste the new link" && !(await calSave(page).isDisabled()), ...f }; }, // blank keeps the saved link, so Save stays on
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

results.n16ConsoleErrors = consoleErrors;
results.n16ConsoleErrorMessages = consoleErrorMessages;
results.n16ConsoleErrorLog = consoleErrorLog;
results.n16HydrationFull = hydrationFull;
results.n16PageErrors = pageErrors;
results.n16PageErrorMessages = pageErrorMessages;
results.n16ForeignRequests = foreign;
await browser.close();
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
