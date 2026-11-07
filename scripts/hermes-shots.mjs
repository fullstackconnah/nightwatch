#!/usr/bin/env node
/* Captures /hermes on the test stack, once per state of the strips pattern, at 1440x900 and 390x844, and prints the
 * numeric checks as one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/hermes-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml) and Playwright >= 1.45 (page.clock), which is not a dependency of this
 * repo; run it where one is installed. Nothing real is touched: /api/hermes-ctl/status, /activity, /run and /jobs/job-1
 * are answered from scripts/fixtures/hermes/fixtures.mjs (placeholders only). Time is driven by page.clock (installed
 * before goto, pinned to the fixtures' NOW); the context time zone is pinned.
 *
 * Capture states: calm, dry-run, loop-failed, job-running, run-done, test-alert-confirm, run-failed, unconfigured,
 * unauthorized, stale (plus loading, load-error, unreachable, unhealthy, no-activity), each at both widths: a full page
 * per width and a padded crop of the strips.
 * Checks: C4 strip heads one height, C5 answer position, C6 strip opens by itself, C8 tap targets, C10 duplicate ids,
 * C11 honest chip and answer, C12 reduced motion, C13 every feature visible, C14 page errors and foreign requests,
 * C15 calm paint, C17 clipped content, C19 no horizontal scroll, C20 results by job kind, C21 no host or raw error,
 * C22 stale never says Running, CW write rules (confirm copy, one start, one slot).
 * Not measured here (reasons in the report): C4g, C4b, C7 hold pill, C9 contrast.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, NOW } from "./fixtures/hermes/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
// [fixture, chip, a phrase the answer must contain, the strip that must be open by itself (null: none named)]
const STATES = [
  ["loading", "Checking", "Connecting to Hermes", null],
  ["loadError", "No answer", "can’t reach its own Hermes check", null],
  ["unconfigured", "Not connected", "isn’t connected yet", null],
  ["unauthorized", "Token rejected", "rejected", null],
  ["unreachable", "Not answering", "isn’t answering", null],
  ["calm", "Running", "Hermes is running on qwen-test. Next digest in 3 h; 2 alerts in the last 24 h.", null],
  ["dryRun", "Running", "Dry run: nothing is posted to Discord.", null],
  ["loopFailed", "Loop failing", "digest loop failed", "loops"],
  ["unhealthy", "Unhealthy", "reports itself unhealthy", "loops"],
  ["noActivity", "Running", "Hermes is running", null],
];
const SHOT = { loadError: "load-error", dryRun: "dry-run", loopFailed: "loop-failed", noActivity: "no-activity" };

// C13: what the five old panels held, each looked up after opening its strip.
const detail = (p) => p.locator(".st-pane, .st-body");
const FEATURES = [
  ["chip", null, (p) => p.locator("[data-feature=chip]")],
  ["answer", null, (p) => p.locator("[data-feature=answer]")],
  ["evidence", null, (p) => p.locator("[data-feature=evidence]")],
  ["strip-state-lines", null, (p) => p.locator("[data-row-id] .st-state")],
  ["run-digest-button", null, (p) => p.locator('[data-row-id="runs"] .st-slot').getByRole("button", { name: /Run digest/ })],
  ["model", "loops", (p) => detail(p).getByText("qwen-test", { exact: true })],
  ["tier-source", "loops", (p) => detail(p).getByText(/local · via env/)],
  ["webhook-dot", "loops", (p) => detail(p).getByText("webhook", { exact: true })],
  ["commands-dot", "loops", (p) => detail(p).getByText("commands", { exact: true })],
  ["loop-collect", "loops", (p) => detail(p).getByText("collect", { exact: true })],
  ["loop-digest", "loops", (p) => detail(p).getByText("digest", { exact: true }).first()],
  ["next-digest", "loops", (p) => detail(p).getByText("next digest", { exact: true })],
  ["alert-loop", "loops", (p) => detail(p).getByText("alert", { exact: true })],
  ["snapshots-24h", "loops", (p) => detail(p).getByText(/snapshots/)],
  ["alerts-24h", "loops", (p) => detail(p).getByText(/alerts · 24h/)],
  ["test-alert-button", "runs", (p) => detail(p).getByRole("button", { name: /Send test alert/ })],
  ["runs-note", "runs", (p) => detail(p).getByText(/don’t post to Discord/)],
  ["ask-textarea", "ask", (p) => detail(p).getByRole("textbox", { name: "Ask Hermes" })],
  ["ask-counter", "ask", (p) => detail(p).getByText("0/500", { exact: true })],
  ["ask-button", "ask", (p) => detail(p).getByRole("button", { name: /^Ask$/ })],
  ["ask-mic", "ask", (p) => detail(p).locator("button").nth(0)],
  ["activity-row", "activity", (p) => detail(p).getByText("Morning digest", { exact: true })],
  ["activity-kind", "activity", (p) => detail(p).getByText("alert", { exact: true }).first()],
  ["activity-count", "activity", (p) => detail(p).getByText(/\d+ recent/)],
];

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];
const diag = {};

// One bad state must not hide the rest: a throw (a failed waitFor included) is recorded as a FAIL and the next step runs.
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
// The test stack's dev login takes any password; each context keeps its own cookie.
for (const s of sessions) {
  for (const ctx of [s.context, s.reducedContext]) {
    const login = await ctx.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  }
}
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));

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

// start: "ok" | "conflict" (the daemon says it is busy) | "hold" (the start stays unanswered)
async function visit(s, key, { start = "ok", reduced = false } = {}) {
  const fx = FIXTURES[key];
  const page = await (reduced ? s.reducedContext : s.context).newPage();
  const mock = { posts: [] };
  watch(page, s.name);
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/hermes-ctl/status", (route) => (fx.status === "hang" ? undefined : fx.status === "fail" ? json(route, { error: "x" }, 500) : json(route, fx.status)));
  await page.route("**/api/hermes-ctl/activity", (route) => json(route, fx.activity));
  await page.route("**/api/hermes-ctl/run", (route) => {
    mock.posts.push(route.request().postDataJSON());
    if (start === "hold") return new Promise(() => {});
    return start === "conflict" ? json(route, { error: "Hermes is already running a job." }, 409) : json(route, { jobId: "job-1" });
  });
  await page.route("**/api/hermes-ctl/jobs/*", (route) => json(route, fx.job ?? { ok: false, status: 404, detail: "gone" }));
  await page.clock.install({ time: NOW });
  try {
    await page.goto(`${BASE_URL}/hermes`, { waitUntil: "domcontentloaded" });
    // Hide the Next dev indicator (the round "N" badge) from every capture; next.config is untouched.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
    await page.waitForTimeout(500);
  } catch (e) {
    await diagnose(page, `${stage}:${key}`, s.name);
    throw e;
  }
  return { page, mock };
}

/** Screenshot, url, first 600 chars of the body and the console errors of a page that failed to reach its state. */
async function diagnose(page, label, width) {
  const d = { url: page.url(), consoleErrors: page.consoleErrors.slice(0, 10) };
  d.body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch((e) => `unreadable: ${e.message}`);
  await page.screenshot({ path: join(OUT_DIR, `${label.replace(/[^A-Za-z0-9]+/g, "-")}-FAIL-${width}.png`), fullPage: true }).catch((e) => (d.screenshot = `failed: ${e.message}`));
  diag[`${label}@${width}`] = d;
}

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
const isOpen = async (page, id) => (await page.locator(`[data-k="open-${id}"]`).getAttribute("aria-expanded").catch(() => null)) === "true";

/** C8: buttons and links in main with a box under 44 px in either direction; an inline link inside prose is exempt. */
const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main button, main a[href]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.disabled || getComputedStyle(el).visibility === "hidden") return false;
        if (el.tagName === "A" && el.parentElement?.tagName === "P") return false;
        return r.height < 43.5 || r.width < 43.5;
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)),
  );

/** C10 duplicate ids, C15 bad or warn paint, C17 clipped content: computed-style probes, no pixels. */
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
    const painted = [...document.querySelectorAll("main [data-tone=bad], main [data-tone=warn]")].map((el) => `${el.tagName.toLowerCase()}[${el.dataset.tone}]`);
    const clipped = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.classList.contains("sr-only")) continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(isDanger)) painted.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      const r = el.getBoundingClientRect();
      const byDesign = cs.textOverflow === "ellipsis" || el.dataset.feature === "answer" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
      if (r.width > 0 && cs.overflowX === "hidden" && el.scrollWidth > el.clientWidth + 1 && !byDesign) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
    }
    const ids = [...document.querySelectorAll("[data-row-id]")].map((e) => e.dataset.rowId);
    const a = document.querySelector("[data-feature=answer]");
    const answerBottom = a ? Math.round(a.getBoundingClientRect().bottom + window.scrollY) : 0;
    const heads = [...document.querySelectorAll("[data-row-id] .st-head, [data-row-id] > button")].map((e) => Math.round(e.getBoundingClientRect().height));
    return { dup: ids.length - new Set(ids).size, painted: painted.length, paintedSample: painted.slice(0, 3), clipped: clipped.length, clippedSample: clipped.slice(0, 3), answerBottom, heads };
  });

/** The per-state checks every captured state gets (name is the state's capture name). */
async function perState(page, name, vp) {
  const a = await audit(page);
  record("C10 duplicate data-row-id", `${name}@${vp}`, a.dup);
  record("C5 answer bottom (px)", `${name}@${vp}`, a.answerBottom);
  record("C17 clipped content", `${name}@${vp}`, a.clipped ? { n: a.clipped, sample: a.clippedSample } : 0);
  record("C19 no horizontal scroll", `${name}@${vp}`, (await overflow(page)) <= 0);
  record("C21 no host or raw error", `${name}@${vp}`, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED|upstream\.example|token rejected by/.test(await page.locator("main").innerText()));
  if (vp === "390") record("C8 tap targets", name, (await small(page)).join("|") || "ok");
  return a;
}
// A full page per width plus a padded crop of the page head and strips.
async function shot(page, s, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}-full.png`), fullPage: true });
  const box = await page.locator("main").first().boundingBox();
  if (box) {
    const pad = 16;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(s.name === "390" ? 390 : 1440, box.width + 2 * pad), height: Math.min(box.height + 2 * pad, 1600) };
    await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}.png`), fullPage: true, clip });
  }
}

for (const [key, chip, phrase, open] of STATES) {
  stage = key;
  const name = SHOT[key] ?? key;
  await each(async (s) => {
    const { page } = await visit(s, key);
    const answer = await text(page, "[data-feature=answer]");
    record("C11 honest chip and answer", `${name}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === chip && answer.includes(phrase));
    const a = await perState(page, name, s.name);
    if (key === "calm" || key === "dryRun") record("C15 calm paint (no bad or warn)", `${name}@${s.name}`, a.painted ? { n: a.painted, sample: a.paintedSample } : 0);
    if (key === "calm") record("C4 strip heads one height", s.name, [...new Set(a.heads)].length <= 2 ? "ok" : a.heads);
    if (open) record("C6 answer strip opens by itself", `${name}@${s.name}`, await isOpen(page, open));
    if (open) record("L1 detail lead only when clamped", `${name}@${s.name}`, await leadState(page));
    else if (key === "calm") {
      // Spec §5 Calm row: nothing open at 390; Loops open (Runs not) at 1440.
      const loops = await isOpen(page, "loops");
      const runs = await isOpen(page, "runs");
      record("C6 calm opens nothing (390) / Loops only (1440)", s.name, s.name === "390" ? !loops && !runs : loops && !runs);
    }
    await shot(page, s, name);
    await page.close();
  });
}

// Runs: a started digest shows as running, then done; a failed one opens Runs; results never cross to Ask (C20).
stage = "job-running";
await each(async (s) => {
  const { page, mock } = await visit(s, "jobRunning");
  await page.locator('[data-row-id="runs"] .st-slot').getByRole("button", { name: /Run digest/ }).click();
  await page.waitForTimeout(800);
  record("CW one digest start", s.name, mock.posts.filter((p) => p.kind === "digest").length === 1);
  await openStrip(page, "runs");
  record("C11 job-running state line", s.name, /Digest running/.test(await text(page, '[data-row-id="runs"] .st-state')));
  // V1: open Ask; the button must exist, be disabled, and say why. A count of 0 fails.
  await openStrip(page, "ask");
  const askBtn = detail(page).getByRole("button", { name: /^Ask$/ });
  record("CW one slot: Ask is off while a job runs", s.name, (await askBtn.count()) === 1 && (await askBtn.isDisabled()) && (await detail(page).getByText("Hermes runs one job at a time.").first().isVisible()));
  await openStrip(page, "runs");
  await perState(page, "job-running", s.name);
  await shot(page, s, "job-running");
  await page.close();
});
for (const [key, name] of [["runDone", "run-done"], ["runFailed", "run-failed"]]) {
  stage = name;
  await each(async (s) => {
    const { page } = await visit(s, key);
    await page.locator('[data-row-id="runs"] .st-slot').getByRole("button", { name: /Run digest/ }).click();
    await page.waitForTimeout(3_000);
    await page.clock.runFor(3_000);
    await page.waitForTimeout(500);
    if (key === "runFailed") {
      // The strip list holds auto-open while pointer or focus is inside, by design: step out first.
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.waitForTimeout(200);
      record("C6 failed run opens Runs", s.name, await isOpen(page, "runs"));
    } else await openStrip(page, "runs");
    const outcome = key === "runDone" ? detail(page).getByText("Everything is steady").first() : detail(page).getByRole("alert").filter({ hasText: /did not answer in time/ }).first();
    record("C11 run outcome shown", `${name}@${s.name}`, await outcome.isVisible());
    if (key === "runFailed") {
      const t = await outcome.innerText();
      const whole = t + (await page.locator("main").innerText());
      record("H12 failed run text hides secrets", s.name, !whole.includes("abc123secret") && !whole.includes("hunter2"));
    }
    await perState(page, name, s.name);
    await shot(page, s, name);
    // C20: a digest result never appears under Ask. The Ask detail must be found (its textbox) so the check is not vacuous.
    await openStrip(page, "ask");
    const askDetail = page.locator('[data-row-id="ask"] .st-body, #st-pane').first();
    const found = await askDetail.getByRole("textbox", { name: "Ask Hermes" }).isVisible();
    const leaked = /Everything is steady|did not answer in time/.test(await askDetail.innerText());
    record("C20 digest result not shown in Ask", `${name}@${s.name}`, found && !leaked);
    await openStrip(page, "runs");
    await page.close();
  });
}

// Test alert: asks first (R15 "Yes, send", primary); Cancel closes it with no POST; Yes writes once. No auto-cancel by spec.
stage = "test-alert-confirm";
await each(async (s) => {
  const { page, mock } = await visit(s, "calm");
  await openStrip(page, "runs");
  await page.getByRole("button", { name: /Send test alert/ }).click();
  const yes = page.getByRole("button", { name: "Yes, send" });
  record("CW test alert asks first", s.name, (await yes.isVisible()) && mock.posts.length === 0);
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await page.waitForTimeout(250);
  record("CW Cancel closes the question and sends no POST", s.name, !(await yes.isVisible()) && mock.posts.filter((p) => p.kind === "alert-test").length === 0);
  await page.getByRole("button", { name: /Send test alert/ }).click();
  await page.waitForTimeout(250); // the .nw-confirm grow-in scales to .97 first
  await perState(page, "test-alert-confirm", s.name);
  await shot(page, s, "test-alert-confirm");
  await yes.click();
  await page.waitForTimeout(400);
  record("CW one test-alert write", s.name, mock.posts.filter((p) => p.kind === "alert-test").length === 1);
  await page.close();
});

// A refused start (409) shows plain words, not a raw error.
stage = "conflict";
await each(async (s) => {
  const { page } = await visit(s, "calm", { start: "conflict" });
  await page.locator('[data-row-id="runs"] .st-slot').getByRole("button", { name: /Run digest/ }).click();
  await page.waitForTimeout(600);
  record("CW refused start has no raw text", s.name, !/409|ECONN|\bHTTP\b/.test(await page.locator("main").innerText()));
  await page.close();
});

// Stale: the poll starts failing after the first answer; every write goes off and the chip never says Running (C22).
stage = "stale";
await each(async (s) => {
  const { page } = await visit(s, "calm");
  await page.unroute("**/api/hermes-ctl/status");
  await page.route("**/api/hermes-ctl/status", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.clock.runFor(12_000);
  await page.waitForTimeout(500);
  record("C22 stale chip, never Running", s.name, (await text(page, "[data-feature=chip]")).trim() === "Stale");
  await openStrip(page, "runs");
  record("CW stale: every write is off", s.name, (await page.locator("main button:enabled:text-matches('Run digest|Send test alert')").count()) === 0);
  await perState(page, "stale", s.name);
  await shot(page, s, "stale");
  await page.close();
});

// M4: a failed sign-out shows the role=alert line in the side nav (1440) or the top bar (390).
stage = "signout-error";
await guarded("signout-error", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.getByRole("button", { name: /^Log out$/ }).filter({ visible: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: /sign out/ });
    await alert.waitFor({ timeout: SLOW });
    record("M4 sign-out error visible, no redirect", s.name, (await alert.isVisible()) && new URL(page.url()).pathname === "/hermes");
    const box = await page.locator(s.name === "390" ? "header" : "aside").first().boundingBox();
    if (box) await page.screenshot({ path: join(OUT_DIR, `signout-error-${s.name}.png`), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.min(box.width + 32, s.name === "390" ? 390 : 1440), height: Math.min(box.height + 32, 900) } });
    await page.close();
  }),
);

// C12: under reduced motion nothing in main has a transition duration.
await guarded("C12", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm", { reduced: true });
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("main *")].filter((e) => getComputedStyle(e).transitionProperty !== "none" && getComputedStyle(e).transitionDuration.split(",").some((d) => parseFloat(d) > 0)).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} "${(e.textContent || "").trim().slice(0, 30)}" ${getComputedStyle(e).transitionProperty}`),
    );
    record("C12 reduced motion: transitions with a duration", s.name, moving.length ? { n: moving.length, sample: moving.slice(0, 3) } : 0);
    await page.close();
  }),
);

// C13: open every strip in turn on calm and look up every feature; expect n/n.
await guarded("C13", () =>
  each(async (s) => {
    const { page } = await visit(s, "calm");
    const found = {};
    for (const id of ["loops", "runs", "ask", "activity"]) {
      await openStrip(page, id);
      for (const [name, strip, locate] of FEATURES) {
        if (strip === id || (strip === null && id === "loops")) found[name] = (await locate(page).first().isVisible().catch(() => false)) || found[name] === true;
      }
    }
    const n = Object.values(found).filter(Boolean).length;
    record("C13 every feature visible", s.name, { found: n, of: FEATURES.length, missing: FEATURES.map((f) => f[0]).filter((f) => !found[f]) });
    await page.close();
  }),
);

// The final records print even after failures, and on a runner kill.
function finish() {
  record("C14 page errors", "all", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none");
  record("C14 foreign requests", "all", foreignRequests.length ? [...new Set(foreignRequests)].join(" | ") : "none");
  console.log(JSON.stringify({ ...checks, diag }));
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (finish(), process.exit(1)));
await browser.close().catch(() => {});
finish();
