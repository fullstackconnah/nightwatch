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
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTO_OFF, HA_STATES, NOW_PLAYING, RAIN_HA_STATES, RAIN_NOW_PLAYING, PINNED_ISO, QUIET, RAIN_STATES, ROUTES, STOPS, ZONE, rainWeatherFor, weatherFor } from "./fixtures/kiosk/fixtures.mjs";

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

mkdirSync(OUT_DIR, { recursive: true });
const results = { errors: [], sixStop: {}, crossing: {} };
let pageErrors = 0;
const pageErrorMessages = {};
let consoleErrors = 0;
const consoleErrorMessages = {};
const consoleErrorLog = [];
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
async function visit(url, { viewport, weather, fixedTime = false, reduced = false, ha = false, nowPlaying = false, rain = false, climateMode = null }) {
  const context = await browser.newContext({ viewport, timezoneId: ZONE, reducedMotion: reduced ? "reduce" : "no-preference" });
  if (fixedTime) await context.clock.setFixedTime(new Date(PINNED_ISO));
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
  await page.goto(url, { waitUntil: "domcontentloaded" });
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
    const { context, page } = await visit(STOP_URL, { viewport: SIZES[0].viewport, weather: weatherFor(stop) });
    await page.screenshot({ path: join(OUT_DIR, `stop-${stop}.png`), fullPage: true });
    results.sixStop[stop] = (await page.evaluate(SCAN)).vars;
    await context.close();
  });
  // the on-state glaze per stop: the controls view with the fixture's ON and OFF chips, cropped to the switches row
  await guarded(`stop-controls ${stop}`, async () => {
    const { context, page } = await visit(`${STOP_URL}&layout=standard`, { viewport: SIZES[0].viewport, weather: weatherFor(stop), ha: true });
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
      const { context, page } = await visit(`${STOP_URL}&layout=standard`, { viewport: SIZES[0].viewport, weather: weatherFor(stop), ha: true, climateMode: off ? "heat" : mode });
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

results.n16ConsoleErrors = consoleErrors;
results.n16ConsoleErrorMessages = consoleErrorMessages;
results.n16ConsoleErrorLog = consoleErrorLog;
results.n16PageErrors = pageErrors;
results.n16PageErrorMessages = pageErrorMessages;
results.n16ForeignRequests = foreign;
await browser.close();
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
