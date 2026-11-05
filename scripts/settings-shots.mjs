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
 * Checks written: C1 height, C2 inventory (the 98 spec kinds as probes, see inventory.json), RF refresh-failed, SF save-failed, C2c no write before Yes, C3 sentinels,
 * C5s auto-open on paint, C6 calm paint, C7 answer slot, C9 drafts, C11 deep link, C12 targets / motion / errors,
 * C14 page errors and foreign requests.
 * Captures, per width: calm, partial, none, loading, load-error, refresh-failed, save-failed, no-password,
 * hermes-key-missing, unsaved-draft: a padded crop of the open strip (else the head); plus one full page per width for calm.
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
  ["partial", "partial", "Ready", "of 6 integrations are set up", null],
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
const guarded = (label, fn) => { stage = label; return fn().catch((e) => fail("all", e)); };

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
  diag[tag] = { url: page.url(), consoleErrors: (page.consoleErrors ?? []).slice(0, 5), body: await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "unreadable") };
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
  const mock = { posts: [], gets: 0 };
  watch(page, s.name);
  live[s.name] = page;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (!real) {
    await page.route("**/api/docker/containers", (route) => json(route, CONTAINERS));
    await page.route("**/api/settings", (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        mock.posts.push(`${req.method()} ${new URL(req.url()).pathname}`);
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
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const openStrip = async (page, id) => {
  const t = page.locator(`[data-k="open-${id}"]`);
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  await page.waitForTimeout(150);
};
const isOpen = (page, id) => page.locator(`[data-k="open-${id}"]`).getAttribute("aria-expanded").then((v) => v === "true");
const visibleBody = (page) => page.locator(".st-pane > div:not([hidden]), .st-body:not([hidden])");
const fullShot = (page, s, name) => page.screenshot({ path: join(OUT_DIR, `${name}-full-${s.name}.png`), fullPage: true });
/** Padded crop (24 px) of the open strip (1440: the detail pane; 390: its row and body), else of the chip and answer. */
async function shot(page, s, name) {
  const open = await page.evaluate(() => document.querySelector('[data-k^="open-"][aria-expanded="true"]')?.getAttribute("data-k")?.slice(5) ?? null);
  const sels = open ? (s.name === "1440" ? ["#st-pane"] : [`[data-k="open-${open}"]`, `#st-body-${open}`]) : ["[data-feature=chip]", "[data-feature=answer]"];
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
      if (s.name === "390") record("C12 targets under 44 px", name, (await small(page)).join("|") || "ok");
      await shot(page, s, name);
      if (key === "calm") await fullShot(page, s, name);
      await page.close();
    }),
  );
}

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
      const m = await page.evaluate(() => {
        const list = document.querySelector("[data-feature=strips]")?.getBoundingClientRect();
        const bar = [...document.querySelectorAll("nav, [data-bottom-bar]")].map((e) => e.getBoundingClientRect()).filter((r) => r.top > innerHeight / 2).sort((a, b) => a.top - b.top)[0];
        return { bottom: Math.round((list?.bottom ?? 0) + scrollY), barTop: Math.round(bar?.top ?? innerHeight), scrollHeight: document.documentElement.scrollHeight };
      });
      record("C1 list above the bottom bar", "390", { ...m, ok: m.bottom <= m.barTop });
      record("C1 page scrollHeight", "390", { value: m.scrollHeight, ok: m.scrollHeight <= 940 });
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
      for (const st of k.steps) {
        if (Array.isArray(st)) await field(body, st[0]).fill(st[1]);
        else await body.getByRole("button", { name: st, exact: st === "Replace" }).first().click();
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

// The final records print even after failures, and on a runner kill.
function finish() {
  record("C14 page errors", "all", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none");
  record("C14 foreign requests", "all", foreignRequests.length ? [...new Set(foreignRequests)].join(" | ") : "none");
  console.log(JSON.stringify({ ...checks, diag }));
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (finish(), process.exit(1)));
await browser.close().catch(() => {});
finish();
