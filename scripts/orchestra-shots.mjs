#!/usr/bin/env node
/* Captures the AI lanes page (/orchestrators) and the settings card on the test stack, at 1440x900 and 390x844,
 * and prints the numeric checks (the shape brief's C1-C17) as one JSON object on the last line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/orchestra-shots.mjs
 *
 * Needs: the test stack with the orchestra-mock service up (docker-compose.test.yml), a FRESH stack
 * (shot 1 needs Orchestra unconfigured, and a token cannot be cleared from the UI), and Playwright,
 * which is not a dependency of this repo; run it where one is installed. The stack is a dev build with
 * no password hash, so the login page accepts any password and issues a real session cookie.
 * Both viewports run side by side, step by step, because the Orchestra settings are server state.
 * Tick sequences (hold, stall mark, reduced motion) answer /api/orchestra/status from the script via page.route and
 * trigger SWR by running Playwright's page.clock (installed before goto) past the 10 s poll, so the data is exact.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const MOCK_URL = process.env.MOCK_URL ?? "http://orchestra-mock:7420";
const UNREACHABLE_URL = "http://orchestra.invalid:7420";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const SLOW = 40_000; // dev-server cold compile plus 2 x 10 s polls

mkdirSync(OUT_DIR, { recursive: true });
const checks = {};
const record = (key, vp, value) => ((checks[key] ??= {})[vp] = value);
const pageErrors = [];
const foreignRequests = [];

const browser = await chromium.launch({ headless: true });
const sessions = [];
for (const { name, ...opts } of VIEWPORTS) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  watch(page, name);
  sessions.push({ name, opts, context, page });
}

/** C17: page errors, and any request that leaves the page's own origin. */
function watch(page, name) {
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== new URL(BASE_URL).origin) foreignRequests.push(`${name}: ${new URL(u).origin}`);
  });
}

async function signIn({ page }) {
  // networkidle: with domcontentloaded the dev build has not hydrated yet and Unlock stays disabled.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.locator('input[type="password"]').fill("x");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: SLOW }), page.locator('button[type="submit"]').click()]);
}

// Same-origin fetch from a page on BASE_URL, so the CSRF guard sees a normal browser write.
const setCfg = (page, body) =>
  page.evaluate(async (b) => (await fetch("/api/settings/system", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, body);

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const texts = (page, sel) => page.locator(sel).allTextContents().then((a) => a.map((t) => t.trim()));
const live = (page) => texts(page, "main [role=status], main [aria-live=polite]");
const mainText = (page) => page.locator("main").innerText();
const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main button, main a, main [role=button], nav a")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && getComputedStyle(e).visibility !== "hidden" && (r.height < 43.5 || r.width < 43.5);
      })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || "").trim().slice(0, 16)}`),
  );

async function goto(page, path, ready) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  if (ready) await ready(page).catch((e) => { throw new Error(`${path}: ${e.message}`); });
}
const text = (t) => (page) => page.getByText(t).first().waitFor({ timeout: SLOW });
const strips = (n) => (page) => page.locator("[data-row-id^='lane-']").nth(n - 1).waitFor({ timeout: SLOW });

// view + crop + page; 390 touch pages are never fullPage-shot (the resize drops touch emulation):
// the viewport is grown to the page height instead and pointer:coarse is re-checked afterwards.
async function shoot(s, key, crop) {
  const { page, name, opts } = s;
  const base = join(OUT_DIR, `orchestra-${key}-${name}`);
  // Hide the Next dev indicator (it covers sidebar and bottom-nav labels) before every shot.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${base}-view.png` });
  const shootCrop = () => crop && page.locator(crop).first().screenshot({ path: `${base}-crop.png` });
  if (name !== "390") await shootCrop();
  if (name === "390") {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 390, height: Math.min(h, 6000) });
    await page.waitForTimeout(250);
    record("pointerCoarseAfterResize", `${key}@390`, await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
    // The fixed mobile header and bottom nav would be stitched across the middle of a tall page: unpin them for this shot.
    const unpin = await page.addStyleTag({ content: "header, nav { position: static !important; }" });
    await shootCrop(); // the crop gets the unpinned chrome too, so the fixed bottom nav cannot cover the card
    await page.screenshot({ path: `${base}-page.png` });
    await unpin.evaluate((n) => n.remove());
    await page.setViewportSize(opts.viewport);
  } else {
    await page.screenshot({ path: `${base}-page.png`, fullPage: true });
  }
  record("overflowPx", `${key}@${name}`, await overflow(page));
}

/** The numeric checks every board state shares: C1 danger at rest, C2 no writes, C4 no cost, C12 contrast, C13 ids. */
const audit = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.trim().slice(i, i + 2), 16));
    const targets = [rgbOf(root.getPropertyValue("--color-warn")), rgbOf(root.getPropertyValue("--color-bad"))];
    // rgb(), rgba() and color(srgb r g b / a) all come back as [r, g, b, a] in 0-255.
    const parse = (s) => {
      const m = s.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      const c = s.match(/^color\(srgb ([^)]+)\)$/);
      if (c) { const p = c[1].split(/[ /]+/).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return null;
    };
    const isDanger = (s) => { const v = parse(s); return Boolean(v) && v[3] > 0 && targets.some((t) => t.every((x, i) => Math.abs(x - v[i]) <= 1.5)); };
    const outside = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.closest("[data-mark],[data-band],.dot-unhealthy")) continue;
      const cs = getComputedStyle(el);
      const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(cs[`border${d}Width`]) > 0).map((d) => cs[`border${d}Color`]);
      if ([cs.color, cs.backgroundColor, ...sides].some(isDanger)) outside.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
    }
    // Contrast probe: each text node's colour over the composited ancestor backgrounds (a computed-style probe, not pixels).
    const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a); };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      return layers.reduceRight((under, top) => over(top, under), [11, 15, 20, 1]);
    };
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    let minRatio = 21;
    const lowContrast = [];
    const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || getComputedStyle(el).visibility === "hidden" || el.closest("[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = bgOf(el);
      const ratioNow = ratio(over(fg, bg), bg);
      minRatio = Math.min(minRatio, ratioNow);
      if (ratioNow < 4.5) lowContrast.push(`${n.textContent.trim().slice(0, 20)} ${ratioNow.toFixed(2)}`);
    }
    const ids = [...document.querySelectorAll("[data-row-id]")].map((e) => e.dataset.rowId);
    const body = document.querySelector("main").innerText;
    return {
      dangerOutside: outside.length,
      dangerSample: outside.slice(0, 3),
      ctrlChildren: [...document.querySelectorAll(".ol-ctrl")].reduce((n, e) => n + e.children.length, 0),
      writeButtons: [...document.querySelectorAll("main button")].filter((b) => /start|stop|restart/i.test(b.textContent || "")).length,
      proposed: /proposed/i.test(body) ? 1 : 0,
      costHits: (body.match(/cost|not reported|\$/gi) ?? []).length,
      duplicateIds: ids.length - new Set(ids).size,
      minContrast: Math.round(minRatio * 100) / 100,
      lowContrast: lowContrast.slice(0, 4),
      nothingNeedsYou: /Nothing needs you/.test(body),
    };
  });

/** C6 (full name) and C7 (one space) over every slot on screen. */
const slotChecks = (page) =>
  page.evaluate(() => {
    const names = [...document.querySelectorAll(".or-aname")].map((e) => {
      const cs = getComputedStyle(e);
      const lh = parseFloat(cs.lineHeight);
      const h = e.getBoundingClientRect().height;
      return { name: e.textContent, fits: e.scrollWidth <= e.clientWidth, ellipsis: cs.textOverflow === "ellipsis", twoLines: h <= 2 * lh + 1 };
    });
    const gaps = [...document.querySelectorAll(".or-quiet")]
      .filter((q) => q.querySelector(".ol-min"))
      .map((q) => {
        const t = q.firstChild;
        const r = document.createRange();
        r.setStart(t, 0); r.setEnd(t, t.textContent.length - 1);
        const word = r.getBoundingClientRect();
        r.setStart(t, t.textContent.length - 1); r.setEnd(t, t.textContent.length);
        const space = r.getBoundingClientRect().width;
        const gap = q.querySelector(".ol-min").getBoundingClientRect().left - word.right;
        return { text: q.textContent, gap: Math.round(gap * 10) / 10, space: Math.round(space * 10) / 10, off: Math.round(Math.abs(gap - space) * 10) / 10 };
      });
    const heights = [...document.querySelectorAll(".or-agent")].map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      nameFailures: names.filter((n) => !n.fits || n.ellipsis || !n.twoLines).length,
      longNameShown: names.some((n) => n.name === "dev-long-agent-name-here-x"),
      spaceGaps: gaps,
      slotHeights: [...new Set(heights)],
    };
  });

/** C16 features present, C5 heading, C10 the sentence's bottom edge. */
const features = (page) =>
  page.evaluate(() => {
    const has = (sel) => document.querySelectorAll(sel).length;
    const body = document.querySelector("main").innerText;
    return {
      h1: document.querySelector("h1")?.textContent,
      sentenceBottom: Math.round(document.querySelector(".or-sentence")?.getBoundingClientRect().bottom ?? -1),
      tally: has(".ol-tally"),
      strips: has(".ol-strip"),
      waitingAgent: /waiting\s7m/.test(body.replace(/\u00a0/g, " ")),
      permissionPrompt: /usually a permission prompt/.test(body),
      stalledMarks: [...document.querySelectorAll(".or-mark[data-mark]")].filter((e) => /stalled/i.test(e.textContent)).length,
      detailsButtons: [...document.querySelectorAll("main button")].filter((b) => /details/i.test(b.textContent)).length,
      showMore: [...document.querySelectorAll("main button")].filter((b) => /^show \d+ more/i.test((b.textContent || "").trim())).length,
      waitingWords: (body.match(/waiting/gi) ?? []).length,
    };
  });

async function board(s, key, ready, crop) {
  await ready;
  await shoot(s, key, crop);
  const vp = `${key}@${s.name}`;
  record("audit", vp, await audit(s.page));
  record("slots", vp, await slotChecks(s.page));
  record("features", vp, await features(s.page));
  record("live", vp, await live(s.page));
  if (s.name === "390") record("smallTargets390", key, await small(s.page));
}

// ---- tick sequences ----
const iso = () => new Date().toISOString();
const lane = (name, state, agents, stalledCount = 0) => ({
  name, title: null, state, lastActivityAt: iso(), model: "claude-opus-5-5", home: `C:/orchestrators/${name}`,
  inFlightCount: agents.length, stalledCount, watcher: "online",
  inFlight: agents.map(([n, q, w]) => ({ name: n, quietMin: q, waiting: w ?? null })),
});
const snap = (orchestrators) => ({ status: "ok", detail: "", fetchedAt: iso(), orchestrators });

async function serve(page, ref) {
  await page.route("**/api/orchestra/status", (route) => route.fulfill({ json: ref.snap }));
}
async function tick(page) {
  // The page must have had page.clock.install() before goto: the fake clock runs past the 10 s poll, so SWR refetches.
  const answered = page.waitForResponse((r) => r.url().includes("/api/orchestra/status"), { timeout: 15_000 }).catch(() => null);
  await page.clock.runFor(11_000);
  await answered;
  await page.waitForTimeout(300);
}
const geometry = (page) =>
  page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("[data-row-id]")].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.rowId, { top: Math.round(r.top * 10) / 10, h: Math.round(r.height * 10) / 10 }]; })),
  );
const transformAnimations = (page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getKeyframes?.().some((k) => k.transform && k.transform !== "none")).length);

// One bad state must not hide the rest: a throw (a failed waitFor included) is recorded as a FAIL and the next step runs.
let stage = "";
const fail = (vp, e) => record("FAIL", `${stage}@${vp}`, String(e?.message ?? e).split(/\r?\n/)[0]);
const each = (fn) => Promise.all(sessions.map((s) => fn(s).catch((e) => fail(s.name, e))));
const guarded = (label, fn) => { stage = label; return fn().catch((e) => fail("all", e)); };

try {
  for (const s of sessions) await signIn(s);

  // 1 unconfigured (fresh stack)
  stage = "step 1";
  await each(async (s) => { await goto(s.page, "/orchestrators", text("Orchestra is not connected")); await shoot(s, "01-unconfigured"); record("unconfigured", s.name, { h1: await s.page.locator("h1").textContent(), nothingNeedsYou: (await mainText(s.page)).includes("Nothing needs you") }); });
  // 2 settings card unset
  stage = "step 2";
  await each(async (s) => { await goto(s.page, "/settings#access", text("Service URL")); await shoot(s, "02-settings-unset", "text=Service URL >> xpath=ancestor::div[contains(@class,'panel')]"); });

  // 3 save URL + mock-slow through the card, then catch the loading skeleton
  stage = "step 3";
  const first = sessions[0].page;
  await guarded("step 3 save", async () => {
    await first.getByLabel("Service URL").fill(MOCK_URL);
    await first.getByLabel("Service token").fill("mock-slow");
    await first.locator(".panel", { has: first.getByLabel("Service URL") }).getByRole("button", { name: "Save" }).click();
    await first.getByText("saved").first().waitFor({ timeout: SLOW });
  });
  stage = "step 3";
  await each(async (s) => {
    await s.page.goto(`${BASE_URL}/orchestrators`, { waitUntil: "commit" });
    await s.page.locator("[aria-busy=true]").first().waitFor({ timeout: SLOW });
    await shoot(s, "03-loading");
    record("loading", s.name, { sentence: await s.page.locator(".or-sentence").count(), nothingNeedsYou: (await s.page.locator("body").innerText()).includes("Nothing needs you"), skeletonPanels: await s.page.locator("[aria-busy=true] .panel").count() });
    await strips(4)(s.page);
  });
  // 4 settings card set
  stage = "step 4";
  await each(async (s) => { await goto(s.page, "/settings#access", text("Service URL")); await shoot(s, "04-settings-set", "text=Service URL >> xpath=ancestor::div[contains(@class,'panel')]"); });

  // 5 ok-mixed: running, stopped, stalled and one the service could not read (the odip lane opens on first paint)
  stage = "step 5";
  await setCfg(first, { orchestraToken: "mock-mixed" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", strips(4));
    await board(s, "05-ok-mixed", s.page.locator("[data-checkpoint]").first().waitFor({ timeout: SLOW }), "main");
    record("badgesMixed", s.name, await texts(s.page, "[data-state-badge]"));
    // C3: record only; the review checks that no "waiting" sits on an agent whose waiting is null
    record("waitingNodes05", s.name, await s.page.evaluate(() => {
      const out = [], w = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/waiting/i.test(n.textContent)) continue;
        const el = n.parentElement;
        out.push({ text: n.textContent.trim().slice(0, 60), cls: el.className, rowId: el.closest("[data-row-id]")?.dataset.rowId ?? null });
      }
      return out;
    }));
    record("tallyMixed", s.name, await s.page.locator(".ol-tally").innerText());
    record("partialBand", s.name, await texts(s.page, "[data-band=partial]"));
    record("checkpointLength", s.name, (await s.page.locator("[data-checkpoint]").first().textContent()).length);
    record("sidebarLabel", s.name, s.name === "1440" ? (await s.page.locator("aside a[href='/orchestrators']").first().innerText()).trim() : null);
  });
  // 6 odip detail (open on first paint)
  stage = "step 6";
  await each(async (s) => { await shoot(s, "06-odip-detail", "[data-row-id='lane-odip']"); });
  // 6b load failed 403: the signed-in page, with the status route answering 403 before a fresh load (no data yet -> load-error)
  stage = "step 6b";
  await each(async (s) => {
    const pat = "**/api/orchestra/status";
    await s.page.route(pat, (route) => route.fulfill({ status: 403, json: { error: "forbidden" } }));
    await s.page.goto(`${BASE_URL}/orchestrators`, { waitUntil: "domcontentloaded" });
    await s.page.getByText("This page needs a full sign-in", { exact: false }).first().waitFor({ timeout: SLOW }).catch(() => {});
    const t = await s.page.locator("body").innerText();
    record("loadFailed403", s.name, { url: s.page.url(), has403Sentence: t.includes("This page needs a full sign-in. The kiosk PIN does not open it.") });
    await shoot(s, "06b-load-failed");
    await s.page.unroute(pat);
  });
  // 7 night-watch-orchestr (unknown) expanded -> detail error
  stage = "step 7";
  await each(async (s) => {
    await goto(s.page, "/orchestrators", strips(4));
    await s.page.locator("[data-row-id='lane-night-watch-orchestr']").getByRole("button", { name: "Details" }).click();
    await s.page.getByText("no longer in the registry").first().waitFor({ timeout: SLOW });
    await shoot(s, "07-detail-error", "[data-row-id='lane-night-watch-orchestr']");
    if (s.name === "390") record("smallTargets390", "07", await small(s.page));
  });

  // 8 stuck: one waiting agent, a stalled one at 24 m, a quiet one at 19 m, a 26-character name
  stage = "step 8";
  await setCfg(first, { orchestraToken: "mock-stuck" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", strips(4));
    await board(s, "08-stuck", s.page.locator(".or-quiet", { hasText: "waiting" }).first().waitFor({ timeout: SLOW }), "main");
    const fills = await s.page.evaluate(() => {
      const row = (id) => document.querySelector(`[data-row-id="${id}"]`);
      const look = (id) => ({ fillMarked: row(id)?.querySelector(".ol-fill")?.hasAttribute("data-mark"), badge: row(id)?.querySelector(".or-mark")?.textContent?.trim(), off: row(id)?.querySelector(".or-mark")?.hasAttribute("data-off") });
      return { stalled24: look("dev/dev-reviewer"), quiet19: look("dev/dev-builder"), waiting7: look("design/design-shape") };
    });
    record("stallMark", s.name, fills);
    record("designAttention", s.name, await s.page.locator("[data-row-id='lane-design'] .or-att").innerText());
    record("sentenceStuck", s.name, await s.page.locator(".or-sentence").innerText());
    record("stuckBadges", s.name, await texts(s.page, "[data-state-badge]"));
    await guarded("step 8 detail", async () => {
      await s.page.locator("span.shrink-0 > span.font-mono").first().waitFor({ timeout: SLOW });
      record("detailQuietCalm", s.name, await s.page.evaluate(() => {
        const dim = document.createElement("span"); dim.className = "text-ink-dim"; document.body.append(dim);
        const want = getComputedStyle(dim).color; dim.remove();
        const spans = [...document.querySelectorAll("main li span.shrink-0 > span.font-mono")];
        return { n: spans.length, allCalm: spans.length > 0 && spans.every((e) => getComputedStyle(e).color === want && !e.hasAttribute("data-mark")), want };
      }));
    });
    record("metaSepHidden", s.name, await s.page.evaluate(() => {
      const seps = [...document.querySelectorAll(".ol-page .or-sep")];
      return { n: seps.length, contents: [...new Set(seps.map((e) => getComputedStyle(e, "::before").content))], display: [...new Set(seps.map((e) => getComputedStyle(e).display))] };
    }));
  });
  // 9 busy: six agents in one lane, slot 4 reads "Show 3 more", which opens Details
  stage = "step 9";
  await setCfg(first, { orchestraToken: "mock-busy" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", strips(3));
    await board(s, "09-busy", s.page.getByRole("button", { name: /^Show 3 more/ }).first().waitFor({ timeout: SLOW }), "main");
    record("tallyBusy", s.name, await s.page.locator(".ol-tally").innerText());
    await s.page.getByRole("button", { name: /^Show 3 more/ }).first().click();
    record("showMoreOpensDetails", s.name, await s.page.locator("[data-row-id='lane-dev'] button[aria-expanded=true]").count());
  });

  // 10 all quiet (with a stopped lane), 11 partial: answered from the script so the data is exact
  stage = "step 10";
  const quiet = snap([lane("dev", "running", [["dev-builder", 3], ["dev-reviewer", 9]]), lane("odip", "running", [["odip-builder", 2]]), lane("design", "stopped", [])]);
  const partial = snap([lane("dev", "running", [["dev-builder", 3]]), lane("odip", "running", []), { ...lane("night-watch-orchestr", "unknown", []), lastActivityAt: null, model: null, home: null }]);
  for (const [key, data] of [["10-quiet", quiet], ["11-partial", partial]]) {
    await each(async (s) => {
      const ref = { snap: data };
      const p = await s.context.newPage();
      watch(p, `${s.name}-${key}`);
      await serve(p, ref);
      await p.goto(`${BASE_URL}/orchestrators`, { waitUntil: "domcontentloaded" });
      const view = { ...s, page: p };
      await board(view, key, strips(3)(p), "main");
      record("badges", `${key}@${s.name}`, await texts(p, "[data-state-badge]"));
      record("sentence", `${key}@${s.name}`, await p.locator(".or-sentence").innerText());
      await p.close();
    });
  }

  // 12 hold: lanes never move; a join and a leave wait behind the pill; the minutes stay live (C9)
  stage = "step 12";
  await setCfg(first, { orchestraToken: "mock-mixed" });
  await each(async (s) => {
    const p = await s.context.newPage();
    watch(p, `${s.name}-hold`);
    const at = (k, extra = {}) => snap([
      lane("dev", "running", [["a", 2 + k], ["b", 3 + k], ...(extra.dev ?? [])]),
      lane("odip", "running", [["c", 1 + k], ["d", 1 + k], ...(extra.odip ?? [["e", 1 + k]])]),
      lane("design", "stopped", []),
    ]);
    const ref = { snap: at(0) };
    await serve(p, ref);
    await p.clock.install();
    await p.goto(`${BASE_URL}/orchestrators`, { waitUntil: "domcontentloaded" });
    await strips(3)(p);
    const g0 = await geometry(p);
    const minutes0 = await p.locator("[data-row-id='odip/c'] .or-quiet").innerText();
    const box = await p.locator("[data-row-id='odip/e']").boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let worstMove = 0;
    let worstStrip = 0;
    const idSets = new Set();
    for (let k = 1; k <= 6; k++) {
      ref.snap = at(k, { dev: [["f", 1]], odip: [] }); // dev gains f, odip loses e, minutes move
      await tick(p);
      const g = await geometry(p);
      idSets.add(Object.keys(g).sort().join("|"));
      for (const [id, v] of Object.entries(g0)) {
        if (!g[id]) continue;
        worstMove = Math.max(worstMove, Math.abs(g[id].top - v.top));
        if (id.startsWith("lane-")) worstStrip = Math.max(worstStrip, Math.abs(g[id].h - v.h));
      }
    }
    const pills = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ol-strip")].map((e) => { const b = e.querySelector(".ol-new"); return [e.dataset.rowId, { text: b.textContent.trim(), visible: getComputedStyle(b).visibility === "visible" }]; })));
    const left = await p.evaluate(() => { const e = document.querySelector("[data-row-id='odip/e']"); return { present: Boolean(e), dim: e?.hasAttribute("data-left"), badge: e?.querySelector(".or-mark")?.textContent.trim() }; });
    record("hold", s.name, {
      idSetsOver6Ticks: idSets.size,
      worstRowMovePx: worstMove,
      worstStripHeightChangePx: worstStrip,
      minutesLive: minutes0 !== (await p.locator("[data-row-id='odip/c'] .or-quiet").innerText()),
      pills,
      leftSlot: left,
      newSlotShownBeforeTap: (await p.locator("[data-row-id='dev/f']").count()) > 0,
    });
    await shoot({ ...s, page: p }, "12-hold-pending", "main");
    await p.locator("[data-row-id='lane-dev'] .ol-new").click();
    await p.waitForTimeout(600);
    record("holdAfterTap", s.name, await p.evaluate(() => ({ newSlot: Boolean(document.querySelector("[data-row-id='dev/f']")), focusedRow: document.activeElement?.dataset?.rowId ?? null, pillVisible: getComputedStyle(document.querySelector("[data-row-id='lane-dev'] .ol-new")).visibility === "visible" })));
    await shoot({ ...s, page: p }, "12-hold-applied", "main");

    // C8: the 19 -> 20 tick adds a mark and changes no height
    ref.snap = snap([lane("dev", "running", [["x", 19]]), lane("odip", "running", [["y", 3]])]);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator("[data-row-id='dev/x']").waitFor({ timeout: SLOW });
    const before = { slot: (await geometry(p))["dev/x"].h, strip: (await geometry(p))["lane-dev"].h, marked: await p.locator("[data-row-id='dev/x'] .ol-fill[data-mark]").count() };
    ref.snap = snap([lane("dev", "stalled", [["x", 20]], 1), lane("odip", "running", [["y", 3]])]);
    await tick(p);
    const after = { slot: (await geometry(p))["dev/x"].h, strip: (await geometry(p))["lane-dev"].h, marked: await p.locator("[data-row-id='dev/x'] .ol-fill[data-mark]").count(), badge: (await p.locator("[data-row-id='dev/x'] .or-mark").innerText()).trim() };
    record("tick19to20", s.name, { before, after, slotHeightDelta: after.slot - before.slot, stripHeightDelta: after.strip - before.strip });
    await p.close();
  });

  // 13 mock-empty
  stage = "step 13";
  await setCfg(first, { orchestraToken: "mock-empty" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", text("No lanes registered"));
    await shoot(s, "13-empty", "main");
    record("liveEmpty", s.name, await live(s.page));
  });
  // 14 wrong token
  stage = "step 14";
  await setCfg(first, { orchestraToken: "wrong" });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", text("rejected the token"));
    await shoot(s, "14-unauthorized", "main");
    record("liveUnauthorized", s.name, await live(s.page));
    record("unauthBand", s.name, { bands: await s.page.locator("[data-band=unauth]").count(), nothingNeedsYou: (await mainText(s.page)).includes("Nothing needs you") });
    if (s.name === "390") record("smallTargets390", "14", await small(s.page));
  });
  // 15 stale: ok first, then the URL stops resolving, same tab
  stage = "step 15";
  await setCfg(first, { orchestraToken: "mock-stuck", orchestraUrl: MOCK_URL });
  await each(async (s) => {
    await goto(s.page, "/orchestrators", strips(4));
    await s.page.waitForTimeout(11_000);
  });
  await setCfg(first, { orchestraUrl: UNREACHABLE_URL });
  await each(async (s) => {
    await s.page.getByText("is not answering").first().waitFor({ timeout: SLOW });
    await shoot(s, "15-unreachable-stale", "main");
    record("badgesStale", s.name, await texts(s.page, "[data-state-badge]"));
    record("staleState", s.name, {
      band: await s.page.locator("[data-band=stale]").count(),
      marksAtRest: await s.page.locator(".or-mark[data-mark], .ol-fill[data-mark]").count(),
      stripOpacity: await s.page.locator(".ol-strip").first().evaluate((e) => getComputedStyle(e).opacity),
      nothingNeedsYou: (await mainText(s.page)).includes("Nothing needs you"),
      sentences: await s.page.locator(".or-sentence").count(),
    });
    record("audit", `15-stale@${s.name}`, await audit(s.page));
    record("liveStale", s.name, await live(s.page));
  });
  // 16 reload -> unreachable with nothing last-known
  stage = "step 16";
  await each(async (s) => {
    await s.page.reload({ waitUntil: "domcontentloaded" });
    await s.page.getByText("is not answering").first().waitFor({ timeout: SLOW });
    await shoot(s, "16-unreachable-cold", "main");
    record("cardsAfterReload", s.name, await s.page.locator("[data-state-badge]").count());
    record("liveCold", s.name, await live(s.page));
    record("coldState", s.name, { band: await s.page.locator("[data-band=error]").count(), nothingNeedsYou: (await mainText(s.page)).includes("Nothing needs you") });
  });
  // 17 sidebar with AI lanes active (1440), More sheet (390)
  await guarded("step 17", async () => {
    const d = sessions[0];
    await goto(d.page, "/orchestrators", text("is not answering"));
    await d.page.locator("aside").screenshot({ path: join(OUT_DIR, "orchestra-17-sidebar-1440-crop.png") });
    record("sidebarAiLanes", "1440", { links: await d.page.locator("aside a[href='/orchestrators']").count(), label: (await d.page.locator("aside a[href='/orchestrators']").first().innerText()).trim() });
    const m = sessions[1];
    await goto(m.page, "/orchestrators", text("is not answering"));
    const cell = m.page.locator("button[aria-haspopup=dialog]");
    record("moreCellText", "390", (await cell.textContent()).trim());
    await cell.click();
    await m.page.getByRole("dialog", { name: "More navigation" }).waitFor();
    await shoot(m, "17-more-sheet");
  });

  // 18 reduced motion (C15): no transform animation on a tick or a tap, the fill does not transition, the dot does not pulse
  await guarded("step 18", async () => {
    await setCfg(first, { orchestraUrl: MOCK_URL, orchestraToken: "mock-stuck" });
    const ctx = await browser.newContext({ ...VIEWPORTS[0], reducedMotion: "reduce" });
    const p = await ctx.newPage();
    watch(p, "reduced");
    await signIn({ page: p });
    const ref = { snap: snap([lane("dev", "running", [["a", 19]]), lane("odip", "running", [["c", 2]])]) };
    await serve(p, ref);
    await p.clock.install();
    await p.goto(`${BASE_URL}/orchestrators`, { waitUntil: "domcontentloaded" });
    await p.locator("[data-row-id='dev/a']").waitFor({ timeout: SLOW });
    ref.snap = snap([lane("dev", "stalled", [["a", 20], ["b", 1]], 1), lane("odip", "running", [["c", 3]])]);
    await tick(p);
    const afterTick = await transformAnimations(p);
    await p.locator("[data-row-id='lane-dev'] .ol-new").click();
    const afterTap = await transformAnimations(p);
    record("reducedMotion", "1440", await p.evaluate(([t, tap]) => ({
      transformAnimationsAfterTick: t,
      transformAnimationsAfterTap: tap,
      fillTransitionDuration: getComputedStyle(document.querySelector(".ol-fill")).transitionDuration,
      dotAnimation: document.querySelector(".dot-unhealthy") ? getComputedStyle(document.querySelector(".dot-unhealthy")).animationName : "no dot",
    }), [afterTick, afterTap]));
    await ctx.close();
  });

  record("pageErrors", "all", pageErrors);
  record("foreignRequests", "all", [...new Set(foreignRequests)]);
} finally {
  for (const s of sessions) await s.context.close().catch(() => {});
  await browser.close();
}
console.log(JSON.stringify(checks));
