#!/usr/bin/env node
/* Captures the "New container" dialog on /docker (test stack, every /api/docker call mocked) at 1440x900 and 390x844 and prints
 * {"failed":n,"checks":[...]} as the last stdout line. Opens no images itself.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/create-form-shots.mjs
 *
 * Needs the test stack and Playwright (not a repo dependency); run it where one is installed.
 * States: cform-port-refused (a port row with only the host: the message, no create request, no sideways overflow),
 * cform-env-refused (an env value with a blank name), cform-busy (the create POST held open: Cancel and X disabled,
 * Escape leaves the dialog, then the mock is fulfilled and the dialog closes). Pinned: time zone, locale, reduced motion off.
 * No cropElement helper exists in this repo (see docker-shots.mjs), so the crop is a padded viewport clip of the fixed dialog.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { containersFor, imagesFor, volumesFor, diskFor } from "./fixtures/docker/fixtures.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const CTX = { timezoneId: "Australia/Sydney", locale: "en-AU", reducedMotion: "no-preference" };
const PORT_MSG = "Port row 1 needs both a host and a container port.";
const ENV_MSG = "Variable row 1 needs a name.";

mkdirSync(OUT_DIR, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: !!pass, detail });
  if (!pass) console.log(`FAIL ${name} (${detail})`);
};
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Mocks the docker reads and records every POST to the create route; `hold` (a promise) keeps that POST pending.
async function openDialog(browser, opts, hold) {
  const context = await browser.newContext({ ...opts, ...CTX });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
  if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);
  const posts = [];
  await page.route("**/api/docker/**", async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (req.method() === "POST" && pathname.endsWith("/api/docker/containers")) {
      posts.push(req.postData());
      if (hold) await hold;
      return json(route, 200, { ok: true, id: "ab12cd34ef56" });
    }
    if (req.method() !== "GET") return json(route, 200, { ok: true });
    if (pathname.endsWith("/api/docker/containers")) return json(route, 200, containersFor("full"));
    if (pathname.endsWith("/api/docker/images")) return json(route, 200, imagesFor("full"));
    if (pathname.endsWith("/api/docker/volumes")) return json(route, 200, volumesFor("full"));
    if (pathname.endsWith("/api/docker/disk-usage")) return json(route, 200, diskFor("full"));
    return json(route, 200, {});
  });
  const apiUrls = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) apiUrls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE_URL}/docker`, { waitUntil: "domcontentloaded" });
  // Hydration signal (as docker-shots.mjs): the chore rows only render once the client has fetched the mocked reads.
  await page.locator("[data-chore]").first().waitFor({ timeout: 30_000 });
  const dialog = page.getByRole("dialog");
  const btn = page.locator('[data-feature="create"]');
  let tries = 0;
  for (; tries < 5; ) {
    tries++;
    await btn.click();
    if (await dialog.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) return { context, page, dialog, posts, errors };
  }
  const facts = {
    tries, visible: await btn.isVisible(), enabled: await btn.isEnabled().catch(() => false),
    readyState: await page.evaluate(() => document.readyState), apiRequests: apiUrls.join(" | "), pageerrors: errors.join("; "),
  };
  throw new Error(`dialog did not open ${JSON.stringify(facts)}`);
}

// Padded (16 px) viewport clip of the fixed dialog, clamped to the viewport. Chrome (fixed or sticky) covers the dialog only when
// it intersects the dialog's own box AND is painted above it at the intersection centre (elementsFromPoint order); chrome behind the scrim does not count.
async function crop(page, dialog, file, label) {
  const { clip, covered, rects } = await dialog.evaluate((el, pad) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    const box = { left: x, top: y, right: Math.min(innerWidth, r.right + pad), bottom: Math.min(innerHeight, r.bottom + pad) };
    const rect = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round).join(",");
    const rects = [];
    const covered = [...document.querySelectorAll("body *")].filter((e) => {
      const cs = getComputedStyle(e);
      if (!["fixed", "sticky"].includes(cs.position) || cs.visibility === "hidden" || cs.display === "none" || e.contains(el)) return false;
      const b = e.getBoundingClientRect();
      const l = Math.max(b.left, r.left), t = Math.max(b.top, r.top), rt = Math.min(b.right, r.right), bt = Math.min(b.bottom, r.bottom);
      if (!(b.width > 0 && b.height > 0 && l < rt && t < bt)) return false;
      const stack = document.elementsFromPoint((l + rt) / 2, (t + bt) / 2);
      const above = stack.findIndex((s) => e === s || e.contains(s)), dlg = stack.findIndex((s) => el === s || el.contains(s));
      rects.push(`${e.tagName.toLowerCase()}[${rect(b)}] above=${above} dialog=${dlg}`);
      return above !== -1 && (dlg === -1 || above < dlg);
    }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}[${rect(e.getBoundingClientRect())}]`);
    return { clip: { x, y, width: box.right - x, height: box.bottom - y }, covered, rects: [`dialog[${rect(r)}]`, `clip[${rect(box)}]`, ...rects] };
  }, 16);
  check(`${label} crop clear of fixed or sticky chrome`, covered.length === 0, `${covered.join(", ")} | ${rects.join(" ; ")}`);
  await page.screenshot({ path: join(OUT_DIR, file), clip });
}

const noSidewaysScroll = (dialog) => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth);
// A timeout names what the dialog showed and how many create POSTs went out.
async function waitAlert(alert, dialog, posts) {
  try { await alert.waitFor({ state: "visible", timeout: 5_000 }); } catch (e) {
    throw new Error(`alert not shown: dialog="${(await dialog.innerText().catch(() => "?")).slice(0, 300).replace(/\s+/g, " ")}" posts=${posts.length}`);
  }
}
const msg = (e) => String(e?.message ?? e).split(/\r?\n/)[0];

const browser = await chromium.launch({ headless: true });
try {
  for (const { name, viewport, ...opts } of VIEWPORTS) {
    const ctxOpts = { viewport, ...opts };

    // cform-port-refused
    try {
      const { context, page, dialog, posts, errors } = await openDialog(browser, ctxOpts);
      await dialog.getByPlaceholder("nginx:alpine").fill("nginx:alpine");
      await dialog.getByRole("button", { name: "add" }).first().click();
      await dialog.getByLabel("Host port 1").fill("8080");
      await dialog.getByRole("button", { name: "Create & start" }).click();
      const alert = dialog.getByRole("alert");
      await waitAlert(alert, dialog, posts);
      check(`cform-port-refused @${name}: message`, (await alert.innerText()) === PORT_MSG, await alert.innerText());
      await page.waitForTimeout(300);
      check(`cform-port-refused @${name}: no create request`, posts.length === 0, `${posts.length} POSTs`);
      check(`cform-port-refused @${name}: error line fits the dialog`, await alert.evaluate((el) => el.scrollWidth <= el.clientWidth), "");
      check(`cform-port-refused @${name}: no sideways scroll`, await noSidewaysScroll(dialog), "");
      check(`cform-port-refused @${name}: submit not busy`, await dialog.getByRole("button", { name: "Create & start" }).isEnabled(), "");
      check(`cform-port-refused @${name}: no pageerror`, errors.length === 0, errors.join("; "));
      await crop(page, dialog, `cform-port-refused-${name}-crop.png`, `cform-port-refused @${name}`);
      await page.screenshot({ path: join(OUT_DIR, `cform-port-refused-${name}-full.png`), fullPage: true });
      await context.close();
    } catch (e) {
      check(`cform-port-refused @${name}: completed`, false, msg(e));
    }

    // cform-env-refused
    try {
      const { context, page, dialog, posts } = await openDialog(browser, ctxOpts);
      await dialog.getByPlaceholder("nginx:alpine").fill("nginx:alpine");
      await dialog.getByRole("button", { name: "add" }).nth(1).click();
      await dialog.getByLabel("Variable value 1").fill("x");
      await dialog.getByRole("button", { name: "Create & start" }).click();
      const alert = dialog.getByRole("alert");
      await waitAlert(alert, dialog, posts);
      check(`cform-env-refused @${name}: message`, (await alert.innerText()) === ENV_MSG, await alert.innerText());
      await page.waitForTimeout(300);
      check(`cform-env-refused @${name}: no create request`, posts.length === 0, `${posts.length} POSTs`);
      check(`cform-env-refused @${name}: error line fits the dialog`, await alert.evaluate((el) => el.scrollWidth <= el.clientWidth), "");
      check(`cform-env-refused @${name}: no sideways scroll`, await noSidewaysScroll(dialog), "");
      await crop(page, dialog, `cform-env-refused-${name}-crop.png`, `cform-env-refused @${name}`);
      await context.close();
    } catch (e) {
      check(`cform-env-refused @${name}: completed`, false, msg(e));
    }

    // cform-busy
    try {
      let release;
      const hold = new Promise((r) => (release = r));
      const { context, page, dialog, posts } = await openDialog(browser, ctxOpts, hold);
      await dialog.getByPlaceholder("nginx:alpine").fill("nginx:alpine");
      await dialog.getByRole("button", { name: "Create & start" }).click();
      await dialog.getByRole("button", { name: "Pulling & starting…" }).waitFor({ state: "visible", timeout: 5_000 });
      check(`cform-busy @${name}: Cancel disabled`, await dialog.getByRole("button", { name: "Cancel" }).evaluate((el) => el.disabled === true), "");
      check(`cform-busy @${name}: X disabled`, await dialog.getByRole("button", { name: "Close" }).evaluate((el) => el.disabled === true), "");
      // Focus must stay on the busy submit button and the dialog itself must show no ring (its own inset .panel highlight is not one).
      check(`cform-busy @${name}: focus stays on the submit button`, await page.evaluate(() => document.activeElement?.textContent?.trim() === "Pulling & starting…" && document.activeElement.getAttribute("aria-disabled") === "true"), "");
      const ring = await dialog.evaluate((el) => {
        const cs = getComputedStyle(el);
        const shadowLeft = cs.boxShadow.replace(/rgba?\([^)]*\)[^()]*?\binset\b/g, "").replace(/[,\s]/g, "");
        return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow, noOutline: cs.outlineStyle === "none" || cs.outlineWidth === "0px", noShadowRing: shadowLeft === "" || shadowLeft === "none" };
      });
      check(`cform-busy @${name}: dialog shows no focus ring`, ring.noOutline && ring.noShadowRing, JSON.stringify(ring));
      // Escape is pressed with focus where the user has it (the busy submit button); its keydown bubbles to the dialog's handler.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      check(`cform-busy @${name}: Escape leaves the dialog`, await dialog.isVisible(), "");
      check(`cform-busy @${name}: one create request`, posts.length === 1, `${posts.length} POSTs`);
      await crop(page, dialog, `cform-busy-${name}-crop.png`, `cform-busy @${name}`);
      release();
      await dialog.waitFor({ state: "detached", timeout: 10_000 });
      check(`cform-busy @${name}: dialog closes after success`, true);
      await context.close();
    } catch (e) {
      check(`cform-busy @${name}: completed`, false, msg(e));
    }
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass).length;
console.log(JSON.stringify({ failed, checks }));
process.exit(failed ? 1 : 0);
