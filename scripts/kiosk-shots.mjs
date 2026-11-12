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
 * Polish round: polish.p1.runningCount (1), polish.p3.{left,right,bottom} (>= 2), polish.p4-<stop>-<size>[] {fontPx >= 15, w, h >= 44}, polish.controls-<size>.{p5,p6,p7}. Shots polish-*.png.
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
async function visit(url, { viewport, weather, fixedTime = false, reduced = false, ha = false, nowPlaying = false, rain = false, climateMode = null, routes = null, initScript = null }) {
  const context = await browser.newContext({ viewport, timezoneId: ZONE, reducedMotion: reduced ? "reduce" : "no-preference" });
  // "flow" and "ticking": start at the pinned instant but keep time passing (SWR's focus throttle and dedupe read Date.now; ticking is also fast-forwarded)
  if (fixedTime === "flow" || fixedTime === "ticking") await context.clock.install({ time: new Date(PINNED_ISO) });
  else if (fixedTime) await context.clock.setFixedTime(new Date(PINNED_ISO));
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
const DOORBELL_OK = { status: "ok", cameras: [{ entityId: "camera.front_door", name: "Front door", available: true }], triggers: [], latest: null, autoOpen: true, viewCamera: null }; // HaDoorbellSnapshot (types/ha.ts:193)
const ATTENTION_WARN = { status: "attention", severity: "warn", headline: "A container stopped", detail: "Placeholder detail for the capture.", action: "Open the dashboard", since: "2026-06-15T09:00:00+10:00" }; // AttentionResult (attention.ts:62)
const ATTENTION_DOORBELL = { status: "attention", severity: "warn", headline: "Front door camera has gone quiet", detail: "No motion reported for 68 days", action: "Reload its integration in Home Assistant; it may need signing in.", since: "2026-06-15T09:00:00+10:00" }; // copy from doorbellQuietCopy (attention-copy.ts)
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
  const { context, page } = await extraVisit({ "/kiosk/api/attention": ATTENTION_WARN });
  const take = (results.overlays.extra.alertTakeover = {});
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 8000))) return void (take.missing = "takeover did not open for one raised alert");
  await settle(page, '[data-sr-overlay="takeover"] [data-sr-face], [data-sr-overlay="takeover"]');
  await page.screenshot({ path: join(OUT_DIR, "overlay-alert-takeover-1180x820.png") });
  Object.assign(take, await page.evaluate(SCAN_AT, '[data-sr-overlay="takeover"]'), { chimeOscillators: await page.evaluate(() => window.__osc) });
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
await guarded("overlays extra alert doorbell", async () => {
  const { context, page } = await extraVisit({ "/kiosk/api/attention": ATTENTION_DOORBELL });
  const take = (results.overlays.extra.alertDoorbell = {});
  if (!(await seen(page, '[data-sr-overlay="takeover"]', 8000))) return void (take.missing = "takeover did not open for the doorbell alert");
  await settle(page, '[data-sr-overlay="takeover"] [data-sr-face], [data-sr-overlay="takeover"]');
  await page.screenshot({ path: join(OUT_DIR, "kiosk-alert-doorbell-1180x820.png") }); // state kiosk-alert-doorbell
  Object.assign(take, await page.evaluate(SCAN_AT, '[data-sr-overlay="takeover"]'));
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
  // fixedTime "ticking": midday, but Date.now() advances (setFixedTime never does, and the real 2 am clock shows the night overlay). STOP_URL has wx=off, so the mocked outage is not overridden by a preview preset.
  const { context, page, state } = await visit(STOP_URL, { viewport: SIZES[0].viewport, weather: weatherFor("midday"), fixedTime: "ticking" });
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
