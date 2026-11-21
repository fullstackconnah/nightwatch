#!/usr/bin/env node
/* Captures /settings on the test stack, once per state, at 1440x900 and 390x844 (touch), and prints the numeric checks as
 * one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/settings-shots.mjs
 *   SENTINELS=1 adds C3, which writes to the REAL test-stack API: tear the stack and its data volume down afterwards
 *   (the SSO, Hermes and Discord secrets have no clear path).
 *
 * Needs the test stack (docker-compose.test.yml) and Playwright >= 1.45 (page.clock), not a dependency of this repo.
 * State fixtures mock GET /api/settings and the container list from scripts/fixtures/settings/fixtures.mjs (placeholders
 * only); the write routes answer from the mock. Time is page.clock (installed before goto); the zone is pinned.
 *
 * Checks written: C1 height, C2 inventory (the 98 spec kinds as probes, see inventory.json), RF refresh-failed, SF save-failed, C2c no write before Yes (Clear and widget Delete), C10 K12 real-API saves, C3 sentinels,
 * C5s auto-open on paint, C6 calm paint, C7 answer slot, C9 drafts, C11 deep link, C12 targets / motion / errors,
 * C14 page errors and foreign requests, and the restore drill strip (blank, typed, invalid, future, saving, save-failed, offline, saved-due; tap target and contrast).
 * Captures, per width: calm, partial, none, loading, load-error, refresh-failed, save-failed, no-password,
 * hermes-key-missing, unsaved-draft: a padded crop of the open strip (else the head); plus one full page per width for calm.
 *
 *   ONLY=stepup BASE_URL=http://host:3006 OUT_DIR=shots node scripts/settings-shots.mjs   runs only the step-up section
 *   ONLY=stepup-discord ... runs only the Discord step-up section on the Hermes daemon card (idle, asking, wrong, no-password)
 *   ONLY=pw72 ... runs only the Change password card with a 73-letter new password (pw-too-long, both widths; Save disabled, hint names 72 bytes)
 *   ONLY=hunt69 ... runs only the Orchestra Clear section (saved token: Clear shown; environment-only token: no Clear)
 *   ONLY=config-notice ... runs only the config.json-unreadable head (blank, unreadable, unreadable-no-copy, healthy), from fixtures
 * Step-up states (Access: Current password field, SU checks; exit 1 when one fails), a padded crop of the card each:
 * stepup-sso-untouched (1440), stepup-sso-dirty (both widths, plus the section's one full page per width), stepup-sso-wrong (1440),
 * stepup-system-untouched (both), stepup-system-ready, stepup-system-wrong, stepup-generate-wrong, stepup-no-password (1440), stepup-pin-clear (1440), stepup-pin-clear-disabled (390), stepup-pin-clear-ask (both).
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTAINERS, FIXTURES, NOW } from "./fixtures/settings/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
const STRIPS = ["access", "homeassistant", "npm", "forgejo", "github", "minecraft", "voice", "hermes", "dashboard"];
// [fixture, capture name, chip text, phrase the answer holds, strip that opens by itself (null: none)]
const STATES = [
  ["loading", "loading", "Loading", "Loading settings", null],
  ["loadError", "load-error", "Not loaded", "couldn’t load", null],
  ["calm", "calm", "Ready", "integrations are set up", null],
  ["partial", "partial", "Ready", "of 9 integrations are set up", null],
  ["none", "none", "Not set up", "No integrations are set up", null],
  ["noPassword", "no-password", "Sign-in off", "No login password", "access"],
  ["hermesKeyMissing", "hermes-key-missing", "Needs a key", "no OpenRouter key is saved", "hermes"],
];

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];
const diag = {};
let stage = "";
const fail = (vp, e) => record("FAIL", `${stage}@${vp}`, String(e?.message ?? e).split(/\r?\n/)[0]);
const ONLY = process.env.ONLY; // ONLY=stepup runs just that guarded section (the other sections are skipped)
const guarded = (label, fn) => { if (ONLY && label !== ONLY) return Promise.resolve(); stage = label; return fn().catch((e) => fail("all", e)); };

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) {
  sessions.push({
    name,
    context: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney" }),
    reducedContext: await browser.newContext({ ...opts, timezoneId: "Australia/Sydney", reducedMotion: "reduce" }),
  });
}
// The test stack's dev login takes any password.
for (const s of sessions) {
  for (const ctx of [s.context, s.reducedContext]) {
    const login = await ctx.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }
}
const live = {}; // the newest page per width, so a failed check can save what the page looked like
async function failShot(s, e) {
  fail(s.name, e);
  const page = live[s.name];
  if (!page || page.isClosed()) return;
  const tag = `${stage}@${s.name}`;
  diag[tag] = { url: page.url(), consoleErrors: (page.consoleErrors ?? []).slice(0, 5), body: await page.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => "unreadable") };
  await page.screenshot({ path: join(OUT_DIR, `${stage.replace(/[^\w@-]+/g, "_")}-FAIL-${s.name}.png`), fullPage: true }).catch(() => {});
  await page.close().catch(() => {});
}
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => failShot(s, e))));

/** C14: page errors, and any request that leaves the page's own origin. */
function watch(page, name) {
  page.consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && page.consoleErrors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreignRequests.push(`${name}: ${new URL(u).origin}`);
  });
}

/** Opens /settings with GET /api/settings answered from a fixture; `real` leaves the API alone (C3). */
async function visit(s, key, { hash = "", reduced = false, real = false } = {}) {
  const fx = FIXTURES[key];
  const page = await (reduced ? s.reducedContext : s.context).newPage();
  const mock = { posts: [], gets: 0, bodies: [] };
  watch(page, s.name);
  live[s.name] = page;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (!real) {
    await page.route("**/api/docker/containers", (route) => json(route, CONTAINERS));
    await page.route("**/api/settings", (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        mock.posts.push(`${req.method()} ${new URL(req.url()).pathname}`);
        mock.bodies.push(req.postData());
        return json(route, fx.saveStatus ? { error: "upstream said 10.0.0.5 refused" } : { ok: true }, fx.saveStatus ?? 200);
      }
      mock.gets += 1;
      if (fx.get === "hang") return undefined;
      if (fx.get === "fail" || (fx.failAfter && mock.gets > fx.failAfter)) return json(route, { error: "x" }, 500);
      return json(route, fx.get);
    });
    await page.route(/\/api\/settings\/(integrations|system|password)$/, (route) => {
      mock.posts.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      if (fx.saveStatus) return json(route, { error: "upstream said 10.0.0.5 refused" }, fx.saveStatus);
      // A7 needs a revealed token: the generate call answers with a placeholder.
      return json(route, route.request().postData()?.includes("generateMcpToken") ? { ok: true, generatedMcpToken: "0".repeat(48) } : { ok: true });
    });
    await page.route("**/api/hermes/local-models", (route) => json(route, { reachable: false, detail: "ollama not reachable (placeholder)", models: [] }));
    await page.route("**/api/hermes/openrouter-models", (route) =>
      json(route, { status: "ok", cachedAt: new Date(NOW).toISOString(), models: [{ id: "vendor/model", name: "Vendor Model", promptPrice: 0.000001, completionPrice: 0.000002, contextLength: 128000 }] }),
    );
  }
  await page.clock.install({ time: NOW });
  try {
    await page.goto(`${BASE_URL}/settings${hash}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Loading", null, { timeout: SLOW });
    await page.waitForTimeout(500);
  } catch (e) {
    const d = { url: page.url(), consoleErrors: page.consoleErrors.slice(0, 10) };
    d.body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch((err) => `unreadable: ${err.message}`);
    await page.screenshot({ path: join(OUT_DIR, `${key}-FAIL-${s.name}.png`), fullPage: true }).catch(() => {});
    diag[`${stage}:${key}@${s.name}`] = d;
    throw e;
  }
  return { page, mock };
}

/** The editable input for a label: a configured secret shows a masked group with the same label until Replace is pressed. */
const field = (scope, label) => scope.locator("input").and(scope.getByLabel(label));
const text = (page, sel) => page.locator(sel).first().innerText();
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
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const openStrip = async (page, id) => {
  const t = page.locator(`[data-k="open-${id}"]`);
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  await page.waitForTimeout(150);
};
const isOpen = (page, id) => page.locator(`[data-k="open-${id}"]`).getAttribute("aria-expanded").then((v) => v === "true");
const visibleBody = (page) => page.locator(".st-pane > div:not([hidden]), .st-body:not([hidden])");
const fullShot = (page, s, name) => page.screenshot({ path: join(OUT_DIR, `${name}-full-${s.name}.png`), fullPage: true });
/** Padded crop (24 px): 390 the head down to the strip list (its open body included); 1440 the head, list and detail pane as one box. */
async function shot(page, s, name) {
  const sels = ["[data-feature=head]", "[data-feature=strips]", ...(s.name === "1440" ? ["#st-pane"] : [])];
  const clip = await page.evaluate(([list, pad]) => {
    const r = list.map((q) => document.querySelector(q)?.getBoundingClientRect()).filter((b) => b && b.width > 0);
    if (!r.length) return null;
    const x = Math.max(0, Math.min(...r.map((b) => b.left)) + scrollX - pad), y = Math.max(0, Math.min(...r.map((b) => b.top)) + scrollY - pad);
    return { x, y, width: Math.min(innerWidth - x, Math.max(...r.map((b) => b.right)) + scrollX + pad - x), height: Math.max(...r.map((b) => b.bottom)) + scrollY + pad - y };
  }, [sels, 24]);
  await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}.png`), fullPage: true, ...(clip && { clip }) });
}

/** Computed bad or warn hue on visible text, fill or border, hidden bodies excluded (C6). */
const paint = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.trim().slice(i, i + 2), 16));
    const targets = [rgbOf(root.getPropertyValue("--color-warn")), rgbOf(root.getPropertyValue("--color-bad"))];
    const parse = (v) => {
      const m = v.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      const c = v.match(/^color\(srgb ([^)]+)\)$/);
      if (c) { const p = c[1].split(/[ /]+/).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return null;
    };
    const danger = (v) => { const x = parse(v); return Boolean(x) && x[3] > 0 && targets.some((t) => t.every((n, i) => Math.abs(n - x[i]) <= 1.5)); };
    const hits = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.closest("[hidden]")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(danger)) hits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
    }
    return hits;
  });

/** Buttons, links and inputs in main with a box under 44 px (C12); an inline link inside prose is exempt. */
const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main button, main a[href], main input, main select")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.disabled || el.closest("[hidden]")) return false;
        if (el.tagName === "A" && el.parentElement?.tagName === "P") return false;
        return r.height < 43.5 || r.width < 43.5;
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().slice(0, 30)),
  );

// ---- states: C11-style honest chip, per-state captures, C12 targets at 390, overflow ----
for (const [key, name, chip, phrase, open] of STATES) {
  await guarded(key, () =>
    each(async (s) => {
      const { page } = await visit(s, key);
      const answer = await text(page, "[data-feature=answer]");
      record("S honest chip and answer", `${name}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === chip && answer.includes(phrase));
      record("S no horizontal scroll", `${name}@${s.name}`, (await overflow(page)) <= 0);
      record("S no host or raw error", `${name}@${s.name}`, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED/.test(await page.locator("main").innerText()));
      if (open) record("C5s auto-open names the strip", `${name}@${s.name}`, await isOpen(page, open));
      if (open) record("L1 detail lead only when clamped", `${name}@${s.name}`, await leadState(page));
      if (s.name === "390") record("C12 targets under 44 px", name, (await small(page)).join("|") || "ok");
      await shot(page, s, name);
      if (key === "calm") await fullShot(page, s, name);
      await page.close();
    }),
  );
}

// ---- dashboard strip open: the hidden saved badge takes no space (F3) ----
await guarded("dashboard", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    await openStrip(page, "dashboard");
    if (s.name === "1440") await page.waitForSelector("#st-pane .nw-fade", { state: "attached", timeout: SLOW }); // the pane mounts after the open
    record("F3 saved badge out of flow", `dashboard@${s.name}`, await page.evaluate(() => { const b = [...document.querySelectorAll("#st-body-dashboard .nw-fade, #st-pane .nw-fade")].find((e) => e.textContent.trim() === "saved" && !e.closest("[hidden]")); return Boolean(b) && getComputedStyle(b).position === "absolute"; }));
    record("S no horizontal scroll", `dashboard@${s.name}`, (await overflow(page)) <= 0);
    await page.addStyleTag({ content: "nav.fixed { visibility: hidden !important; }" }); // the fixed bottom nav hid the 390 widget row
    await shot(page, s, "dashboard");
    await page.close();
  }),
);

// ---- O1: a widget with a saved key opens write-only: masked view, no value anywhere in the page or any /api/settings body ----
const FIXTURE_SECRET = "wsecret-fixture"; // never in a fixture; with BASE_URL on a real stack seeded with it this check bites
await guarded("widget-secret", () =>
  each(async (s) => {
    const bodies = [];
    const onResponse = (r) => { if (new URL(r.url()).pathname === "/api/settings") bodies.push(r.text().catch(() => "")); };
    s.context.on("response", onResponse); // on the context, so the page's first GET is seen without a reload
    const { page } = await visit(s, "calm");
    s.context.off("response", onResponse);
    await openStrip(page, "dashboard");
    await page.getByRole("button", { name: "edit", exact: true }).first().click();
    await page.getByPlaceholder("http://homelab.local:8989").waitFor({ timeout: SLOW }); // the widget editor's own field; getByText("API key") also hit hidden "<api key>" copy
    record("O1 saved key shows the masked view", `widget-secret@${s.name}`, await page.getByRole("button", { name: "Replace" }).first().isVisible());
    record("O1 no password input holds a value", `widget-secret@${s.name}`, await page.evaluate(() => [...document.querySelectorAll("input[type=password]")].every((i) => i.value === "")));
    record("O1 no fixture secret in the page", `widget-secret@${s.name}`, !(await page.content()).includes(FIXTURE_SECRET));
    record("O1 no fixture secret in any /api/settings body", `widget-secret@${s.name}`, (await Promise.all(bodies)).every((b) => !b.includes(FIXTURE_SECRET)));
    record("S no horizontal scroll", `widget-secret@${s.name}`, (await overflow(page)) <= 0);
    await page.addStyleTag({ content: "nav.fixed { visibility: hidden !important; }" });
    await shot(page, s, "widget-secret");
    await page.close();
  }),
);

// ---- refresh-failed: a later GET fails (SWR refetches on focus after its 5 s throttle); save-failed: a draft meets a 500 ----
await guarded("refresh-failed", () =>
  each(async (s) => {
    const { page } = await visit(s, "refreshFailed");
    await page.waitForTimeout(5300);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => /Couldn’t refresh/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 15_000 });
    const main = await page.locator("main").innerText();
    record("RF notice says the refresh failed and keeps the loaded data", s.name, main.includes("showing what loaded") && main.includes("integrations are set up"));
    record("RF no host or raw error", s.name, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED/.test(main));
    await shot(page, s, "refresh-failed");
    await page.close();
  }),
);
await guarded("save-failed", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "saveFailed", { hash: "#minecraft" });
    await field(page, "Manager URL").fill("http://homelab.local:9999");
    await visibleBody(page).getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(800);
    const main = await page.locator("main").innerText();
    record("SF one save sent, error shown without the upstream host", s.name, mock.posts.length === 1 && !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(main) && (await visibleBody(page).locator(".text-bad").count()) > 0);
    await shot(page, s, "save-failed");
    await page.close();
  }),
);

// ---- C1: calm at 390 with nothing open fits one screen above the bottom bar; C5s calm opens nothing at 390, Access at 1440 ----
await guarded("C1", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    if (s.name === "390") {
      // Measure at the end of the page: the fixed bar overlays the page top, so a scroll-0 reading mixes page and viewport coordinates.
      const m = await page.evaluate(() => {
        scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
        const list = document.querySelector("[data-feature=strips]")?.getBoundingClientRect();
        const bar = [...document.querySelectorAll("nav, [data-bottom-bar]")].map((e) => e.getBoundingClientRect()).filter((r) => r.top > innerHeight / 2).sort((a, b) => a.top - b.top)[0];
        return { bottom: Math.round(list?.bottom ?? 0), barTop: Math.round(bar?.top ?? innerHeight), scrollHeight: document.documentElement.scrollHeight };
      });
      record("C1 list above the bottom bar", "390", { ...m, ok: m.bottom <= m.barTop });
      record("C1 page scrollHeight", "390", { value: m.scrollHeight, ok: m.scrollHeight <= 1080 }); // 940 before the Calendar and Restore drill strips (about 66 px each)
      record("C5s calm opens nothing", "390", (await Promise.all(STRIPS.map((id) => isOpen(page, id)))).every((v) => !v));
    } else {
      record("C5s calm opens Access", "1440", await isOpen(page, "access"));
    }
    await page.close();
  }),
);

// ---- C5s: a strip the person opened stays open through a save failure ----
await guarded("C5s-keep", () =>
  each(async (s) => {
    const { page } = await visit(s, "saveFailed", { hash: "#minecraft" });
    record("C5s opened strip kept", s.name, await isOpen(page, "minecraft"));
    await page.close();
  }),
);

// ---- C6 calm paint, C12 contrast-by-token and reduced motion: open each strip in turn ----
await guarded("C6", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    let n = 0;
    const sample = [];
    for (const id of STRIPS) {
      await openStrip(page, id);
      const hits = await paint(page);
      n += hits.length;
      sample.push(...hits.slice(0, 1));
    }
    record("C6 calm paint (no bad or warn)", s.name, n ? { n, sample: sample.slice(0, 3) } : 0);
    if (s.name === "390") {
      for (const id of STRIPS) {
        await openStrip(page, id);
        const t = await small(page);
        if (t.length) record("C12 targets under 44 px (strip open)", id, t.join("|"));
      }
    }
    await page.close();
  }),
);

// ---- C7: the answer slot keeps its box for a 1-line and a 4-line answer ----
await guarded("C7", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    const box = () => page.locator("[data-feature=answer]").evaluate((el) => el.getBoundingClientRect().height);
    const one = await box();
    await page.locator("[data-feature=answer]").evaluate((el) => { el.textContent = "Short."; });
    const short = await box();
    await page.locator("[data-feature=answer]").evaluate((el) => { el.textContent = "A long answer. ".repeat(40); });
    const four = await box();
    record("C7 answer slot height delta", s.name, { one, short, four, ok: one === short && short === four });
    await page.close();
  }),
);

// ---- C9: a typed Minecraft URL survives closing and reopening; the line, chip and answer say so ----
await guarded("C9", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#minecraft" });
    const url = field(page, "Manager URL");
    await url.fill("http://homelab.local:9999");
    await page.waitForTimeout(150);
    record("C9 chip Unsaved", s.name, (await text(page, "[data-feature=chip]")).trim() === "Unsaved");
    record("C9 answer names Minecraft", s.name, (await text(page, "[data-feature=answer]")).includes("Minecraft"));
    record("C9 strip line reads Edited", s.name, (await text(page, '[data-row-id="minecraft"] .st-state')).includes("Edited · not saved"));
    await shot(page, s, "unsaved-draft");
    await openStrip(page, "hermes");
    await page.locator('[data-k="open-minecraft"]').click();
    if (!(await isOpen(page, "minecraft"))) await page.locator('[data-k="open-minecraft"]').click();
    record("C9 value kept", s.name, (await field(page, "Manager URL").inputValue()) === "http://homelab.local:9999");
    await page.close();
  }),
);

// ---- C2c: Clear sends nothing before Yes; Escape and Cancel close the frame ----
await guarded("C2c", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "calm", { hash: "#homeassistant" });
    const before = mock.posts.length;
    await visibleBody(page).getByRole("button", { name: "Clear" }).first().click();
    const asked = await page.getByRole("button", { name: "Yes, clear" }).isVisible();
    await page.keyboard.press("Escape");
    const closed = !(await page.getByRole("button", { name: "Yes, clear" }).isVisible());
    await visibleBody(page).getByRole("button", { name: "Clear" }).first().click();
    await page.getByRole("button", { name: "Cancel" }).first().click();
    record("C2c clear asks, Escape and Cancel close, 0 writes before Yes", s.name, asked && closed && mock.posts.length === before);
    await page.close();
  }),
);

// ---- C2c (widgets): Delete asks first; Escape and Cancel close the frame; Yes sends one PUT carrying only widgets ----
await guarded("C2c-widget", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "calm", { hash: "#dashboard" });
    const before = mock.posts.length;
    const del = () => visibleBody(page).getByRole("button", { name: "Delete sonarr widget" });
    await del().click();
    const asked = await page.getByRole("button", { name: "Yes, delete" }).isVisible();
    await page.keyboard.press("Escape");
    const closed = !(await page.getByRole("button", { name: "Yes, delete" }).isVisible());
    await del().click();
    await page.getByRole("button", { name: "Cancel" }).first().click();
    record("C2c widget delete asks, Escape and Cancel close, 0 writes before Yes", s.name, asked && closed && mock.posts.length === before);
    await del().click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await page.waitForTimeout(400);
    const put = mock.bodies.map((b) => JSON.parse(b ?? "{}"));
    record("C2c widget delete: one PUT, only widgets", s.name, mock.posts.length === before + 1 && put.length === 1 && Object.keys(put[0]).join() === "widgets");
    await page.close();
  }),
);

// ---- C9 (Hermes, Dashboard): a typed draft survives closing and reopening; the line, chip and answer say so ----
await guarded("C9-hermes-dashboard", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#hermes" });
    await field(visibleBody(page), "Channel ID").fill("123456789");
    await page.waitForTimeout(150);
    record("C9 hermes chip Unsaved", s.name, (await text(page, "[data-feature=chip]")).trim() === "Unsaved");
    record("C9 hermes answer names Hermes", s.name, (await text(page, "[data-feature=answer]")).includes("Hermes"));
    record("C9 hermes line reads Edited", s.name, (await text(page, '[data-row-id="hermes"] .st-state')).includes("Edited · not saved"));
    await openStrip(page, "dashboard");
    await visibleBody(page).getByRole("button", { name: "Add widget" }).click();
    await page.waitForTimeout(150);
    record("C9 dashboard line reads Edited (editor open)", s.name, (await text(page, '[data-row-id="dashboard"] .st-state')).includes("Edited · not saved"));
    await openStrip(page, "hermes");
    record("C9 hermes value kept", s.name, (await field(visibleBody(page), "Channel ID").inputValue()) === "123456789");
    await openStrip(page, "dashboard");
    record("C9 widget editor kept", s.name, await visibleBody(page).getByRole("button", { name: "Save widget" }).isVisible());
    await page.close();
  }),
);

// ---- C11: /settings#minecraft opens Minecraft ----
await guarded("C11", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#minecraft" });
    record("C11 deep link opens Minecraft", s.name, await isOpen(page, "minecraft"));
    await page.close();
  }),
);

// ---- C2: inventory (inventory.json: the 98 spec kinds as probes): each is found and visible once its strip is open and its steps ran ----
// Entries with steps get a fresh page; the rest share one per fixture. `none` entries have no stable selector and are listed, not probed.
const probe = (body, k) => {
  const scope = k.scope ? body.locator(k.scope) : body;
  const exact = Boolean(k.exact);
  const loc = { label: () => scope.getByLabel(k.name, { exact }), button: () => scope.getByRole("button", { name: k.name, exact }), css: () => scope.locator(k.name), placeholder: () => scope.getByPlaceholder(k.name) }[k.by]();
  return (k.nth === undefined ? loc : loc.nth(k.nth)).evaluateAll((els) => els.some((e) => e.getClientRects().length > 0));
};
await guarded("C2", () =>
  each(async (s) => {
    const inv = JSON.parse(readFileSync(new URL("./fixtures/settings/inventory.json", import.meta.url), "utf8")).filter((k) => k.width === "both" || k.width === s.name);
    const missing = [];
    const noSelector = inv.filter((k) => k.none).map((k) => k.id);
    const shared = {};
    for (const k of inv.filter((k) => !k.none)) {
      const page = k.steps.length ? (await visit(s, k.fixture)).page : (shared[k.fixture] ??= (await visit(s, k.fixture)).page);
      await openStrip(page, k.strip);
      const body = page.locator(s.name === "1440" ? "#st-pane" : `#st-body-${k.strip}`);
      const stepScope = k.scope ? body.locator(k.scope) : body; // "Current password" also labels the Change password card
      for (const st of k.steps) {
        if (Array.isArray(st)) await field(stepScope, st[0]).fill(st[1]);
        else await stepScope.getByRole("button", { name: st, exact: st === "Replace" }).first().click();
        await page.waitForTimeout(150);
      }
      if (!(await probe(body, k).catch(() => false))) missing.push(k.id);
      if (k.steps.length) await page.close();
    }
    for (const p of Object.values(shared)) await p.close();
    record("C2 inventory found", s.name, { found: inv.length - noSelector.length - missing.length, of: inv.length - noSelector.length, missing, noSelector });
  }),
);

// ---- C12: reduced motion leaves no running transition; C14 below ----
await guarded("C12-motion", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { reduced: true });
    await openStrip(page, "access");
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    record("C12 reduced motion: running animations", s.name, running);
    await page.close();
  }),
);

// ---- H13: widget-switch, budget-hint, rcon-port-error, access-stamp (hunt 13 settings fixes) ----
// Padded element crop (16 px, clamped to the page) after an instant scroll; the check fails when fixed or sticky chrome covers the crop rect.
async function cropEl(page, s, loc, name, full = true) {
  await page.addStyleTag({ content: "nav.fixed { visibility: hidden !important; }" }); // the same fixed bottom nav the other states hide
  // loc may match several elements: the crop is their union. A target that fits scrolls to just under the sticky mobile header; a taller one hides that header before the full-page clip.
  const { clip, covered } = await loc.evaluateAll((els, pad) => {
    const union = () => {
      const rs = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...rs.map((r) => r.left)) - pad, top = Math.min(...rs.map((r) => r.top)) - pad;
      return { left, top, right: Math.max(...rs.map((r) => r.right)) + pad, bottom: Math.max(...rs.map((r) => r.bottom)) + pad };
    };
    const head = document.querySelector("header.md\\:hidden");
    const hh = head && getComputedStyle(head).display !== "none" ? head.getBoundingClientRect().height : 0;
    let box = union();
    if (box.bottom - box.top + hh <= innerHeight) {
      scrollTo({ top: Math.max(0, scrollY + box.top - hh - 1), behavior: "instant" }); // 1 px spare: fractional header heights left a sub-pixel overlap
      box = union();
      // A page that cannot scroll further leaves the padded top under the bar: clip from just below the bar (whole target stays inside, only padding is trimmed).
      if (hh) box.top = Math.max(box.top, Math.ceil(head.getBoundingClientRect().bottom));
    } else if (head) head.style.visibility = "hidden";
    const covered = [...document.querySelectorAll("body *")].filter((e) => {
      const cs = getComputedStyle(e);
      if (!["fixed", "sticky"].includes(cs.position) || cs.visibility === "hidden" || cs.display === "none" || els.some((t) => e.contains(t))) return false;
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top;
    }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`);
    const x = Math.max(0, box.left + scrollX), y = Math.max(0, box.top + scrollY);
    const w = Math.min(document.documentElement.scrollWidth, box.right + scrollX) - x, h = Math.min(document.documentElement.scrollHeight, box.bottom + scrollY) - y;
    return { clip: { x, y, width: w, height: h }, covered };
  }, 16);
  record("H13 crop clear of fixed or sticky chrome", `${name}@${s.name}`, covered.length ? covered : "ok");
  if (covered.length) fail(s.name, `${name}: crop covered by ${covered.join(", ")}`); // a FAIL record makes the helper print SHOTS fail
  await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}.png`), fullPage: true, clip });
  if (full) await fullShot(page, s, name);
}
FIXTURES.twoWidgets ??= (() => {
  const f = structuredClone(FIXTURES.calm);
  f.get.config.widgets.push({ id: "w2", type: "generic", container: "radarr", url: "http://homelab.local:7878", keySet: false, passwordSet: false, paths: "Queued:queue.total" });
  return f;
})();
await guarded("widget-switch", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "twoWidgets", { hash: "#dashboard" });
    const body = visibleBody(page).first();
    const edits = body.getByRole("button", { name: "edit", exact: true });
    await edits.nth(0).click();
    const editor = body.locator(".panel.border-accent\\/30").first();
    await editor.waitFor({ timeout: SLOW });
    const first = await editor.getByLabel("Container").inputValue();
    await edits.nth(1).click();
    await page.waitForTimeout(200);
    const second = await editor.getByLabel("Container").inputValue();
    const url = await editor.getByLabel("Service URL").inputValue();
    record("H13 A1 editor shows widget B after A (title = container)", s.name, { first, second, url, ok: first === "sonarr" && second === "radarr" && url === "http://homelab.local:7878" });
    record("H13 A1 no write while switching", s.name, mock.posts.length === 0);
    await cropEl(page, s, editor, "widget-switch");
    await page.close();
  }),
);
await guarded("budget-hint", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#hermes" });
    const input = field(visibleBody(page), "Daily budget (USD)").first();
    const group = input.locator("xpath=..");
    const copy = "Blank keeps the current cap. It can't be removed; the most is $1000.";
    record("H13 A5 budget hint copy", s.name, (await group.innerText()).includes(copy));
    const ids = (await input.getAttribute("aria-describedby")) ?? "";
    record("H13 A5 hint wired by aria-describedby", s.name, ids.includes("-hint"));
    await cropEl(page, s, group, "budget-hint");
    await page.close();
  }),
);
await guarded("rcon-port-error", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "calm", { hash: "#minecraft" });
    const input = field(visibleBody(page), "RCON port").first();
    await input.fill("abc");
    const before = mock.posts.length;
    await visibleBody(page).getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(500);
    const group = input.locator("xpath=..");
    record("H13 A6 error copy", s.name, (await group.innerText()).includes("Port must be a whole number from 1 to 65535."));
    record("H13 A6 field invalid", s.name, (await input.getAttribute("aria-invalid")) === "true");
    record("H13 A6 no PUT sent", s.name, mock.posts.length === before);
    await cropEl(page, s, group, "rcon-port-error");
    await page.close();
  }),
);
// ---- polish12: password errors wait for the field's first blur (ONLY=pw12 runs just this). State: pw12-blur-short (both widths) ----
await guarded("pw12", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#access" });
    const c = visibleBody(page).first().locator('section:has(> div > h3:text-is("Change password"))');
    await c.waitFor({ timeout: SLOW });
    const next = c.getByPlaceholder("at least 8 characters");
    await next.fill("abc");
    record("polish12 short before blur: no error", s.name, (await c.innerText()).includes("needs at least 8") === false);
    await next.blur(); // confirm is never focused before the mismatch check
    record("polish12 short after blur: error", s.name, (await c.innerText()).includes("needs at least 8"));
    await next.fill("abcdefgh");
    await field(c, "Confirm new password").fill("abcdefgx");
    record("polish12 mismatch waits for the confirm blur", s.name, (await c.innerText()).includes("don't match") === false);
    await next.focus();
    record("polish12 mismatch after confirm blur", s.name, (await c.innerText()).includes("don't match"));
    await next.fill("abc");
    await next.blur();
    await cropEl(page, s, c, "pw12-blur-short", false);
    await page.close();
  }),
);
// ---- nw-tileurl: a schemeless App URL is refused in the card, nothing is sent, the error stays inside the card ----
await guarded("tileurl-refused", () =>
  each(async (s) => {
    const { page, mock } = await visit(s, "calm", { hash: "#dashboard" });
    const body = visibleBody(page);
    await body.getByRole("group", { name: "Container scope" }).getByRole("button").last().click();
    // Desktop table inputs carry an aria-label; the phone cards use a Field label "App URL" and name the container in the card heading.
    const desk = body.locator('input[aria-label^="App URL for "]:visible').first();
    const phone = !(await desk.count());
    const input = phone ? body.getByLabel("App URL", { exact: true }).locator("visible=true").first() : desk;
    const name = phone
      ? (await input.locator("xpath=ancestor::div[contains(@class,'panel')][1]").locator("span.font-mono").first().innerText()).trim()
      : ((await desk.getAttribute("aria-label")) ?? "").replace("App URL for ", "");
    await input.fill("myapp.lan:8080");
    const before = mock.posts.length;
    await body.getByRole("button", { name: "Save tiles" }).click();
    await page.waitForTimeout(500);
    const line = body.locator("p.text-bad").first();
    record("nw-tileurl error copy", s.name, (await line.innerText()) === `The App URL for ${name} must start with http:// or https://`);
    record("nw-tileurl no PUT sent", s.name, mock.posts.length === before);
    record("nw-tileurl typed value kept", s.name, (await input.inputValue()) === "myapp.lan:8080");
    record("polish12 refused App URL input invalid", s.name, (await input.getAttribute("aria-invalid")) === "true"); // marked in the tileurl-refused crop
    await input.fill("myapp.lan:8081");
    record("polish12 mark clears when the value changes", s.name, (await input.getAttribute("aria-invalid")) === null);
    await input.fill("myapp.lan:8080");
    await body.getByRole("button", { name: "Save tiles" }).click();
    await page.waitForTimeout(500);
    const inside = await line.evaluate((el) => { const r = el.getBoundingClientRect(), c = el.parentElement.getBoundingClientRect(); return r.right <= c.right + 0.5 && el.scrollWidth <= el.clientWidth + 1; });
    record("nw-tileurl error line inside the card", s.name, inside);
    await cropEl(page, s, line.locator("xpath=.."), "tileurl-refused");
    await page.close();
  }),
);
await guarded("access-stamp", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#access" });
    const body = visibleBody(page).first();
    const stamped = async (title) => (await body.locator(`section:has(> div > h3:text-is("${title}"))`).innerText()).includes("last saved");
    record("H13 A7 stamp kept on System, gone from Orchestra and SSO", s.name, { system: await stamped("System"), orchestra: await stamped("Orchestra"), sso: await stamped("SSO / OIDC") });
    const cards = body.locator(["System", "SSO / OIDC", "Orchestra"].map((t) => `section:has(> div > h3:text-is("${t}"))`).join(", "));
    await cropEl(page, s, cards, "access-stamp");
    await page.close();
  }),
);

// ---- step-up: the Current password field on the SSO and System cards (ONLY=stepup runs just this) ----
// Every API call stays mocked; the system route answers 403 with its real wrong-password body where a state needs it.
await guarded("stepup", () =>
  each(async (s) => {
    const su = (name, vp, ok) => record(`SU ${name}`, vp, ok);
    const desk = s.name === "1440";
    const sizes = [];
    const card = (page, title) => visibleBody(page).first().locator(`section:has(> div > h3:text-is("${title}"))`);
    const pw = (c) => field(c, "Current password");
    const saveBtn = (c) => c.getByRole("button", { name: "Save", exact: true });
    const fontOf = async (loc) => sizes.push(await loc.first().evaluate((e) => getComputedStyle(e).fontSize));
    const focused = (loc) => loc.evaluate((e) => e === document.activeElement);
    const boxOf = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { h: r.height, right: r.right }; });
    /** Numeric checks: no sideways scroll, the field inside its card, and the field as tall as the sibling Input. */
    async function fits(page, name, c, sibling) {
      su("no horizontal scroll", `${name}@${s.name}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (await pw(c).count()) {
        const f = await boxOf(pw(c)), box = await boxOf(c);
        su("field right edge inside its card", `${name}@${s.name}`, f.right <= box.right);
        if (sibling) su("field as tall as the sibling Input", `${name}@${s.name}`, f.h === (await boxOf(sibling)).h);
      }
    }
    const open = async (key = "calm") => {
      const { page } = await visit(s, key, { hash: "#access" });
      const sent = [];
      await page.route("**/api/settings/system", (route) =>
        route.request().method() === "POST" ? (sent.push(route.request().postData()), route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Current password is incorrect.", stepUp: "wrong" }) })) : route.fallback());
      return { page, sent };
    };
    const wrong = async (page, c, sent, name) => {
      await page.waitForTimeout(600);
      const err = c.locator(".text-bad");
      su(`${name}: one save sent, footer error shown`, s.name, sent.length === 1 && (await err.count()) === 1 && (await err.innerText()).includes("Current password is incorrect"));
      su(`${name}: field empty and focused`, s.name, (await pw(c).inputValue()) === "" && (await focused(pw(c))));
      await fontOf(c.locator("#sso-step-up-hint, #system-step-up-hint"));
      await fontOf(err);
    };
    const pinReady = async (c) => {
      await c.getByRole("group", { name: "Kiosk PIN" }).locator("xpath=..").getByRole("button", { name: "Replace" }).click();
      await field(c, "Kiosk PIN").fill("1234");
    };

    // SSO untouched: no field. Dirty: the field above Save, Save disabled. Wrong: footer error, field cleared and focused.
    if (desk) {
      const { page } = await open();
      const c = card(page, "SSO / OIDC");
      su("sso untouched: no Current password field", s.name, (await pw(c).count()) === 0);
      await cropEl(page, s, c, "stepup-sso-untouched", false);
      await page.close();
    }
    {
      const { page } = await open();
      const c = card(page, "SSO / OIDC");
      await field(c, "Issuer").pressSequentially("x");
      await pw(c).waitFor({ timeout: SLOW });
      const above = await c.evaluate((sec) => {
        const f = sec.querySelector("input[type=password][autocomplete=current-password]").getBoundingClientRect();
        return f.bottom <= [...sec.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").getBoundingClientRect().top;
      });
      su("sso dirty: field above Save, Save disabled", s.name, above && (await saveBtn(c).isDisabled()));
      await fits(page, "sso-dirty", c, field(c, "Issuer"));
      await cropEl(page, s, c, "stepup-sso-dirty", true);
      await page.close();
    }
    if (desk) {
      const { page, sent } = await open();
      const c = card(page, "SSO / OIDC");
      await field(c, "Issuer").pressSequentially("x");
      await pw(c).fill("not-the-password");
      await saveBtn(c).click();
      await wrong(page, c, sent, "sso wrong");
      await cropEl(page, s, c, "stepup-sso-wrong", false);
      await page.close();
    }

    // System untouched: field empty with its hint, Generate and Save disabled.
    {
      const { page } = await open();
      const c = card(page, "System");
      const gen = c.getByRole("button", { name: "Generate", exact: true });
      su("system untouched: field empty with hint, Generate and Save disabled", s.name, (await pw(c).inputValue()) === "" && (await c.locator("#system-step-up-hint").innerText()).length > 0 && (await gen.isDisabled()) && (await saveBtn(c).isDisabled()));
      await fontOf(c.locator("#system-step-up-hint"));
      await fits(page, "system-untouched", c, null);
      await cropEl(page, s, c, "stepup-system-untouched", false);
      await page.close();
    }
    // Kiosk PIN Clear (saved PIN in the fixture): the trigger beside the label, disabled until the password is typed, the ask frame open.
    // Numeric: height at or above the C12 floor (43.5 px at 390, the house Button tap minimum) and equal to Generate's (same WriteAction trigger); right edge inside the card (no sideways scroll).
    {
      const { page, sent } = await open();
      const c = card(page, "System");
      const clr = c.getByRole("button", { name: "Clear kiosk PIN" });
      const gen = c.getByRole("button", { name: "Generate", exact: true });
      su("pin clear: one control, disabled with an empty password", s.name, (await clr.count()) === 1 && (await clr.isDisabled()));
      const b = await boxOf(clr), g = await boxOf(gen), box = await boxOf(c);
      su("pin clear: control height meets the C12 tap floor and equals Generate's", s.name, (s.name !== "390" || b.h >= 43.5) && b.h === g.h);
      su("pin clear: control inside the card, no sideways scroll", s.name, b.right <= box.right && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
      if (!desk) await cropEl(page, s, c, "stepup-pin-clear-disabled", false);
      else await cropEl(page, s, c, "stepup-pin-clear", false);
      await pw(c).fill("not-the-password");
      su("pin clear: enabled once the password is typed", s.name, await clr.isEnabled());
      await clr.click();
      const yes = c.getByRole("button", { name: "Yes, clear" });
      await yes.waitFor({ timeout: SLOW });
      await page.waitForTimeout(400); // settle: measured or cropped straight after the frame opens, the Yes height flickers at 390 and at 1440 the password empties and the frame closes; after a settle every crop step keeps both (probed 2026-11-17). Cause not found.
      // The frame takes focus on open (Cancel, the safe choice: WriteAction's autoFocus), so a focus-driven hold never lapses.
      su("pin clear: focus moves into the ask frame", s.name, await yes.locator("xpath=ancestor::div[contains(@class,'st-frame')]").evaluate((f) => f.contains(document.activeElement)));
      su("pin clear: focus lands on Cancel", s.name, (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Cancel");
      const y = await boxOf(yes), ask = await boxOf(yes.locator("xpath=ancestor::div[contains(@class,'st-frame')]"));
      const lab = c.locator("label", { hasText: /^Kiosk PIN$/ });
      const labelH = await lab.evaluate((e) => { const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight); return { h: e.getBoundingClientRect().height, line: Number.isNaN(lh) ? parseFloat(cs.fontSize) * 1.4 : lh }; });
      su("pin clear: ask frame states the consequence", s.name, /KIOSK_PIN from the environment/.test(await c.innerText()));
      su("pin clear: Yes meets the C12 tap floor", s.name, s.name !== "390" || y.h >= 43.5);
      su("pin clear: ask frame inside the card", s.name, ask.right <= box.right);
      su("pin clear: Kiosk PIN label stays on one line while the ask frame is open", s.name, labelH.h <= labelH.line + 1);
      // Records, not checks: what the page looked like either side of the crop. `doc` false = the document reloaded; `frame` false with `doc` true = the React tree remounted or the frame closed.
      const snap = () =>
        page.evaluate(() => {
          const a = document.activeElement, f = document.querySelector(".st-frame");
          return {
            open: (document.querySelector(".st-pane h2") ?? document.querySelector(".st-strip[data-on] .st-name"))?.textContent?.trim() ?? null,
            innerWidth, scrollY: Math.round(scrollY), hash: location.hash,
            active: a ? `${a.tagName.toLowerCase()}:${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 24)}` : null,
            doc: window.__pcMark === 1, frame: !!f && f.__pcMark === 1, frames: document.querySelectorAll(".st-frame").length,
          };
        });
      await page.evaluate(() => { window.__pcMark = 1; document.querySelector(".st-frame").__pcMark = 1; });
      record("SU pin clear: state before the crop", s.name, JSON.stringify(await snap()));
      await cropEl(page, s, c, "stepup-pin-clear-ask", false);
      record("SU pin clear: state after the crop", s.name, JSON.stringify(await snap()));
      // Names the cause of a Yes click that times out: false here means the page lost its state during the crop (a reload), true means the click itself was blocked.
      su("pin clear: ask frame and typed password survive the crop", s.name, (await yes.count()) === 1 && (await pw(c).inputValue()) === "not-the-password");
      await yes.click();
      await wrong(page, c, sent, "pin clear wrong");
      su("pin clear wrong: the body held only clearKioskPin and the password", s.name, sent.length === 1 && JSON.stringify(Object.keys(JSON.parse(sent[0])).sort()) === JSON.stringify(["clearKioskPin", "currentPassword"]));
      await page.close();
    }
    if (desk) {
      {
        const { page } = await open();
        const c = card(page, "System");
        await pinReady(c);
        su("system ready: Save disabled until the password is typed", s.name, await saveBtn(c).isDisabled());
        await pw(c).fill("not-the-password");
        su("system ready: Save enabled", s.name, await saveBtn(c).isEnabled());
        await fits(page, "system-ready", c, field(c, "Kiosk PIN"));
        await cropEl(page, s, c, "stepup-system-ready", false);
        await page.close();
      }
      {
        const { page, sent } = await open();
        const c = card(page, "System");
        await pinReady(c);
        await pw(c).fill("not-the-password");
        await saveBtn(c).click();
        await wrong(page, c, sent, "system wrong");
        await cropEl(page, s, c, "stepup-system-wrong", false);
        await page.close();
      }
      {
        const { page, sent } = await open();
        const c = card(page, "System");
        const gen = c.getByRole("button", { name: "Generate", exact: true });
        await pw(c).fill("not-the-password");
        await gen.click();
        const yes = c.getByRole("button", { name: "Yes, generate" });
        if (await yes.count()) await yes.click();
        await wrong(page, c, sent, "generate wrong");
        const idle = !/Generating…|Couldn’t generate a token/.test(await c.innerText());
        su("generate wrong: Generate idle and disabled again", s.name, idle && (await gen.count()) === 1 && (await gen.isDisabled()));
        await cropEl(page, s, c, "stepup-generate-wrong", false);
        await page.close();
      }
      // No password configured: a standing warning in both cards, no field.
      {
        const { page } = await open("noPassword");
        const both = [];
        for (const t of ["System", "SSO / OIDC"]) {
          const c = card(page, t);
          const warn = c.getByText("No admin password is set");
          both.push((await warn.count()) === 1 && (await pw(c).count()) === 0);
          await fontOf(warn);
        }
        su("no password: both cards warn and show no field", s.name, both.every(Boolean));
        await cropEl(page, s, card(page, "System"), "stepup-no-password", false);
        await page.close();
      }
    }
    su("hint, warning and error share one computed font size", s.name, new Set(sizes).size === 1);
  }),
);

// ---- C3: sentinels against the REAL API (opt-in; the lead tears the stack's data volume down afterwards) ----
if (process.env.SENTINELS) {
  await guarded("C3", async () => {
    const s = sessions[0];
    try {
    const { page } = await visit(s, "calm", { real: true });
    const fields = [
      ["homeassistant", "Long-lived access token"], ["npm", "Admin password"], ["forgejo", "Access token"], ["github", "Personal access token"],
      ["minecraft", "Manager token"], ["minecraft", "CurseForge API key"], ["minecraft", "RCON password"],
      ["access", "Kiosk PIN"], ["access", "Client secret"], ["access", "Service token"],
      // Hermes model keys sit in the first Save form, the Discord pair in the second (page order).
      ["hermes", "OpenRouter API key", "first"], ["hermes", "Anthropic API key", "first"], ["hermes", "Webhook URL", "last"], ["hermes", "Bot token", "last"],
    ];
    for (const [strip, label, which = "last"] of fields) {
      stage = `C3:${strip}:${label}`;
      await openStrip(page, strip);
      const body = visibleBody(page);
      const replace = body.getByRole("group", { name: label }).locator("xpath=following-sibling::button[1]");
      if (await replace.count()) await replace.click();
      await field(body, label).fill(label === "Kiosk PIN" ? "86420" : `NWSENTINEL-${label.replace(/\W+/g, "-")}`);
      // Access holds four forms, so its Save is the one inside the field's own subsection.
      const sub = { "Kiosk PIN": "System", "Client secret": "SSO / OIDC", "Service token": "Orchestra" }[label];
      const saves = (sub ? body.locator(`section:has(> div > h3:text-is("${sub}"))`) : body).getByRole("button", { name: "Save", exact: true });
      await (which === "first" ? saves.first() : saves.last()).click();
      await page.waitForTimeout(800);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    let hits = 0;
    for (const id of STRIPS) {
      await openStrip(page, id);
      hits += await page.evaluate(() => (document.documentElement.outerHTML.match(/NWSENTINEL-|86420/g) ?? []).length + [...document.querySelectorAll("input")].filter((i) => /NWSENTINEL-|^86420$/.test(i.value)).length);
    }
    const body = await page.request.get(`${BASE_URL}/api/settings`).then((r) => r.text());
    record("C3 sentinel hits (html, inputs, GET body)", "1440", hits + (body.match(/NWSENTINEL-|86420/g) ?? []).length);
    await page.close();
    } catch (e) { await failShot(s, e); }
  });
}

// ---- C10 (K12), REAL API, opt-in: a widget save leaves the tile edit in the field; each PUT carries only its own fields; GET holds both ----
if (process.env.C10 || process.env.SENTINELS) {
  await guarded("C10", async () => {
    const s = sessions[0];
    try {
      const { page } = await visit(s, "calm", { hash: "#dashboard", real: true });
      const puts = [];
      page.on("request", (r) => r.method() === "PUT" && new URL(r.url()).pathname === "/api/settings" && puts.push(Object.keys(JSON.parse(r.postData() ?? "{}")).sort().join()));
      const body = visibleBody(page);
      await body.getByRole("group", { name: "Container scope" }).getByRole("button").last().click();
      const group = body.locator('input[aria-label^="Group for "]:visible').first();
      await group.fill("NWC10-group");
      await body.getByRole("button", { name: "Add widget" }).click();
      const sel = body.getByLabel("Container", { exact: true });
      const hasOpt = (await sel.locator("option").count()) > 1; // the real test stack may offer no container
      if (hasOpt) await sel.selectOption({ index: 1 });
      await body.getByLabel("Service URL").fill("http://homelab.local:1");
      if (hasOpt) {
        await body.getByRole("button", { name: "Save widget" }).click();
        await page.waitForTimeout(1200);
        record("C10 tile edit kept after a widget save", "1440", (await group.inputValue()) === "NWC10-group");
      } else record("C10 skipped: no container", "1440", true);
      await body.getByRole("button", { name: "Save tiles" }).click();
      await page.waitForTimeout(1200);
      const cfg = await page.request.get(`${BASE_URL}/api/settings`).then((r) => r.json());
      record("C10 GET holds both changes", "1440", JSON.stringify(cfg.config.groups).includes("NWC10-group") && (!hasOpt || cfg.config.widgets.some((w) => w.url === "http://homelab.local:1")));
      record("C10 PUT bodies: widget then tiles", "1440", puts.join(" | ") === (hasOpt ? "widgets | " : "") + "groups,hidden,icons,urls");
      await page.close();
    } catch (e) { await failShot(s, e); }
  });
}

// ---- Restore drill strip: states, copy and numeric checks (restore-drill shape brief, sections 3, 5 and 6) ----
// The strip body is the open strip's body. States: settings-blank, -typed, -invalid (a year before 2000: a date input cannot
// hold an unreal day, so "That isn't a real date" is covered by backup-status.test.ts), -future, -saving, -save-failed, -offline, -saved-due.
{
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(NOW);
  const dayIso = (daysAgo) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
  FIXTURES.restoreDue ??= (() => {
    const f = structuredClone(FIXTURES.calm);
    f.get.config.restoreTestedOn = dayIso(127);
    return f;
  })();
  const KEY = "restore drill";
  const rec = (name, vp, v) => record(`${KEY} ${name}`, vp, v);
  const save = (body) => body.getByRole("button", { name: "Save", exact: true });
  const drillInput = (body) => field(body, "Last restore drill").first();
  /** Contrast of one element's text against its composited backdrop, in the page. */
  const contrastOf = (loc) =>
    loc.evaluate((el) => {
      const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const rgba = (css) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
      const chain = [];
      for (let n = el; n; n = n.parentElement) chain.unshift(getComputedStyle(n).backgroundColor);
      const bg = chain.reduce((base, css) => { const [r, g, b, a] = rgba(css); return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)]; }, [255, 255, 255]);
      const [r, g, b, a] = rgba(getComputedStyle(el).color);
      const fg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
      const lum = ([x, y, z]) => { const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(x) + 0.7152 * f(y) + 0.0722 * f(z); };
      const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p);
      return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
    });
  const height = (loc) => loc.evaluate((el) => +el.getBoundingClientRect().height.toFixed(1));

  await guarded("restore-drill", () =>
    each(async (s) => {
      // Blank, typed, invalid and future: nothing saved, nothing written until Save.
      {
        const { page, mock } = await visit(s, "calm", { hash: "#restore" });
        const body = visibleBody(page).first();
        const input = drillInput(body);
        rec("blank: saved line", s.name, (await body.innerText()).includes("Nothing saved yet. The backup tile says no drill is recorded."));
        rec("blank: Save disabled", s.name, await save(body).isDisabled());
        await cropEl(page, s, body, "settings-blank", false);

        await input.fill(dayIso(35));
        rec("typed: Save enabled, no error", s.name, (await save(body).isEnabled()) && !(await body.innerText()).includes("That "));
        await cropEl(page, s, body, "settings-typed", false);

        await input.fill("1999-12-31");
        rec("invalid: copy and Save disabled", s.name, (await body.innerText()).includes("Pick a date from 2000 on.") && (await save(body).isDisabled()));
        await cropEl(page, s, body, "settings-invalid", false);

        await input.fill(dayIso(-1));
        rec("future: copy and Save disabled", s.name, (await body.innerText()).includes("That date hasn't happened yet. Enter the day you last tested a restore.") && (await save(body).isDisabled()));
        await cropEl(page, s, body, "settings-future", false);
        rec("no write before Save", s.name, mock.posts.length === 0);

        // 4. Tap target: the date Input and the Save Button match the house ones (Input h-11 / md:h-8, Button size sm).
        await input.fill(dayIso(35));
        const own = { input: await height(input), save: await height(save(body)) };
        await page.close();
        const bins = await visit(s, "calm", { hash: "#bins" });
        const binInput = await height(visibleBody(bins.page).first().locator("input").first());
        await bins.page.close();
        const cal = await visit(s, "calm", { hash: "#calendar" });
        const calSave = await height(save(visibleBody(cal.page).first()));
        await cal.page.close();
        rec("4 tap target: Input and Save match the house ones", s.name, { ...own, binInput, calSave, ok: own.input === binInput && own.save === calSave && (s.name !== "390" || own.input >= 44) });
      }

      // Saving: the request hangs, Save stays disabled.
      for (const [state, route, want] of [
        ["saving", (r) => undefined, null],
        ["save-failed", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't write the settings file (placeholder reason)." }) }), "Couldn't write the settings file (placeholder reason)."],
        ["offline", (r) => r.abort("failed"), "Couldn't reach the server. Nothing was saved."],
      ]) {
        const { page } = await visit(s, "calm", { hash: "#restore" });
        await page.route("**/api/settings/integrations", route);
        const body = visibleBody(page).first();
        const input = drillInput(body);
        await input.fill(dayIso(35));
        await save(body).click();
        await page.waitForTimeout(400);
        if (state === "saving") rec("saving: Save disabled", s.name, await save(body).isDisabled());
        else rec(`${state}: server text shown and typed value kept`, s.name, (await body.innerText()).includes(want) && (await input.inputValue()) === dayIso(35));
        await cropEl(page, s, body, `settings-${state}`, false);
        await page.close();
      }

      // Saved and due: the line is amber text and still readable, and says the drill is due.
      {
        const { page } = await visit(s, "restoreDue", { hash: "#restore" });
        const body = visibleBody(page).first();
        const line = body.getByText(/^Saved: .*127 days ago\. A drill is due\.$/);
        rec("saved-due: line says due", s.name, (await line.count()) === 1);
        rec("5 contrast: due line at least 4.5:1", s.name, await contrastOf(line.first()));
        const strip = await page.locator('[data-k="open-restore"]').innerText();
        rec("strip state reads Last drill", s.name, /Last drill \d{1,2} \w{3} \d{4}/.test(strip));
        await cropEl(page, s, body, "settings-saved-due", true);
        await page.close();
      }
    }),
  );
}

// ---- step-up for Discord access on the Hermes daemon card (ONLY=stepup-discord runs just this) ----
// States: idle (no field), asking (allowlist edited: field shows, Save disabled), wrong (403: footer error, field empty and focused),
// no-password (fixture with no admin password: warning, no field). Every API call stays mocked.
await guarded("stepup-discord", () =>
  each(async (s) => {
    const su = (name, ok) => record(`SU discord ${name}`, s.name, ok);
    const card = (page) => visibleBody(page).first().locator('section:has(> div > h2:text-is("Hermes · daemon"))');
    const pw = (c) => field(c, "Current password");
    const open = async (key) => {
      const { page } = await visit(s, key, { hash: "#hermes" });
      const sent = [];
      await page.route("**/api/settings/hermes-daemon", (route) => {
        sent.push(route.request().postData());
        return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Current password is incorrect.", stepUp: "wrong" }) });
      });
      return { page, sent, c: card(page) };
    };
    const box = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, width: r.width, h: r.height, top: r.top, bottom: r.bottom }; });
    {
      const { page, c } = await open("calm");
      su("idle: no Current password field", (await pw(c).count()) === 0);
      await cropEl(page, s, c, "stepup-discord-idle", true);
      await page.close();
    }
    {
      const { page, c } = await open("calm");
      const ids = field(c, "Allowed user IDs (comma-separated)");
      await ids.pressSequentially(", 201");
      await pw(c).waitFor({ timeout: SLOW });
      const [a, p, ch] = [await box(ids), await box(pw(c)), await box(field(c, "Channel ID"))];
      su("asking: Save disabled", await c.getByRole("button", { name: "Save", exact: true }).isDisabled());
      su("asking: field as tall as Channel ID", p.h === ch.h);
      su("asking: field left edge and width equal Allowed user IDs", p.left === a.left && p.width === a.width);
      su("asking: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      su("asking: hint is 0.7rem ink-faint", await c.locator("#discord-step-up-hint").evaluate((e) => getComputedStyle(e).fontSize === "11.2px"));
      await cropEl(page, s, c, "stepup-discord-asking", true);
      await pw(c).fill("not-the-password");
      await c.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(600);
      const err = c.locator(".text-bad");
      su("wrong: footer error shown", (await err.count()) === 1 && (await err.innerText()).includes("Current password is incorrect"));
      su("wrong: field empty and focused", (await pw(c).inputValue()) === "" && (await pw(c).evaluate((e) => e === document.activeElement)));
      await cropEl(page, s, c, "stepup-discord-wrong", false);
      await page.close();
    }
    {
      const { page, c } = await open("noPassword");
      await c.waitFor({ timeout: SLOW });
      su("no password: warning shown, no field", (await c.getByText("No admin password is set").count()) === 1 && (await pw(c).count()) === 0);
      await cropEl(page, s, c, "stepup-discord-no-password", false);
      await page.close();
    }
  }),
);

// ---- hunt 69: Clear on the Orchestra row shows only for a token saved in Settings (ONLY=hunt69 runs just this) ----
// States: orchestra-saved (Clear shown), orchestra-env-only (GET mocked with orchestraTokenSaved false: no Clear, Save stays put).
await guarded("hunt69", () =>
  each(async (s) => {
    const su = (name, ok) => record(`SU hunt69 ${name}`, s.name, ok);
    const row = (page) => visibleBody(page).first().locator('section:has(> div > h3:text-is("Orchestra"))');
    const measure = async (key, name) => {
      const { page } = await visit(s, key, { hash: "#access" });
      const c = row(page);
      await c.waitFor({ timeout: SLOW });
      const clear = await c.getByRole("button", { name: /^Clear/ }).count();
      // Offsets from the card's right and bottom edges: the env-only hint line above the field legitimately moves the card's top, not the Save control.
      const save = await c.getByRole("button", { name: "Save", exact: true }).evaluate((e) => { const r = e.getBoundingClientRect(); const q = e.closest('section').getBoundingClientRect(); return [q.right - r.right, q.bottom - r.bottom, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(","); });
      await cropEl(page, s, c, name, true);
      await page.close();
      return { clear, save };
    };
    const saved = await measure("calm", "orchestra-saved");
    const env = await measure("orchestraEnvOnly", "orchestra-env-only");
    su("saved: Clear shown", saved.clear === 1);
    su("env only: Clear absent", env.clear === 0);
    su("Save control box identical in both states", saved.save === env.save);
  }),
);

// ---- config.json could not be read: head chip, answer and notice (ONLY=config-notice runs just this) ----
// States come from fixtures (the calm GET with meta.configProblem set), so no config file on any server is touched: blank, unreadable, unreadable-no-copy, plus healthy (null).
// The Sign-in off chip and the refresh-failed notice are the house references the numeric checks compare against.
for (const [key, problem] of [["cfgBlank", "blank"], ["cfgUnreadable", "unreadable"], ["cfgNoCopy", "unreadable-no-copy"], ["cfgHealthy", null]]) {
  FIXTURES[key] ??= (() => {
    const f = structuredClone(FIXTURES.calm);
    f.get.meta.configProblem = problem;
    return f;
  })();
}
await guarded("config-notice", () =>
  each(async (s) => {
    const cn = (name, ok) => record(`CN ${name}`, s.name, ok);
    const COPY = "A copy from before the last save is in data/config.json.bak. To use it, copy it over data/config.json on the server, then reload this page. To start fresh instead, remove both files. Until then, most changes here won’t save.";
    const NO_COPY = "There is no saved copy beside it. Fix data/config.json by hand on the server, or put back a backup, then reload this page. Until then, most changes here won’t save.";
    const BLANK = "The settings file is empty, so this page shows defaults.";
    const BAD = "The settings file can’t be read, so this page shows defaults.";
    const noteStyle = (page) => page.locator("[data-feature=notice]").evaluate((e) => { const c = getComputedStyle(e); return { pad: c.padding, color: c.color, bg: c.backgroundColor, mt: parseFloat(c.marginTop) }; });
    const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    // References: the existing Sign-in off chip classes and the refresh-failed notice style.
    const refChip = await (async () => { const { page } = await visit(s, "noPassword"); const c = await page.locator("[data-feature=chip]").getAttribute("class"); await page.close(); return c; })();
    const refNote = await (async () => { const { page } = await visit(s, "refreshFailed"); await page.waitForTimeout(5300); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForFunction(() => /Couldn’t refresh/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 15_000 }); const st = await noteStyle(page); await page.close(); return st; })();
    for (const [key, name, answer, notice] of [["cfgBlank", "blank", BLANK, COPY], ["cfgUnreadable", "unreadable", BAD, COPY], ["cfgNoCopy", "unreadable-no-copy", BAD, NO_COPY]]) {
      const { page } = await visit(s, key);
      const chip = page.locator("[data-feature=chip]");
      cn(`${name}: chip text`, (await chip.innerText()).trim() === "Using defaults");
      cn(`${name}: chip classes equal Sign-in off`, (await chip.getAttribute("class")) === refChip);
      const a = await page.locator("[data-feature=answer]").evaluate((e) => ({ t: e.textContent, clamped: e.scrollHeight > e.clientHeight + 1 }));
      cn(`${name}: answer text exact, no em dash`, a.t === answer && !a.t.includes("—"));
      cn(`${name}: answer not clamped`, !a.clamped);
      const n = page.locator("[data-feature=notice]");
      cn(`${name}: notice text exact, no em dash`, (await n.textContent()) === notice && !notice.includes("—"));
      const st = await noteStyle(page);
      cn(`${name}: notice padding, color, background equal refresh-failed`, st.pad === refNote.pad && st.color === refNote.color && st.bg === refNote.bg);
      cn(`${name}: notice contrast >= 4.5`, ratio(st.color, st.bg) >= 4.5);
      const gap = await page.evaluate(() => { const e = document.querySelector("[data-feature=evidence]").getBoundingClientRect(), n = document.querySelector("[data-feature=notice]").getBoundingClientRect(); return n.top - e.bottom; });
      cn(`${name}: gap equals margin-top (0.5rem) within 1 px`, Math.abs(gap - st.mt) <= 1 && Math.abs(st.mt - 8) <= 0.5);
      cn(`${name}: notice does not overflow`, await n.evaluate((e) => e.scrollWidth <= e.clientWidth));
      await cropEl(page, s, page.locator("[data-feature=head]"), `config-notice-${name}`, name === "blank");
      await page.close();
    }
    const { page } = await visit(s, "cfgHealthy");
    cn("healthy: no notice", (await page.locator("[data-feature=notice]").count()) === 0);
    cn("healthy: chip is not Using defaults", (await page.locator("[data-feature=chip]").innerText()).trim() !== "Using defaults");
    await cropEl(page, s, page.locator("[data-feature=head]"), "config-notice-healthy", false);
    await page.close();
  }),
);

// ---- unreadable-settings copy (PR 300): the empty-file notice, from the cfgBlank fixture (ONLY=unreadable-copy runs just this) ----
await guarded("unreadable-copy", () =>
  each(async (s) => {
    const uc = (n, ok, what, m) => { record(`UC${n} ${what}`, s.name, ok); console.log(`UC${n} ${ok ? "pass" : "fail"} ${what}@${s.name} ${m}`); };
    const B = "A copy from before the last save is in data/config.json.bak. To use it, copy it over data/config.json on the server, then reload this page. To start fresh instead, remove both files. Until then, most changes here won’t save.";
    const { page } = await visit(s, "cfgBlank");
    const n = page.locator("[data-feature=notice]");
    const text = (await n.textContent())?.trim();
    const fit = await n.evaluate((e) => ({ w: e.scrollWidth <= e.clientWidth, h: e.scrollHeight <= e.clientHeight + 1, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }));
    uc(12, text === B, "settings-empty-notice copy B exact", JSON.stringify(text?.slice(-60)));
    uc(6, fit.w, "settings-empty-notice no horizontal overflow", `scrollWidth ${fit.sw} clientWidth ${fit.cw}`);
    uc(7, fit.h, "settings-empty-notice not clipped", `scrollHeight ${fit.sh} clientHeight ${fit.ch}`);
    await cropEl(page, s, page.locator("[data-feature=head]"), "settings-empty-notice", true);
    await fullShot(page, s, "settings-empty-notice");
    await page.close();
  }),
);

// ---- Settings polish (PR 297): Orchestra token-from-environment hint, Hermes password cleared when its field hides (ONLY=settings-polish runs just this) ----
// States: orchestra-env-only, orchestra-saved, orchestra-none, hermes-ask-shown, hermes-ask-hidden-after-typing. Every API call stays mocked; the password is made up.
FIXTURES.orchestraNone ??= (() => { const f = structuredClone(FIXTURES.orchestraEnvOnly); f.get.meta.orchestraTokenSet = false; return f; })();
await guarded("settings-polish", () =>
  each(async (s) => {
    const sp = (id, ok, measured) => { record(`SP ${id}`, s.name, ok); console.log(`SP ${id} ${s.name} ${ok ? "pass" : "fail"} ${measured}`); };
    const row = (page) => visibleBody(page).first().locator('section:has(> div > h3:text-is("Orchestra"))');
    const HINT = "Using the token from the server environment. Entering one here replaces it.";
    const measure = async (key, name, full) => {
      const { page } = await visit(s, key, { hash: "#access" });
      const c = row(page);
      await c.waitFor({ timeout: SLOW });
      const hint = c.locator("#orchestra-token-hint");
      const save = await c.getByRole("button", { name: "Save", exact: true }).evaluate((e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left * 100) / 100, width: Math.round(r.width * 100) / 100 }; });
      const m = {
        c, hint, save, hintCount: await hint.count(), clear: await c.getByRole("button", { name: /^Clear/ }).count(),
        described: await c.locator("[aria-describedby='orchestra-token-hint']").count(),
        text: (await hint.count()) ? (await hint.innerText()).trim() : "",
        visible: (await hint.count()) ? await hint.isVisible() : false,
        style: (await hint.count()) ? await hint.evaluate((e) => { const cs = getComputedStyle(e); return `${cs.fontSize}/${cs.color}`; }) : null,
        kiosk: await visibleBody(page).first().locator("#kiosk-pin-hint").evaluateAll((es) => es.map((e) => { const cs = getComputedStyle(e); return `${cs.fontSize}/${cs.color}`; })[0] ?? null),
        fits: (await hint.count()) ? await hint.evaluate((e) => e.scrollWidth <= e.clientWidth) : null,
        rowFits: await c.evaluate((e) => e.scrollWidth <= e.clientWidth),
      };
      await cropEl(page, s, c, `settings-polish-${name}`, true);
      if (full) await fullShot(page, s, `settings-polish-${name}`);
      await page.close();
      return m;
    };
    const saved = await measure("calm", "orchestra-saved", false);
    const env = await measure("orchestraEnvOnly", "orchestra-env-only", true);
    const none = await measure("orchestraNone", "orchestra-none", false);
    sp("SP1", env.visible && env.text === HINT, `visible=${env.visible} text=${JSON.stringify(env.text)}`);
    sp("SP2", env.described === 1, `elements with aria-describedby=orchestra-token-hint: ${env.described}`);
    sp("SP3", env.clear === 0, `Clear buttons: ${env.clear}`);
    sp("SP4", env.kiosk === null ? true : env.style === env.kiosk, env.kiosk === null ? "not comparable (no #kiosk-pin-hint)" : `hint ${env.style} kiosk ${env.kiosk}`);
    sp("SP5", env.fits === true && env.rowFits && env.save.left === saved.save.left && env.save.width === saved.save.width, `hintFits=${env.fits} rowFits=${env.rowFits} save env ${env.save.left}/${env.save.width} saved ${saved.save.left}/${saved.save.width}`);
    sp("SP6", saved.hintCount === 0 && saved.clear === 1 && saved.described === 0, `hints=${saved.hintCount} clear=${saved.clear} described=${saved.described}`);
    sp("SP7", none.hintCount === 0 && none.clear === 0, `hints=${none.hintCount} clear=${none.clear}`);

    const card = (page) => visibleBody(page).first().locator('section:has(> div > h2:text-is("Hermes · daemon"))');
    const open = async () => { const { page } = await visit(s, "calm", { hash: "#hermes" }); return { page, c: card(page) }; };
    const typeChange = (ids) => ids.pressSequentially(", 201");
    {
      const { page, c } = await open();
      const ids = field(c, "Allowed user IDs (comma-separated)");
      const pw = field(c, "Current password");
      const loaded = await ids.inputValue();
      await typeChange(ids);
      await pw.waitFor({ timeout: SLOW });
      await pw.fill("shots-password");
      sp("SP8", (await pw.isVisible()) && (await pw.inputValue()) === "shots-password", `visible, value length ${(await pw.inputValue()).length}`);
      await cropEl(page, s, c, "settings-polish-hermes-ask-shown", false);
      await ids.fill(loaded);
      await pw.waitFor({ state: "detached", timeout: SLOW });
      sp("SP9", (await pw.count()) === 0, `password fields after undo: ${await pw.count()}`);
      await cropEl(page, s, c, "settings-polish-hermes-ask-hidden-after-typing", false);
      sp("SP11", await ids.evaluate((e) => e === document.activeElement), "activeElement is the Allowed user IDs input after the clear");
      await typeChange(ids);
      await pw.waitFor({ timeout: SLOW });
      sp("SP10", (await pw.inputValue()) === "", `value after re-show: ${JSON.stringify(await pw.inputValue())}`);
      await page.close();
    }
  }),
);

// ---- password 72 bytes (PR 343): the Change password card with a 73-letter new password (ONLY=pw72 runs just this) ----
// State: pw-too-long (both widths). Nothing is submitted; every API call stays mocked.
await guarded("pw72", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { hash: "#access" });
    const c = visibleBody(page).first().locator('section:has(> div > h3:text-is("Change password"))');
    await c.waitFor({ timeout: SLOW });
    await field(c, "Current password").fill("x");
    await c.getByPlaceholder("at least 8 characters").fill("a".repeat(73)); // the label "New password" is a substring of "Confirm new password"; the placeholder is unique
    await field(c, "Confirm new password").fill("a".repeat(73));
    await cropEl(page, s, c, "pw-too-long", false);
    record("PW72 Save disabled", s.name, await c.getByRole("button", { name: "Save", exact: true }).isDisabled());
    record("PW72 hint names the limit", s.name, (await c.innerText()).includes("72 bytes"));
    await page.close();
  }),
);

// The final records print even after failures, and on a runner kill.
function finish() {
  record("C14 page errors", "all", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none");
  record("C14 foreign requests", "all", foreignRequests.length ? [...new Set(foreignRequests)].join(" | ") : "none");
  console.log(JSON.stringify({ ...checks, diag }));
  // A failed step-up check (or any FAIL record in a single-section run) fails the run.
  const bad = Object.entries(checks).some(([k, v]) => ((k.startsWith("SU ") || k.startsWith("CN ") || k.startsWith("SP ") || k.startsWith("PW72 ")) && Object.values(v).includes(false)) || (ONLY && k === "FAIL"));
  if (bad) process.exitCode = 1;
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (finish(), process.exit(1)));
await browser.close().catch(() => {});
finish();
