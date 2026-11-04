#!/usr/bin/env node
/* Synthetic stand-in for the orchestra service, for the test stack and for orchestra-shots.mjs.
 * Zero dependencies. The bearer token picks the scenario:
 *
 *   mock-mixed   four orchestrators, one of each run state (default for captures)
 *   mock-stuck   one agent waiting 7 m, one stalled at 24 m, one quiet at 19 m, a 26-character agent name, and five agents in the dev lane (so Show 2 more appears)
 *   mock-busy    one lane with six agents in flight (the Show more slot)
 *   mock-empty   ok, no orchestrators registered
 *   mock-slow    mixed, after a 4 s delay (under the proxy's 5 s timeout)
 *   anything else -> 401
 *
 *   PORT=7420 HOST=0.0.0.0 node scripts/fixtures/orchestra-mock.mjs
 *
 * Synthetic data only. Routes: GET /v1/orchestrators and GET /v1/orchestrators/:name (404 for an unknown name).
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();

const ag = (name, quietMin, waiting = null) => ({ name, quietMin, waiting });
const lane = (name, title, state, activeMin, model, inFlight, stalledCount = 0, watcher = "online") => ({
  name, title, state, lastActivityAt: activeMin === null ? null : at(activeMin), model, home: `C:/orchestrators/${name}`,
  inFlightCount: inFlight.length, stalledCount, watcher, inFlight,
});

const SUMMARIES = [
  lane("dev", "Development lane: builds, reviews and ships the day-to-day work today.", "running", 2, "claude-opus-5-5", [ag("dev-builder", 3), ag("dev-reviewer", 12)]),
  lane("design", "Design briefs", "stopped", 60 * 30, "claude-opus-5-5", [], 0, "offline"),
  lane("odip", "ODIP delivery", "stalled", 26, "claude-sonnet-5-5", [ag("odip-builder", 25), ag("odip-fixer", 3), ag("odip-review", null)], 1, "busy"),
  { ...lane("night-watch-orchestr", null, "unknown", null, null, [], 0, null), home: "C:/orchestrators/" + "x".repeat(43) },
];

const STUCK = [
  lane("dev", "Development lane", "stalled", 24, "claude-opus-5-5", [ag("dev-reviewer", 24), ag("dev-builder", 19), ag("dev-long-agent-name-here-x", 5), ag("dev-fixer", 4), ag("dev-lookup", 2)], 1),
  lane("design", "Design briefs", "running", 2, "claude-opus-5-5", [ag("design-shape", 2, { tool: "Bash", sinceMin: 7 })]),
  lane("odip", "ODIP delivery", "running", 3, "claude-sonnet-5-5", [ag("odip-builder", 3)]),
  lane("ops", "Operations", "stopped", 60 * 5, "claude-sonnet-5-5", [], 0, "offline"),
];

const BUSY = [
  lane("dev", "Development lane", "running", 1, "claude-opus-5-5", ["a", "b", "c", "d", "e", "f"].map((s, i) => ag(`dev-agent-${s}`, i + 1))),
  lane("odip", "ODIP delivery", "running", 3, "claude-sonnet-5-5", [ag("odip-builder", 3)]),
  lane("design", "Design briefs", "stopped", 60 * 30, "claude-opus-5-5", [], 0, "offline"),
];

const SCENARIOS = { "mock-mixed": SUMMARIES, "mock-slow": SUMMARIES, "mock-stuck": STUCK, "mock-busy": BUSY, "mock-empty": [] };

const CHECKPOINT = ("Plan approved; build in flight on the settings card. " + "Waiting on the fixer round. ".repeat(12)).slice(0, 300);

const DETAILS = {
  dev: {
    addDirs: ["C:/projects/personal/example-app"], plugins: ["ponytail", "impeccable"],
    checkpoint: "Reviewing the open PR; merge once CI is green.",
    sessionId: "3f2a9c1e-7b4d-4e8a-9c05-1d6f8a2b7e43",
  },
  design: { addDirs: [], plugins: [], checkpoint: null },
  odip: {
    addDirs: ["C:/projects/personal/example-app", "C:/projects/personal/example-tools"], plugins: ["ponytail"], checkpoint: CHECKPOINT,
  },
};
const PLAIN = { addDirs: [], plugins: [], checkpoint: "Working through the open PRs." };

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** slowMs overrides mock-slow's delay (tests pass a few ms). */
export function createMock({ slowMs = 4000 } = {}) {
  return createServer((req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const lanes = token && Object.hasOwn(SCENARIOS, token) ? SCENARIOS[token] : null;
    if (!lanes) return send(res, 401, { error: "unauthorized" });
    const reply = () => {
      const path = new URL(req.url ?? "/", "http://mock").pathname;
      if (path === "/v1/orchestrators") return send(res, 200, { orchestrators: lanes });
      const name = /^\/v1\/orchestrators\/([^/]+)$/.exec(path)?.[1];
      const summary = lanes.find((s) => s.name === name);
      // The unknown lane has no detail (404), as before; the detail's agents carry a path, which the proxy must drop.
      if (!summary || summary.state === "unknown") return send(res, 404, { error: "not found" });
      const inFlight = summary.inFlight.map((a, i) => ({ ...a, where: `C:/t/${i}.jsonl` }));
      return send(res, 200, { ...summary, ...(token === "mock-mixed" || token === "mock-slow" ? DETAILS[name] : PLAIN), inFlight });
    };
    if (token === "mock-slow") setTimeout(reply, slowMs);
    else reply();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 7420);
  createMock().listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(`orchestra mock on :${port}`));
}
