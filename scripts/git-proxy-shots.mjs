#!/usr/bin/env node
/* Captures /git and /proxy on the test stack, once per state of the strips pattern 4 spec, at 1440x900 and 390x844 (touch),
 * and prints the numeric checks as one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/git-proxy-shots.mjs
 *
 * Needs the test stack (docker-compose.test.yml) and Playwright >= 1.45 (page.clock), which is not a dependency of this
 * repo; run it where one is installed. Nothing real is touched: /api/git, /api/git/sync and /api/proxy-manager are
 * answered from scripts/fixtures/{git,proxy}/fixtures.mjs (placeholders only). Time is driven by page.clock (installed
 * before goto, pinned to the fixtures' NOW); the context time zone is pinned.
 *
 * Capture states (git): calm, mirror-error, diverged, no-repos, unconfigured, stale (plus loading, load-error,
 * unauthorized, unreachable, no-mirrors)
 * Capture states (proxy): calm, routes-down, cert-under-7-days, no-routes, stale (plus loading, load-error,
 * cert-under-30-days, health-unknown, unconfigured, unauthorized, unreachable)
 * Each at both widths: a full page per width and a padded crop of the page.
 * Checks: C4 strip heads one height, C5 answer position, C6 strip opens by itself, C8 tap targets, C10 duplicate ids,
 * C11 honest chip and answer, C12 reduced motion, C13 every feature visible, C14 page errors and foreign requests,
 * C15 calm paint, C17 clipped content, C19 no horizontal scroll, C21 no host or raw error, C22 stale never says
 * In sync or All up, C23 proxy priority (down over cert, bad cert over warn), CW Sync now (no question, one write,
 * "Sync requested.", off while stale, failure copy), R18 no double-listing (no old panel headings).
 * Not measured here (reasons in the report): C4g, C4b, C7 hold pill, C9 contrast.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES as GIT, NOW } from "./fixtures/git/fixtures.mjs";
import { FIXTURES as PROXY } from "./fixtures/proxy/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000;
const PAGES = {
  git: { path: "/git", api: "**/api/git", fixtures: GIT, strips: ["mirrors", "pulls", "branches", "commits"], calmWide: "mirrors" },
  proxy: { path: "/proxy", api: "**/api/proxy-manager", fixtures: PROXY, strips: ["routes", "certs"], calmWide: "routes" },
};
// [page, fixture, chip, a phrase the answer must contain, the strip that must be open by itself (null: none named)]
const STATES = [
  ["git", "loading", "Checking", "Connecting to Forgejo", null],
  ["git", "loadError", "No answer", "can’t reach", null],
  ["git", "unconfigured", "Not connected", "isn’t connected yet", null],
  ["git", "unauthorized", "Token rejected", "rejected", null],
  ["git", "unreachable", "Not answering", "isn’t answering", null],
  ["git", "calm", "In sync", "All 4 mirrors are in sync with GitHub. 2 open pull requests; last commit 3 h ago in lab/alpha.", null],
  ["git", "noMirrors", "No mirrors", "No mirrors to GitHub are set up.", null],
  ["git", "mirrorError", "Mirror failing", "The lab/bravo mirror to GitHub failed:", "mirrors"],
  ["git", "diverged", "Diverged", "lab/charlie has diverged from GitHub: +2 ahead, -1 behind.", "mirrors"],
  ["git", "noRepos", "Empty", "Forgejo has no repos yet.", null],
  ["proxy", "loading", "Checking", "Connecting to Nginx Proxy Manager", null],
  ["proxy", "loadError", "No answer", "can’t reach", null],
  ["proxy", "unconfigured", "Not connected", "isn’t connected yet", null],
  ["proxy", "unauthorized", "Token rejected", "rejected", null],
  ["proxy", "unreachable", "Not answering", "isn’t answering", null],
  ["proxy", "calm", "All up", "All 12 routes are up. The next certificate to expire is app1.example.test, in 41 days.", null],
  ["proxy", "healthUnknown", "Up", "10 routes are up; 2 have no health result yet.", null],
  ["proxy", "routesDown", "2 down", "2 routes are down: app3.example.test, app5.example.test.", "routes"],
  ["proxy", "certUnder7", "Cert expiring", "The certificate for app1.example.test expires in 3 days.", "certs"],
  ["proxy", "certUnder30", "Cert soon", "The certificate for app1.example.test expires in 21 days.", "certs"],
  ["proxy", "noRoutes", "No routes", "Nginx Proxy Manager has no proxy or redirection hosts yet.", null],
];
const SHOT = { loadError: "load-error", noMirrors: "no-mirrors", mirrorError: "mirror-error", noRepos: "no-repos", healthUnknown: "health-unknown", routesDown: "routes-down", certUnder7: "cert-under-7-days", certUnder30: "cert-under-30-days", noRoutes: "no-routes" };
const shotName = (page, key) => `${page}-${SHOT[key] ?? key}`;

// C13: what the old panels held, each looked up after opening its strip.
const detail = (p) => p.locator(".st-pane, .st-body");
const FEATURES = {
  git: [
    ["chip", null, (p) => p.locator("[data-feature=chip]")],
    ["answer", null, (p) => p.locator("[data-feature=answer]")],
    ["evidence", null, (p) => p.locator("[data-feature=evidence]")],
    ["open-forgejo-link", null, (p) => p.getByRole("link", { name: "Open Forgejo" })],
    ["strip-state-lines", null, (p) => p.locator("[data-row-id] .st-state")],
    ["mirror-repo", "mirrors", (p) => detail(p).getByText("lab/alpha", { exact: true })],
    ["mirror-target", "mirrors", (p) => detail(p).getByText("https://github.com/example/alpha")],
    ["mirror-last-sync", "mirrors", (p) => detail(p).getByText(/last sync/).first()],
    ["mirror-badge", "mirrors", (p) => detail(p).getByText("synced", { exact: true }).first()],
    ["sync-now-button", "mirrors", (p) => detail(p).getByRole("button", { name: /Sync lab\/alpha now/ })],
    ["pull-row", "pulls", (p) => detail(p).getByText("Move the schedule into config")],
    ["pull-repo-badge", "pulls", (p) => detail(p).getByText("lab/alpha", { exact: true })],
    ["pull-age", "pulls", (p) => detail(p).locator("a[href*='/pulls/'] span.font-mono").first()],
    ["branch-row", "branches", (p) => detail(p).getByText("feat/schedule-config")],
    ["branch-age", "branches", (p) => detail(p).locator("span.tabular-nums").first()],
    ["commit-row", "commits", (p) => detail(p).getByText(/Fix the digest schedule/)],
    ["commit-sha", "commits", (p) => detail(p).getByText("a1b2c3d", { exact: true })],
    ["commit-author", "commits", (p) => detail(p).getByText("Sam Example").first()],
    ["commit-count", "commits", (p) => detail(p).getByText(/\d+ recent/)],
  ],
  proxy: [
    ["chip", null, (p) => p.locator("[data-feature=chip]")],
    ["answer", null, (p) => p.locator("[data-feature=answer]")],
    ["evidence", null, (p) => p.locator("[data-feature=evidence]")],
    ["open-npm-link", null, (p) => p.getByRole("link", { name: "Open NPM admin" })],
    ["strip-state-lines", null, (p) => p.locator("[data-row-id] .st-state")],
    ["route-domain", "routes", (p) => detail(p).getByText("app1.example.test", { exact: true }).first()],
    ["route-target", "routes", (p) => detail(p).getByText("http://upstream1.example.test:8080").first()],
    ["route-ssl-badge", "routes", (p) => detail(p).getByText("41d").first()],
    ["route-health-legend", "routes", (p) => detail(p).getByText(/not probed/)],
    ["cert-domain", "certs", (p) => detail(p).getByText("app1.example.test", { exact: true }).first()],
    ["cert-provider", "certs", (p) => detail(p).getByText("letsencrypt").first()],
    ["cert-days-left", "certs", (p) => detail(p).getByText("days left").first()],
  ],
};

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

// sync: "ok" | "fail" (Forgejo refuses) | "hold" (the request stays unanswered)
async function visit(s, which, key, { sync = "ok", reduced = false } = {}) {
  const def = PAGES[which];
  const fx = def.fixtures[key];
  const page = await (reduced ? s.reducedContext : s.context).newPage();
  const mock = { syncs: [] };
  watch(page, s.name);
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(def.api, (route) => (fx === "hang" ? undefined : fx === "fail" ? json(route, { error: "x" }, 500) : json(route, fx)));
  await page.route("**/api/git/sync", (route) => {
    mock.syncs.push(route.request().postDataJSON());
    if (sync === "hold") return new Promise(() => {});
    return sync === "fail" ? json(route, { error: "Forgejo refused the request." }, 502) : json(route, { ok: true });
  });
  await page.clock.install({ time: NOW });
  try {
    await page.goto(`${BASE_URL}${def.path}`, { waitUntil: "domcontentloaded" });
    // Hide the Next dev indicator (the round "N" badge) from every capture; next.config is untouched.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.locator("[data-feature=chip]").waitFor({ timeout: SLOW });
    if (key !== "loading") await page.waitForFunction(() => document.querySelector("[data-feature=chip]")?.textContent?.trim() !== "Checking", null, { timeout: SLOW });
    await page.waitForTimeout(500);
  } catch (e) {
    await diagnose(page, `${stage}:${which}:${key}`, s.name);
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
      if (cs.display === "none" || cs.visibility === "hidden") continue;
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
  const body = await page.locator("main").innerText();
  record("C10 duplicate data-row-id", `${name}@${vp}`, a.dup);
  record("C5 answer bottom (px)", `${name}@${vp}`, a.answerBottom);
  record("C17 clipped content", `${name}@${vp}`, a.clipped ? { n: a.clipped, sample: a.clippedSample } : 0);
  record("C19 no horizontal scroll", `${name}@${vp}`, (await overflow(page)) <= 0);
  record("C21 no host or raw error", `${name}@${vp}`, !/\b\d{1,3}(\.\d{1,3}){3}\b|ECONNREFUSED|forgejo\.example|npm\.example|401 from/.test(body));
  const headings = (await page.locator("h1, h2, h3, h4, [role=heading]").allInnerTexts()).join("\n");
  record("R18 no old panel headings", `${name}@${vp}`, !/\b(mirror sync|open pull requests|active branches|commit stream)\b/i.test(headings));
  if (vp === "390") record("C8 tap targets", name, (await small(page)).join("|") || "ok");
  return a;
}
// A full page per width plus a padded crop of the page head and strips.
async function shot(page, s, name) {
  // The fixed mobile nav and the Next dev badge would cover the crops; hide them for the captures only.
  const tag = await page.addStyleTag({ content: "nav.fixed.bottom-0, nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}-full.png`), fullPage: true });
  const box = await page.locator("main").first().boundingBox();
  if (box) {
    const pad = 16;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(s.name === "390" ? 390 : 1440, box.width + 2 * pad), height: Math.min(box.height + 2 * pad, 1600) };
    await page.screenshot({ path: join(OUT_DIR, `${name}-${s.name}.png`), fullPage: true, clip });
  }
  await tag.evaluate((el) => el.remove());
}

for (const [which, key, chip, phrase, open] of STATES) {
  stage = `${which}:${key}`;
  const name = shotName(which, key);
  await each(async (s) => {
    const { page } = await visit(s, which, key);
    const answer = await text(page, "[data-feature=answer]");
    record("C11 honest chip and answer", `${name}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === chip && answer.includes(phrase));
    const a = await perState(page, name, s.name);
    if (key === "calm") {
      record("C15 calm paint (no bad or warn)", `${name}@${s.name}`, a.painted ? { n: a.painted, sample: a.paintedSample } : 0);
      record("C4 strip heads one height", `${which}@${s.name}`, [...new Set(a.heads)].length <= 2 ? "ok" : a.heads);
      // At 390 nothing opens; at 1440 the pane shows the first strip (not an auto-open, so no aria-expanded claim).
      const anyOpen = (await Promise.all(PAGES[which].strips.map((id) => isOpen(page, id)))).some(Boolean);
      record("C6 calm opens nothing by itself", `${which}@${s.name}`, s.name === "390" ? !anyOpen : (await page.locator(".st-pane h2").first().innerText()).toLowerCase().startsWith(PAGES[which].calmWide.slice(0, 4)));
    }
    if (open) record("C6 answer strip opens by itself", `${name}@${s.name}`, await isOpen(page, open));
    if (key === "calm" && s.name === "1440") {
      // P1: the pane head holds its title alone; the strip's state is not repeated beside it.
      record("P1 pane head holds only its h2", `${which}@${s.name}`, await page.evaluate(() => [...document.querySelectorAll(".st-panehead > :not(h2)")].length));
      // P4: on /git, the rule under the pane head to the first mirror row's content is within the strip padding (.st-strip: 0.75rem = 12 px).
      if (which === "git") {
        record("P4 gap above first mirror row (px, max 12)", `${name}@${s.name}`, await page.evaluate(() => {
          const head = document.querySelector(".st-panehead");
          const row = document.querySelector(".st-pane .st-flush > :first-child > :first-child");
          return head && row ? Math.round((row.getBoundingClientRect().top - head.getBoundingClientRect().bottom) * 10) / 10 : "missing";
        }));
      }
    }
    // P3: a failed mirror's error is said in the head answer and in its row, never a third time.
    if (key === "mirrorError") record("P3 error text at most twice", `${name}@${s.name}`, (await page.locator("main").innerText()).split("authentication rejected").length - 1);
    if (key === "noRepos" || key === "noRoutes") record("no strips when empty", `${name}@${s.name}`, (await page.locator("[data-row-id]").count()) === 0);
    await shot(page, s, name);
    await page.close();
  });
}

// Sync now: no question, one write, "Syncing…" in flight then "Sync requested."; a refusal shows plain words and the repo.
stage = "sync";
await each(async (s) => {
  const { page, mock } = await visit(s, "git", "calm");
  await openStrip(page, "mirrors");
  const button = page.getByRole("button", { name: /Sync lab\/bravo now/ });
  await button.click();
  await page.waitForTimeout(600);
  record("CW sync asks no question", s.name, (await page.getByRole("button", { name: /^Yes/ }).count()) === 0 && mock.syncs.length === 1);
  record("CW one sync write for the row clicked", s.name, mock.syncs.length === 1 && mock.syncs[0].repo === "bravo" && mock.syncs[0].owner === "lab");
  record("CW Sync requested shown", s.name, await page.getByText("Sync requested.").isVisible());
  await perState(page, "git-sync-requested", s.name);
  await shot(page, s, "git-sync-requested");
  await page.close();
});
stage = "sync-fail";
await each(async (s) => {
  const { page } = await visit(s, "git", "calm", { sync: "fail" });
  await openStrip(page, "mirrors");
  await page.getByRole("button", { name: /Sync lab\/alpha now/ }).click();
  await page.waitForTimeout(600);
  const alert = page.getByRole("alert").filter({ hasText: /Couldn’t sync lab\/alpha/ });
  record("CW sync failure copy names the repo", s.name, await alert.isVisible());
  record("CW sync failure has no raw text", s.name, !/\b50\d\b|ECONN|\bHTTP\b/.test(await page.locator("main").innerText()));
  await perState(page, "git-sync-failed", s.name);
  await shot(page, s, "git-sync-failed");
  await page.close();
});

// Stale: the poll starts failing after the first answer; Sync now goes off and the chip never says In sync or All up (C22).
for (const [which, claim] of [["git", /In sync/], ["proxy", /All up/]]) {
  stage = `${which}:stale`;
  await each(async (s) => {
    const { page } = await visit(s, which, "calm");
    await page.unroute(PAGES[which].api);
    await page.route(PAGES[which].api, (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.clock.runFor(which === "git" ? 200_000 : 100_000);
    await page.waitForTimeout(500);
    const head = `${await text(page, "[data-feature=chip]")} ${await text(page, "[data-feature=answer]")}`;
    record("C22 stale chip, never the calm claim", `${which}@${s.name}`, (await text(page, "[data-feature=chip]")).trim() === "Stale" && !claim.test(await text(page, "[data-feature=chip]")) && /^Showing what was true/.test(await text(page, "[data-feature=answer]")) && head.length > 0);
    if (which === "git") {
      await openStrip(page, "mirrors");
      record("CW stale: Sync now is off", s.name, (await page.getByRole("button", { name: /Sync lab\/.* now/ }).first().isDisabled()));
    }
    if (s.name === "390") {
      // P2: the page link stays on the evidence row: it overlaps the evidence text's first line and ends flush with the row's right edge.
      record("P2 link on the evidence row (overlap px, right gap px)", `${which}@${s.name}`, await page.evaluate(() => {
        const row = document.querySelector(".st-evidence");
        const link = row.querySelector("a, button");
        const rng = document.createRange();
        rng.selectNodeContents(row.querySelector("span"));
        const first = rng.getClientRects()[0];
        const l = link.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return { overlap: Math.round(Math.min(l.bottom, first.bottom) - Math.max(l.top, first.top)), rightGap: Math.round(Math.abs(r.right - l.right) * 10) / 10 };
      }));
    }
    await perState(page, `${which}-stale`, s.name);
    await shot(page, s, `${which}-stale`);
    await page.close();
  });
}

// C12: under reduced motion nothing in main has a transition duration.
await guarded("C12", () =>
  each(async (s) => {
    for (const which of ["git", "proxy"]) {
      const { page } = await visit(s, which, "calm", { reduced: true });
      const moving = await page.evaluate(() =>
        [...document.querySelectorAll("main *")].filter((e) => getComputedStyle(e).transitionDuration.split(",").some((d) => parseFloat(d) > 0)).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`),
      );
      record("C12 reduced motion: transitions with a duration", `${which}@${s.name}`, moving.length ? { n: moving.length, sample: moving.slice(0, 3) } : 0);
      await page.close();
    }
  }),
);

// C13: open every strip in turn on calm and look up every feature; expect n/n.
await guarded("C13", () =>
  each(async (s) => {
    for (const which of ["git", "proxy"]) {
      const { page } = await visit(s, which, "calm");
      const found = {};
      const features = FEATURES[which];
      for (const id of PAGES[which].strips) {
        await openStrip(page, id);
        for (const [name, strip, locate] of features) {
          if (strip === id || (strip === null && id === PAGES[which].strips[0])) found[name] = (await locate(page).first().isVisible().catch(() => false)) || found[name] === true;
        }
      }
      const n = Object.values(found).filter(Boolean).length;
      record("C13 every feature visible", `${which}@${s.name}`, { found: n, of: features.length, missing: features.map((f) => f[0]).filter((f) => !found[f]) });
      await page.close();
    }
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
