// Voice: the kiosk error line when the voice server is down ("Voice server is not reachable."). Never run on the PC: the lead runs it on the server.
// Run: ONLY=voice-unreachable BASE_URL=http://localhost:3006 OUT_DIR=shots node scripts/voice-shots.mjs  (SHOTS_ONLY works too; BASE_URL must be a secure
// context, i.e. localhost, or the kiosk shows the text fallback instead of the mic and this script fails with a clear message.)
// Path: fake microphone (no text path reaches the error without a Hermes ask). Chromium fakes the device; tap the mic twice; /api/voice/transcribe answers
// the route's real unreachable shape (src/app/api/voice/transcribe/route.ts: 502 + { status: "unreachable", detail }).
// No cropElement helper exists in this repo (kiosk-shots.mjs says the same), so the crop is a padded clip, as kiosk-shots fullview l.318.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUIET, ROUTES } from "./fixtures/kiosk/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ONLY = process.env.SHOTS_ONLY || process.env.ONLY || "voice-unreachable"; // empty or unset runs every state (there is one)
const VIEWPORT = { width: 1024, height: 768 }; // SIZES[1] in kiosk-shots.mjs, the viewport its elevated state uses
const URL_ = `${BASE_URL}/kiosk?theme=sunroom&wx=off&layout=standard`;
const DETAIL = "Voice server is not reachable.";
const PAD = 16;

mkdirSync(OUT_DIR, { recursive: true });
const results = { checks: {}, failed: [], errors: [] };
const STEP_MS = 10_000;
let curPage = null;
// every step names itself; a failure saves voice-FAILED-<step>.png and lists the visible buttons so one run finishes the diagnosis
async function step(name, fn) {
  try {
    return await fn();
  } catch (e) {
    const slug = name.replace(/[^a-z0-9]+/gi, "-");
    let buttons = [];
    if (curPage) {
      await curPage.screenshot({ path: join(OUT_DIR, `voice-FAILED-${slug}.png`), fullPage: true }).catch(() => {});
      buttons = await curPage.getByRole("button").evaluateAll((els) => els.slice(0, 40).map((b) => b.getAttribute("aria-label") || b.textContent?.trim() || "?")).catch(() => []);
    }
    const msg = String(e?.message ?? e).split(/\r?\n/)[0];
    console.log(`STEP FAILED ${name}: ${msg}`);
    console.log(`visible buttons: ${JSON.stringify(buttons)}`);
    throw new Error(`step "${name}": ${msg}`);
  }
}
const rec = (key, ok, value) => {
  results.checks[key] = { ok, value };
  if (!ok) results.failed.push(key);
  console.log(`${ok ? "ok  " : "FAIL"} ${key}: ${JSON.stringify(value)}`);
};

async function unreachable() {
  const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["microphone"] });
    const page = await context.newPage();
    curPage = page;
    page.setDefaultTimeout(STEP_MS);
    let elevated = false; // the page recovers elevation from /refresh on mount, so it must answer "not elevated" until the PIN POST (an always-true stub hides the Admin button)
    const until = Date.now() + 600_000;
    await page.route("**/kiosk/api/**", (route) => route.fulfill({ json: ROUTES[new URL(route.request().url()).pathname] ?? QUIET }));
    await page.route("**/api/auth/kiosk", (route) => (route.request().method() === "POST" ? ((elevated = true), route.fulfill({ json: { ok: true, expiresAt: until } })) : route.fallback()));
    await page.route("**/api/auth/kiosk/refresh", (route) => route.fulfill({ json: elevated ? { elevated: true, expiresAt: until } : { elevated: false } }));
    await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/voice/transcribe", (route) => route.fulfill({ status: 502, json: { status: "unreachable", detail: DETAIL } }));
    await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 90_000 }); // a fresh test stack's first load is slow (as networks-shots)
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    // As kiosk-shots visit(): a click before the page hydrates does nothing, so the PIN pad never opened.
    await page.locator('[data-kiosk-theme="sunroom"]').first().waitFor({ state: "attached" });
    await page.waitForTimeout(1200);

    // elevate: the admin PIN pad, as kiosk-shots "fullview elevated"
    await step("open admin pad", async () => {
      await page.getByRole("button", { name: /^Admin/ }).first().click();
      await page.locator("[role=dialog]").first().waitFor();
    });
    await step("type pin", async () => {
      for (const dg of "0000") await page.getByRole("button", { name: `digit ${dg}` }).click();
    });
    await step("wait elevated", async () => {
      await page.getByText("elevated", { exact: true }).first().waitFor(); // the dock's elevated mark, as kiosk-shots
    });
    const mic = page.getByRole("button", { name: "Tap to ask Hermes" });
    await step("mic start", async () => {
      await mic.waitFor(); // absent: voice status not read, or a non-secure BASE_URL (text fallback shown)
      await mic.click();
      await page.getByRole("button", { name: "Tap to stop" }).waitFor();
    });
    await page.waitForTimeout(800); // the fake device needs a moment of audio or the clip is empty
    await step("mic stop", () => page.getByRole("button", { name: "Tap to stop" }).click());
    await step("error shown", () => page.getByRole("button", { name: DETAIL, exact: true }).waitFor());
    await page.waitForTimeout(500);

    const m = await page.evaluate((detail) => {
      const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === detail);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const root = document.documentElement;
      return {
        text: el.textContent?.trim(), sw: el.scrollWidth, cw: el.clientWidth,
        docSW: root.scrollWidth, docCW: root.clientWidth,
        box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        vw: window.innerWidth, vh: window.innerHeight,
        covered: !(top === el || el.contains(top)),
      };
    }, DETAIL);
    if (!m) throw new Error("error line not found after it was awaited");
    rec("text equals the string", m.text === DETAIL, m.text);
    rec("error line not clipped (scrollWidth <= clientWidth)", m.sw <= m.cw, { scrollWidth: m.sw, clientWidth: m.cw });
    rec("document does not overflow sideways", m.docSW <= m.docCW, { scrollWidth: m.docSW, clientWidth: m.docCW });
    rec("error line box inside the viewport", m.box.left >= 0 && m.box.top >= 0 && m.box.right <= m.vw && m.box.bottom <= m.vh, { box: m.box, vw: m.vw, vh: m.vh });
    rec("error line not covered by fixed or sticky chrome", !m.covered, { covered: m.covered });

    // the voice panel: its "voice" microlabel's parent column, padded
    const panel = page.locator("span.microlabel", { hasText: /^voice$/ }).first().locator("xpath=..");
    await panel.scrollIntoViewIfNeeded();
    const bb = await panel.boundingBox();
    if (!bb) throw new Error("voice panel has no box");
    const clip = { x: Math.max(0, bb.x - PAD), y: Math.max(0, bb.y - PAD), width: Math.min(VIEWPORT.width - Math.max(0, bb.x - PAD), bb.width + PAD * 2), height: Math.min(VIEWPORT.height - Math.max(0, bb.y - PAD), bb.height + PAD * 2) };
    await page.screenshot({ path: join(OUT_DIR, "voice-unreachable-1024x768.png"), clip });
    await context.close();
  } finally {
    await browser.close();
  }
}

if (ONLY === "voice-unreachable") {
  try {
    await unreachable();
  } catch (e) {
    results.errors.push(String(e?.message ?? e).split("\n")[0]);
    console.error(`ERROR voice-unreachable: ${results.errors[0]}`);
  }
} else {
  results.errors.push(`unknown ONLY value "${ONLY}" (only voice-unreachable exists)`);
}
writeFileSync(join(OUT_DIR, "voice-results.json"), JSON.stringify(results, null, 2));
const failed = results.failed.length + results.errors.length + (Object.keys(results.checks).length < 5 ? 1 : 0); // 5 checks; a thrown block leaves fewer
console.log(JSON.stringify({ failed, results })); // last line, one JSON line, as kiosk-shots and resources-shots
process.exit(failed ? 1 : 0);
