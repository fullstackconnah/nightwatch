#!/usr/bin/env node
/* Captures /resources?metric=gpu (TRANSCODE STREAMS) for branch fix/unreachable-not-timeout (hunt 98) at 1440 and 390 and prints
 * the numeric checks as one JSON object on the last line (FAIL lines before it). Opens no images itself.
 * State: unreachable. /api/transcodes is answered the way the real route answers when Jellyfin refuses the connection
 * (always 200, { ok: false, reason: "unreachable", detail }), carrying the new "is not reachable." detail; gpu-view.tsx
 * renders it in its own mono line, so the text reaches the screen through the page, never injected into the DOM.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/unreachable-shots.mjs
 *   SHOTS_ONLY=unreachable   (an empty value runs every state)
 *
 * Needs the test stack and Playwright, which is not a dependency of this repo; run it where one is installed.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const STATES = ["unreachable"];
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY;
const SLOW = 40_000;
const DETAIL = "Jellyfin is not reachable.";
const results = {};
const pageErrors = [];
let failed = 0;
const record = (key, where, value) => ((results[key] ??= {})[where] = value);
const check = (key, where, ok, value) => {
  record(key, where, ok ? value : `FAIL: ${JSON.stringify(value)}`);
  if (!ok) {
    failed++;
    console.log(`FAIL ${key} @ ${where}: ${JSON.stringify(value)}`);
  }
};
mkdirSync(OUT_DIR, { recursive: true });

const docOverflow = () => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(browser, vp, state, setup) {
  const context = await browser.newContext(vp);
  // The test stack's admin gate: same login as scripts/media-shots.mjs.
  await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${vp.name} ${state}: ${e.message}`));
  await setup?.(page);
  await page.goto(`${BASE_URL}/resources?metric=gpu`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return { context, page };
}

// Padded crop (16 px, clamped to the page) of one element; fails when fixed or sticky chrome overlaps the crop rect.
const TOP_GAP = 96; // park the panel this far down: clears the 390 sticky header, plus the 16 px pad
const cropElement = async (page, loc, state, vpName) => {
  await loc.evaluate((el, gap) => {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    scrollBy(0, -gap);
  }, TOP_GAP);
  const r = await loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const pad = 16;
    const x = Math.max(0, b.left - pad), y = b.top - pad, w = Math.min(b.width + 2 * pad, innerWidth - x), h = b.height + 2 * pad;
    const over = [...document.querySelectorAll("body *")].filter((e) => {
      if (e.contains(el) || el.contains(e)) return false;
      const cs = getComputedStyle(e);
      if (cs.position !== "fixed" && cs.position !== "sticky") return false;
      const q = e.getBoundingClientRect();
      return q.width > 0 && q.height > 0 && q.left < x + w && q.right > x && q.top < y + h && q.bottom > y;
    }).map((e) => e.tagName.toLowerCase() + "." + String(e.className).slice(0, 30));
    return { clip: { x, y: Math.max(0, y + scrollY), width: w, height: h }, over };
  });
  check("crop not covered by fixed or sticky chrome", `${state}@${vpName}`, r.over.length === 0, r.over);
  await page.screenshot({ path: join(OUT_DIR, `unreachable-${state}-${vpName}.png`), fullPage: true, clip: r.clip });
};

// The TRANSCODE STREAMS block: the div holding that label; its panel is the error panel.
const txBlock = (page) => page.locator("div.space-y-2", { has: page.getByText("TRANSCODE STREAMS", { exact: true }) }).last();

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const run = async (state, fn, setup, crop) => {
      if (ONLY && ONLY !== state) return;
      const where = `${state}@${vp.name}`;
      let ctx;
      try {
        ctx = await open(browser, vp, state, setup);
        await fn(ctx.page, where);
        await ctx.page.screenshot({ path: join(OUT_DIR, `unreachable-${state}-${vp.name}-full.png`), fullPage: true });
        await cropElement(ctx.page, crop(ctx.page), state, vp.name);
        const o = await ctx.page.evaluate(docOverflow);
        check("document does not overflow sideways", where, o.scroll <= o.client, o);
      } catch (e) {
        check("state reached", where, false, String(e).slice(0, 200));
        await ctx?.page.screenshot({ path: join(OUT_DIR, `unreachable-${state}-FAIL-${vp.name}.png`), fullPage: true }).catch(() => {});
      } finally {
        await ctx?.context.close();
      }
    };

    await run("unreachable", async (page, where) => {
      // The element is rendered by the page after hydration and the fetch; wait for it rather than reading at domcontentloaded.
      const line = txBlock(page).locator("div.font-mono", { hasText: DETAIL });
      await line.waitFor({ timeout: SLOW });
      await line.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      const m = await line.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth, left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth, vh: innerHeight };
      });
      check("detail text contains the new string", where, (m.text ?? "").includes(DETAIL), m.text);
      check("detail text is not the timeout sentence", where, !(m.text ?? "").includes("did not respond within"), m.text);
      check("detail scrollWidth <= clientWidth", where, m.sw <= m.cw, { sw: m.sw, cw: m.cw });
      check("detail box inside the viewport", where, m.left >= 0 && m.right <= m.vw && m.top >= 0 && m.bottom <= m.vh, { left: m.left, right: m.right, top: m.top, bottom: m.bottom, vw: m.vw, vh: m.vh });
    }, (page) => page.route(/\/api\/transcodes(\?|$)/, (route) => json(route, { ok: false, reason: "unreachable", detail: DETAIL })), (page) => txBlock(page).locator(".panel"));
  }
} finally {
  await browser.close();
}
check("page errors", "all", pageErrors.length === 0, pageErrors.slice(0, 10));
// A mistyped SHOTS_ONLY would otherwise run the default sections and look green.
check("SHOTS_ONLY names a known state", "all", !ONLY || STATES.includes(ONLY), ONLY);
console.log(JSON.stringify({ failed, results }));
process.exit(failed ? 1 : 0);
