#!/usr/bin/env node
/* Captures the Overview's ODIP backup tile on the test stack, once per fixture
 * state. Run it with the stack's ODIP_BACKUP_STATUS_PATH pointing at one of
 * scripts/fixtures/backup-status/*.json (or at a path that doesn't exist, for
 * STATE=missing); the route reads the file per request, so swapping the file
 * between runs is enough. STATE=loading holds /api/backup open instead.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots STATE=ok node scripts/backup-tile-shots.mjs
 *
 * Needs Playwright >= 1.45 (page.clock). Playwright is not a dependency of
 * this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const STATE = process.env.STATE ?? "ok";
// The fixtures are stamped around this moment. Pinning the browser clock keeps
// every age and the 26 h "check is old" rule the same whatever day this runs.
const FIXED_NOW = process.env.FIXED_NOW ?? "2026-10-15T12:00:00+11:00";

const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { name, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(FIXED_NOW));

    // The test stack is a dev build, which accepts any non-empty password.
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);

    if (STATE === "loading") await page.route("**/api/backup", () => {}); // never answered

    // Never "networkidle": the dashboard keeps polling.
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const tile = page.getByRole("region", { name: "ODIP backup" });
    await tile.waitFor({ timeout: 30_000 });
    if (STATE !== "loading") {
      await tile.getByText("reading backup status…").waitFor({ state: "detached", timeout: 30_000 });
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`${STATE} @ ${name}: horizontal overflow ${overflow}px`);

    await tile.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-view.png`) });
    await tile.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-tile.png`) });
    await page.screenshot({ path: join(OUT_DIR, `backup-${STATE}-${name}-page.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
