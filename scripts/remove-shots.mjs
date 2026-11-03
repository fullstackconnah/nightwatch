#!/usr/bin/env node
/* Captures the container detail page's Remove flow with every API call mocked,
 * so nothing is ever removed: idle, confirm and failed (a mocked 409), at 1440
 * and 390. Checks: at 390 every visible button and link is at least 44x44, the
 * idle Remove isn't danger-coloured, and the page throws no errors.
 *
 *   BASE_URL=http://host:3006 OUT_DIR=shots node scripts/remove-shots.mjs
 *
 * Needs Playwright, which is not a dependency of this repo; run it where one is installed.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3006").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? "shots";
const ID = "ab12cd34ef56" + "0".repeat(52);
const NAME = "demo-exited";

const INSPECT = {
  id: ID, name: NAME, image: "nginx:1.27", created: "2026-10-01T00:00:00Z",
  state: { status: "exited", running: false, startedAt: "2026-10-01T00:00:00Z", exitCode: 0, health: null, restartCount: 0, oomKilled: false },
  restartPolicy: "no", networkMode: "bridge", composeProject: null, composeService: null,
  ports: [], mounts: [], env: [], cmd: "nginx -g 'daemon off;'",
};
const LIST = {
  containers: [{ id: ID, name: NAME, image: "nginx:1.27", state: "exited", status: "Exited (0) 2 days ago", ports: [], composeProject: null, composeService: null, tile: { url: null } }],
  groups: [], counts: { total: 1, running: 0, paused: 0, stopped: 1, restarting: 0, unhealthy: 0 },
};

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
  for (const { name, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // The test stack is a dev build, which accepts any non-empty password.
    const login = await context.request.post(`${BASE_URL}/api/auth/login`, { data: { password: "x" } });
    if (!login.ok()) throw new Error(`login failed: HTTP ${login.status()}`);

    // Everything under /api/docker/containers is mocked; DELETE is always the 409.
    await page.route("**/api/docker/containers**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (route.request().method() === "DELETE") return json(route, 409, { error: `${NAME} is running again, so it wasn't removed. Stop it in Resources first.` });
      if (pathname.endsWith("/api/docker/containers")) return json(route, 200, LIST);
      if (pathname.endsWith(`/containers/${ID}`)) return json(route, 200, INSPECT);
      if (pathname.endsWith("/logs")) return json(route, 200, { logs: "" });
      return json(route, 200, {});
    });

    await page.goto(`${BASE_URL}/containers/${ID}`, { waitUntil: "domcontentloaded" });
    const remove = page.getByRole("button", { name: "Remove", exact: true });
    await remove.waitFor({ timeout: 30_000 });

    const shot = (state) => page.screenshot({ path: join(OUT_DIR, `remove-${state}-${name}.png`) });
    const touchTargets = async (state) => {
      if (name !== "390") return;
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, a[href]")]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0)
          .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
          .map(({ el, r }) => `${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      check(`390 ${state}: every button and link >= 44x44`, small.length === 0, small.join("; "));
    };

    await remove.scrollIntoViewIfNeeded();
    const colours = await remove.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-bad)";
      document.body.appendChild(probe);
      const bad = getComputedStyle(probe).color;
      probe.remove();
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor, bad };
    });
    check(`${name} idle: Remove has no danger colour`, colours.color !== colours.bad && colours.background !== colours.bad, JSON.stringify(colours));
    await shot("idle");
    await touchTargets("idle");

    await remove.click();
    await page.getByRole("button", { name: "Yes, remove" }).waitFor();
    await shot("confirm");
    await touchTargets("confirm");

    await page.getByRole("button", { name: "Yes, remove" }).click();
    await page.getByRole("alert").getByText("is running again").waitFor();
    await shot("failed");
    await touchTargets("failed");

    check(`${name}: 0 page errors`, errors.length === 0, errors.join("; "));
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
