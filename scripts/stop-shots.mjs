#!/usr/bin/env node
/* Captures the Stop two-step on the callers reachable on the test stack (the
 * container detail page, /resources and /minecraft), every API call mocked so
 * nothing is ever stopped. Rest and confirm at 1440 and 390. Checks (C2): the
 * idle Stop has no danger colour; the confirm names the container, Yes's
 * accessible name is "Yes, stop {name}", Cancel and Escape close it, and no
 * stop POST goes out before Yes. Also 0 page errors.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/stop-shots.mjs
 *
 * Needs Playwright, which is not a dependency of this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ID = "ab12cd34ef56" + "0".repeat(52);
const NAME = "minecraft";

const INSPECT = {
  id: ID, name: NAME, image: "itzg/minecraft-server", created: "2026-10-01T00:00:00Z",
  state: { status: "running", running: true, startedAt: "2026-10-01T00:00:00Z", exitCode: 0, health: null, restartCount: 0, oomKilled: false },
  restartPolicy: "no", networkMode: "bridge", composeProject: null, composeService: null,
  ports: [], mounts: [], env: [], cmd: "start",
};
const LIST = {
  containers: [{ id: ID, name: NAME, image: "itzg/minecraft-server", state: "running", status: "Up 2 days", ports: [], composeProject: null, composeService: null, tile: { url: null } }],
  groups: [], counts: { total: 1, running: 1, paused: 0, stopped: 0, restarting: 0, unhealthy: 0 },
};
const MC_STATUS = { manager: "ok", instances: [], active: null, players: { online: 0, max: 10, players: [] }, rcon: "ok" };

const CALLERS = [
  { id: "detail", path: `/containers/${ID}` },
  { id: "resources", path: "/resources" },
  { id: "minecraft", path: "/minecraft" },
];
const VIEWPORTS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { name: vp, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // The test stack is a dev build, which accepts any non-empty password.
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);

    let posts = 0;
    await page.route("**/api/**", (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (pathname.endsWith("/action")) {
        if (req.method() === "POST") posts += 1;
        return json(route, 200, { ok: true });
      }
      if (pathname === "/api/auth/login") return route.continue();
      if (pathname === "/api/docker/containers") return json(route, 200, LIST);
      if (pathname.endsWith(`/containers/${ID}`)) return json(route, 200, INSPECT);
      if (pathname === "/api/minecraft/status") return json(route, 200, MC_STATUS);
      if (pathname === "/api/minecraft/backups") return json(route, 200, { backups: [] });
      return json(route, 200, {});
    });

    for (const caller of CALLERS) {
      const tag = `${caller.id} ${vp}`;
      posts = 0;
      await page.goto(`${BASE_URL}${caller.path}`, { waitUntil: "domcontentloaded" });
      const stop = page.getByRole("button", { name: new RegExp(`^Stop( ${NAME})?$`) }).first();
      try {
        await stop.waitFor({ timeout: 30_000 });
      } catch {
        check(`${tag}: Stop button reachable`, false, "not found; the mock may not reach this caller");
        continue;
      }
      await stop.scrollIntoViewIfNeeded();
      const shot = (state) => page.screenshot({ path: join(OUT_DIR, `stop-${state}-${caller.id}-${vp}.png`) });

      const colours = await stop.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-bad)";
        document.body.appendChild(probe);
        const bad = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(el);
        return { color: s.color, background: s.backgroundColor, border: s.borderColor, bad };
      });
      check(`${tag} rest: Stop has no danger colour`, [colours.color, colours.background, colours.border].every((c) => c !== colours.bad), JSON.stringify(colours));
      await shot("rest");

      await stop.click({ force: true });
      const yes = page.getByRole("button", { name: `Yes, stop ${NAME}` });
      await yes.waitFor({ timeout: 5_000 }).catch(() => {});
      check(`${tag} confirm: Yes named "Yes, stop ${NAME}"`, (await yes.count()) === 1);
      check(`${tag} confirm: frame text names the container`, await page.getByText(`Stop ${NAME}?`).isVisible().catch(() => false));
      check(`${tag} confirm: 0 stop POSTs before Yes`, posts === 0, `posts=${posts}`);
      await shot("confirm");

      await page.keyboard.press("Escape");
      check(`${tag}: Escape closes the confirm`, (await yes.count()) === 0);
      await stop.click({ force: true });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      check(`${tag}: Cancel closes the confirm`, (await yes.count()) === 0);
      check(`${tag}: still 0 POSTs after Escape and Cancel`, posts === 0, `posts=${posts}`);

      await stop.click({ force: true });
      await yes.click();
      await page.waitForTimeout(500);
      check(`${tag}: Yes sends exactly 1 stop POST`, posts === 1, `posts=${posts}`);
    }

    check(`${vp}: 0 page errors`, errors.length === 0, errors.join("; "));
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.pass).length;
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
