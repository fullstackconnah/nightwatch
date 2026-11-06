#!/usr/bin/env node
/* Captures /minecraft on the test stack, once per state of the pattern spec (section 5), at 1440x900 and 390x844, and
 * prints the numeric checks (section 8, C3 and the other node checks excluded) as one JSON object on the last line.
 * Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/minecraft-shots.mjs
 *
 * Needs: the test stack (docker-compose.test.yml, a dev build that accepts any password) and Playwright >= 1.45
 * (page.clock), which is not a dependency of this repo; run it where one is installed.
 * Nothing real is touched: the status, backups, logs, search and container-action calls are answered from the script
 * (scripts/fixtures/minecraft/fixtures.mjs, placeholder addresses only); the containers list is the stack's own with the
 * minecraft container swapped for the fixture's. Time is driven by page.clock (installed before goto, pinned to the
 * fixtures' NOW); no focus events. The context time zone is pinned.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, NOW, PLAYERS_AFTER, SEARCH } from "./fixtures/minecraft/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const TIMEZONE = "Australia/Sydney";
const CONTAINER_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
const WRITE_RE = /^(Stop|Start|Restart|Switch|Delete|Install|Upload|Back up now|Restore|Send)/;
// [fixture, chip, a phrase the answer must contain]
const STATES = [
  ["loading", "Checking", "Connecting to mc-manager"],
  ["unconfigured", "Not connected", "isn’t connected yet"],
  ["tokenRejected", "Token rejected", "rejected the token"],
  ["down", "Manager down", "mc-manager isn’t answering"],
  ["crashed", "Crashed", "failed to install"],
  ["noPack", "No pack", "No modpack installed yet"],
  ["calm", "Running", "players online"],
  ["partial", "Running", "Player count unknown"],
];

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];

// One bad state must not hide the rest: a throw (a failed waitFor included) is recorded as a FAIL and the next step runs.
let stage = "";
const fail = (vp, e) => record("FAIL", `${stage}@${vp}`, String(e?.message ?? e).split(/\r?\n/)[0]);
const guarded = (label, fn) => { stage = label; return fn().catch((e) => fail("all", e)); };

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) {
  const context = await browser.newContext({ ...opts, timezoneId: TIMEZONE });
  sessions.push({ name, opts, context });
}
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));

/** C14: page errors, and any request that leaves the page's own origin. */
function watch(page, name) {
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreignRequests.push(`${name}: ${new URL(u).origin}`);
  });
}

async function mockRoutes(page, mock) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/minecraft/status", (route) => {
    if (mock.statusFail || mock.fx.status === "fail") return json(route, { error: "status failed" }, 500);
    if (mock.fx.status === "hang") return undefined; // never answered
    return json(route, mock.players ? { ...mock.fx.status, players: mock.players } : mock.fx.status);
  });
  await page.route("**/api/minecraft/backups", (route) =>
    route.request().method() === "GET" ? json(route, { backups: mock.fx.backups }) : json(route, { ok: true }),
  );
  await page.route("**/api/minecraft/packs/search*", (route) => json(route, SEARCH));
  await page.route("**/api/docker/containers", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const list = (body.containers ?? []).filter((c) => c.name !== "minecraft");
    if (mock.fx.container) list.push({ ...(list[0] ?? {}), id: CONTAINER_ID, name: "minecraft", finishedAt: null, restartCount: 0, ...mock.fx.container });
    return json(route, { ...body, containers: list });
  });
  await page.route("**/api/docker/containers/*/logs*", (route) => json(route, { logs: mock.fx.logs }));
  await page.route("**/api/docker/containers/*/action", async (route) => {
    if (mock.action === "fail") return json(route, { error: "boom" }, 500);
    if (mock.action === "hold") await new Promise((r) => (mock.release = r));
    return json(route, { ok: true });
  });
}

/** A fresh page on /minecraft with the fixture served, the clock installed before goto, and the first answer painted. */
async function visit(s, key, { reduced = false, hash = "" } = {}) {
  const page = await s.context.newPage();
  const mock = { fx: FIXTURES[key], statusFail: false, players: null, action: "ok", release: null };
  watch(page, s.name);
  await mockRoutes(page, mock);
  await page.clock.install({ time: NOW });
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}/minecraft${hash}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
  if (key !== "loading") {
    await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
  }
  await page.waitForTimeout(500);
  return { page, mock };
}

/** Run the page clock past the 10 s poll and give the mocked answers a moment to land. */
async function tick(page, ms = 10_500) {
  await page.clock.runFor(ms);
  await page.waitForTimeout(350);
}

async function goStale(page, mock) {
  mock.statusFail = true;
  for (let i = 0; i < 4; i++) {
    await tick(page, 12_000);
    if ((await chipOf(page)) === "Stale") return;
  }
  throw new Error("never went stale");
}

const chipOf = (page) => page.locator("[data-feature=chip]").innerText().then((t) => t.trim());
const answerOf = (page) => page.locator("[data-feature=answer]").getAttribute("title");
// L1 (R3): the detail lead shows exactly while the head answer is clamped; measured after two frames so the observer has run.
const leadState = async (page) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(() => {
    const a = document.querySelector("[data-feature=answer]");
    const l = document.querySelector("[data-feature=detail-lead]");
    return { clamped: !!a && a.scrollHeight > a.clientHeight + 1, lead: !!l && l.getClientRects().length > 0 };
  });
  return { ...r, ok: r.clamped === r.lead };
};
const detail = (page) => page.locator(".st-pane, .st-body");
const openStrip = async (page, id) => {
  await page.locator(`[data-k="open-${id}"]`).click();
  await page.waitForTimeout(120);
};
/** Waits for the element (isVisible({timeout}) does not wait). */
const seen = (loc) => loc.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** C4, C4g, C5: the answer slot's box, the gap under its last text line, and its bottom edge. */
const answerGeom = (page) =>
  page.evaluate(() => {
    const a = document.querySelector(".st-answer");
    const r = a.getBoundingClientRect();
    const rng = document.createRange();
    rng.selectNodeContents(a);
    const bottoms = [...rng.getClientRects()].filter((x) => x.bottom <= r.bottom + 1).map((x) => x.bottom);
    const ev = document.querySelector(".st-evidence").getBoundingClientRect();
    return { h: r.height, lh: parseFloat(getComputedStyle(a).lineHeight), bottom: r.bottom, gap: ev.top - Math.max(...bottoms) };
  });

/** C9 contrast, C10 duplicate ids, C15 bad or warn paint, C17 clipped content: computed-style probes, no pixels. */
const audit = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.trim().slice(i, i + 2), 16));
    const targets = [rgbOf(root.getPropertyValue("--color-warn")), rgbOf(root.getPropertyValue("--color-bad"))];
    const parse = (s) => {
      const m = s.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      const c = s.match(/^color\(srgb ([^)]+)\)$/);
      if (c) { const p = c[1].split(/[ /]+/).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return null;
    };
    const isDanger = (s) => { const v = parse(s); return Boolean(v) && v[3] > 0 && targets.some((t) => t.every((x, i) => Math.abs(x - v[i]) <= 1.5)); };
    const painted = [];
    const clipped = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(isDanger)) painted.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      const r = el.getBoundingClientRect();
      const byDesign = cs.textOverflow === "ellipsis" || el.classList.contains("st-answer") || el.tagName === "INPUT" || el.tagName === "SELECT";
      if (r.width > 0 && cs.overflowX === "hidden" && el.scrollWidth > el.clientWidth + 1 && !byDesign) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
    }
    const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a); };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      return layers.reduceRight((under, top) => over(top, under), [11, 15, 20, 1]);
    };
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    let minRatio = 21;
    const low = [];
    const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || getComputedStyle(el).visibility === "hidden" || el.closest("[aria-hidden=true]") || el.closest("option")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = bgOf(el);
      const x = ratio(over(fg, bg), bg);
      minRatio = Math.min(minRatio, x);
      if (x < 4.5) low.push(`${n.textContent.trim().slice(0, 20)} ${x.toFixed(2)}`);
    }
    const ids = [...document.querySelectorAll("[data-row-id]")].map((e) => e.dataset.rowId);
    return {
      painted: painted.length, paintedSample: painted.slice(0, 3),
      clipped: clipped.length, clippedSample: clipped.slice(0, 3),
      duplicateIds: ids.length - new Set(ids).size,
      minContrast: Math.round(minRatio * 100) / 100, lowContrast: low.slice(0, 4),
    };
  });

/** C8: every visible button, link and input box under 44 px (height for all; width too for buttons and links). */
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main button, main a[href], main input, main select, main textarea, main [role=button]")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === "hidden") return false;
        const wide = e.tagName === "BUTTON" || e.tagName === "A";
        return r.height < 43.5 || (wide && r.width < 43.5);
      })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("type") || "").trim().slice(0, 18)}`),
  );

/** The enabled write buttons, over every strip opened in turn. */
async function writesOn(page) {
  const ids = await page.locator("[data-k^=open-]").evaluateAll((els) => els.map((e) => e.dataset.k.slice(5)));
  const found = new Set();
  for (const id of ids) {
    await openStrip(page, id);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".st-slot button, .st-pane button, .st-body button")]
        .filter((b) => !b.disabled && b.offsetParent !== null)
        .map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
    );
    labels.filter((l) => WRITE_RE.test(l)).forEach((l) => found.add(l));
  }
  return [...found];
}

// view + (calm, crashed) page; the 390 touch page is never fullPage-shot: the viewport is grown to the page height.
async function shoot(page, s, key, full = false) {
  const base = join(OUT_DIR, `mc-${key}-${s.name}`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${base}-view.png` });
  if (!full) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  if (s.name === "390") {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 390, height: Math.min(h, 6000) });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${base}-page.png` });
    await page.setViewportSize(s.opts.viewport);
  } else {
    await page.screenshot({ path: `${base}-page.png`, fullPage: true });
  }
}

// C13: the Minecraft feature set, 20 features, each looked up after opening its strip.
const FEATURES = [
  ["chip", null, (p) => p.locator("[data-feature=chip]")],
  ["answer", null, (p) => p.locator("[data-feature=answer]")],
  ["evidence", null, (p) => p.locator("[data-feature=evidence]")],
  ["stop-slot", "server", (p) => p.locator('[data-row-id="server"] .st-slot button')],
  ["restart", "server", (p) => detail(p).getByRole("button", { name: "Restart" })],
  ["pack-facts", "server", (p) => detail(p).getByText("curseforge", { exact: true })],
  ["players-list", "players", (p) => detail(p).locator('[data-row-id="Alice"]')],
  ["search", "pack", (p) => detail(p).getByLabel("Search modpacks")],
  ["install", "pack", (p) => detail(p).getByRole("button", { name: /^Install / })],
  ["switch", "pack", (p) => detail(p).getByRole("button", { name: /^Switch to / })],
  ["delete", "pack", (p) => detail(p).getByRole("button", { name: /^Delete / }).first()],
  ["upload", "pack", (p) => detail(p).locator('input[type="file"]')],
  ["backup-now", "backups", (p) => p.locator('[data-row-id="backups"] .st-slot button')],
  ["restore", "backups", (p) => detail(p).getByRole("button", { name: /^Restore / }).first()],
  ["console-input", "console", (p) => detail(p).getByLabel("Command")],
  ["send", "console", (p) => detail(p).getByRole("button", { name: "Send" })],
  ["log-box", "log", (p) => detail(p).locator(".st-log")],
  ["tail", "log", (p) => detail(p).getByLabel("Lines to show")],
  ["pause", "log", (p) => detail(p).getByRole("button", { name: /^(Pause|Resume)$/ })],
  ["open-in-logs", "log", (p) => p.locator('[data-row-id="log"] .st-slot a')],
];

/** S3 / C18paused: the paused Server slot (Resume + Stop) at both widths, strip closed and open. */
async function paused(s) {
  const { page } = await visit(s, "paused");
  const toggle = page.locator('[data-k="open-server"]');
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  await page.waitForTimeout(150);
  await shoot(page, s, "paused", false);
  const probe = await page.evaluate(() => {
    const row = document.querySelector('[data-row-id="server"]');
    const box = (el) => el.getBoundingClientRect();
    const btn = (re) => [...row.querySelectorAll(".st-slot button")].find((b) => re.test(b.textContent));
    const resume = btn(/^Resume/), stop = btn(/^Stop/);
    const title = row.querySelector(".st-name"), state = row.querySelector(".st-state");
    const vis = (b) => Boolean(b) && box(b).width > 0 && box(b).height > 0;
    const t = box(title);
    const s = box(state);
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    // Same line as the title or wrapped whole below it, never on top of the title or the state line.
    const placed1 = (b) => !hit(box(b), t) && !hit(box(b), s) && (Math.abs(box(b).top - t.top) <= 2 || box(b).top >= t.bottom - 1 || box(b).bottom > t.top && box(b).top < t.bottom);
    return {
      visible: vis(resume) && vis(stop),
      placed: vis(resume) && vis(stop) && [resume, stop].every(placed1),
      stateTruncated: state.scrollWidth > state.clientWidth,
      overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  record("C18paused", s.name, { ...probe, ok: probe.visible && probe.placed && !probe.stateTruncated && probe.overflowPx <= 0 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT_DIR, `mc-paused-${s.name}-open-view.png`) });
  await page.close();
}

try {
  for (const s of sessions) {
    const login = await s.context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }

  // C4, C4g, C5, C9, C10, C11, C15, C17: every state of section 5, plus stale.
  await guarded("states", () =>
    each(async (s) => {
      const heights = [];
      const states = {};
      let minContrast = 21;
      let dup = 0;
      let clipped = 0;
      const measure = async (page, key, expect) => {
        const [chip, phrase] = expect;
        const answer = await answerOf(page);
        const g = await answerGeom(page);
        const a = await audit(page);
        heights.push(g.h);
        minContrast = Math.min(minContrast, a.minContrast);
        dup += a.duplicateIds;
        clipped += a.clipped;
        const chipNow = await chipOf(page);
        const writes = key === "loading" || key === "unconfigured" ? [] : await writesOn(page);
        states[key] = { ok: chipNow === chip && Boolean(answer?.includes(phrase)), chip: chipNow, writes, lowContrast: a.lowContrast, clippedSample: a.clippedSample };
        if (key === "calm") {
          record("C4g", s.name, Math.round(g.gap * 10) / 10);
          record("C5", s.name, Math.round(g.bottom * 10) / 10);
          record("C15", s.name, { painted: a.painted, sample: a.paintedSample });
          record("overflowPx", s.name, await overflow(page));
        }
        if (g.lh && Math.abs(g.h - 2 * g.lh) > 1) states[key].heightOff = Math.round(g.h * 10) / 10;
        return g;
      };
      for (const [key, chip, phrase] of STATES) {
        const { page } = await visit(s, key);
        // Shoot first: measure() runs writesOn, which opens every strip in turn and leaves the last one open.
        await shoot(page, s, key, key === "calm" || key === "crashed");
        await measure(page, key, [chip, phrase]);
        await page.close();
      }
      const { page, mock } = await visit(s, "calm");
      await goStale(page, mock);
      await measure(page, "stale", ["Stale", "Showing what was true"]);
      const staleWrites = states.stale.writes;
      record("C11stale", s.name, { writesOn: staleWrites, ok: staleWrites.length === 0 });
      await shoot(page, s, "stale", true);
      await page.close();
      await paused(s);
      record("C4", s.name, { delta: Math.round((Math.max(...heights) - Math.min(...heights)) * 10) / 10, heights: [...new Set(heights.map((h) => Math.round(h * 10) / 10))] });
      record("C9", s.name, { minContrast, bad: Object.entries(states).filter(([, v]) => v.lowContrast.length).map(([k]) => k) });
      record("C10", s.name, dup);
      record("C17", s.name, { clipped, bad: Object.entries(states).filter(([, v]) => v.clippedSample.length).map(([k, v]) => `${k}: ${v.clippedSample[0]}`) });
      const downWrites = states.down.writes;
      const tokenWrites = states.tokenRejected.writes;
      const dockerOnly = (w) => w.every((l) => /^(Stop|Start|Restart)/.test(l));
      record("C11", s.name, {
        states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.ok])),
        dockerOnlyWhenDown: dockerOnly(downWrites) && dockerOnly(tokenWrites),
        okCount: Object.values(states).filter((v) => v.ok).length,
      });
    }),
  );

  // L1 (replaces C4b): the strip the answer names leads with the full answer only while the head clamps it.
  await guarded("L1", () =>
    each(async (s) => {
      const out = {};
      for (const key of ["crashed", "down", "tokenRejected", "noPack"]) {
        const { page } = await visit(s, key);
        out[key] = await leadState(page);
        await page.close();
      }
      record("L1 detail lead only when clamped", s.name, out);
    }),
  );

  // C6s: the crash opens Server at both widths; a person's strip is never closed by a later crash.
  await guarded("C6s", () =>
    each(async (s) => {
      const open = async (page) => page.locator("[data-on]").evaluateAll((els) => els.map((e) => e.dataset.rowId));
      const crashed = await visit(s, "crashed");
      const onCrash = await open(crashed.page);
      await crashed.page.close();
      const calm = await visit(s, "calm");
      await openStrip(calm.page, "players");
      calm.mock.fx = FIXTURES.crashed;
      await tick(calm.page);
      const afterCrash = await open(calm.page);
      record("C6s", s.name, { crashedOpens: onCrash, personKept: afterCrash, chip: await chipOf(calm.page) });
      await calm.page.close();
    }),
  );

  // C7: the hold. Pointer on a player row, four live ticks, one adds a player.
  await guarded("C7", () =>
    each(async (s) => {
      const { page, mock } = await visit(s, "calm");
      await openStrip(page, "players");
      const rows = () => page.evaluate(() => Object.fromEntries(["Alice", "Bob"].map((n) => [n, Math.round(document.querySelector(`[data-row-id="${n}"]`).getBoundingClientRect().top * 10) / 10])));
      await detail(page).locator('[data-row-id="Alice"]').hover();
      const before = await rows();
      for (let i = 0; i < 4; i++) {
        if (i === 1) mock.players = PLAYERS_AFTER;
        await tick(page);
      }
      const after = await rows();
      const pill = await page.locator(".st-pill").innerText();
      const count = await page.locator(".st-listhead span").first().innerText();
      const moved = Math.max(...Object.keys(before).map((n) => Math.abs(before[n] - after[n])));
      const carolShown = await page.locator('[data-row-id="Carol"]').count();
      record("C7", s.name, { movedPx: moved, pill: pill.trim(), count: count.trim(), carolShown });
      await page.close();
    }),
  );

  // C8 (390) and C13: open every strip in turn on the calm state, with a search typed so install rows exist.
  await guarded("C8-C13", () =>
    each(async (s) => {
      const { page } = await visit(s, "calm");
      const small = new Set();
      const found = {};
      for (const id of ["server", "players", "pack", "backups", "console", "log"]) {
        await openStrip(page, id);
        if (id === "pack") {
          await detail(page).getByLabel("Search modpacks").fill("mod");
          await page.clock.runFor(600);
          await detail(page).getByRole("button", { name: /^Install / }).first().waitFor({ timeout: 10_000 }).catch(() => {});
        }
        (await smallTargets(page)).forEach((t) => small.add(t));
        for (const [name, strip, locate] of FEATURES) {
          if (strip === id || (strip === null && id === "server")) found[name] = (await locate(page).first().isVisible().catch(() => false)) || found[name] === true;
        }
      }
      if (s.name === "390") record("C8", s.name, { count: small.size, sample: [...small].slice(0, 8) });
      record("C13", s.name, { found: Object.values(found).filter(Boolean).length, of: FEATURES.length, missing: FEATURES.map((f) => f[0]).filter((n) => !found[n]) });
      await shoot(page, s, "calm-pack", false);
      await page.close();
    }),
  );

  // C12: under reduced motion no transition of the strips' own classes has a duration.
  await guarded("C12", () =>
    each(async (s) => {
      const { page } = await visit(s, "calm", { reduced: true });
      const n = await page.evaluate(() =>
        [...document.querySelectorAll('main [class^="st-"], main [class*=" st-"]')].filter((e) => getComputedStyle(e).transitionDuration.split(",").some((d) => parseFloat(d) > 0)).length,
      );
      record("C12", s.name, n);
      await page.close();
    }),
  );

  // C11 writes: the Stop idiom (ask, Escape, Yes), in flight, and failed.
  await guarded("writes", () =>
    each(async (s) => {
      const { page, mock } = await visit(s, "calm");
      const stop = page.locator('[data-row-id="server"] .st-slot').getByRole("button", { name: "Stop minecraft" });
      await stop.click();
      const frame = await page.locator('[data-row-id="server"] .st-frame').innerText();
      await page.keyboard.press("Escape");
      const closed = await stop.isVisible();
      await stop.click();
      mock.action = "hold";
      await page.getByRole("button", { name: "Yes, stop minecraft" }).click();
      const flight = await seen(page.getByText("Stopping…").first());
      mock.release?.();
      mock.action = "fail";
      await page.waitForTimeout(400);
      await stop.waitFor({ timeout: 5_000 }).catch(() => {});
      await stop.click();
      await page.getByRole("button", { name: "Yes, stop minecraft" }).click();
      const failed = await seen(page.getByText("Couldn’t stop the server: boom."));
      const retry = await seen(page.getByRole("button", { name: "Try again" }));
      const dismiss = await seen(page.getByRole("button", { name: "Dismiss" }));
      record("C11writes", s.name, { saysPlayers: /disconnects 2 players/.test(frame), escapeCloses: closed, flight, failed, retry, dismiss });
      await shoot(page, s, "stop-failed", false);
      await page.close();
    }),
  );
  // M5 (hunt 5): a bad Memory GB shows a field error under the input and disables Upload.
  await guarded("upload-memory-error", () =>
    each(async (s) => {
      const { page } = await visit(s, "calm");
      await openStrip(page, "pack");
      const section = detail(page).locator('section[aria-label="Upload a server pack"]');
      const input = section.getByLabel("Memory GB");
      await input.scrollIntoViewIfNeeded();
      await input.fill("abc");
      const error = await seen(section.getByText("Enter a number above 0, or leave blank for the default."));
      const uploadOff = await section.getByRole("button", { name: "Upload" }).isDisabled();
      record("upload-memory-error", s.name, { error, uploadOff });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      // Element crop, padded; a bare locator screenshot because this repo has no cropElement helper.
      await section.locator("div", { has: input }).last().screenshot({ path: join(OUT_DIR, `mc-upload-memory-error-${s.name}.png`) });
      await page.close();
    }),
  );
} finally {
  await browser.close();
}

record("C14", "all", { pageErrors: pageErrors.length, foreign: foreignRequests.length });
if (pageErrors.length) record("C14", "errors", pageErrors.slice(0, 5));
if (foreignRequests.length) record("C14", "origins", [...new Set(foreignRequests)].slice(0, 5));
console.log(JSON.stringify(checks));
