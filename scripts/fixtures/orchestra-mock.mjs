#!/usr/bin/env node
/* Synthetic stand-in for the orchestra service, for the test stack and for orchestra-shots.mjs.
 * Zero dependencies. The bearer token picks the scenario:
 *
 *   mock-mixed   four orchestrators, one of each run state (default for captures)
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

const SUMMARIES = [
  {
    name: "dev", title: "Development lane: builds, reviews and ships the day-to-day work today.", state: "running",
    lastActivityAt: at(2), model: "claude-opus-5-5", home: "C:/orchestrators/dev", inFlightCount: 2, stalledCount: 0, watcher: "online",
  },
  {
    name: "design", title: "Design briefs", state: "stopped", lastActivityAt: at(60 * 30), model: "claude-opus-5-5",
    home: "C:/orchestrators/design", inFlightCount: 0, stalledCount: 0, watcher: "offline",
  },
  {
    name: "odip", title: "ODIP delivery", state: "stalled", lastActivityAt: at(26), model: "claude-sonnet-5-5",
    home: "C:/orchestrators/odip", inFlightCount: 3, stalledCount: 1, watcher: "busy",
  },
  {
    name: "night-watch-orchestr", title: null, state: "unknown", lastActivityAt: null, model: null,
    home: "C:/orchestrators/" + "x".repeat(43), inFlightCount: 0, stalledCount: 0, watcher: null,
  },
];

const CHECKPOINT = ("Plan approved; build in flight on the settings card. " + "Waiting on the fixer round. ".repeat(12)).slice(0, 300);

const DETAILS = {
  dev: {
    addDirs: ["C:/projects/personal/example-app"], plugins: ["ponytail", "impeccable"],
    checkpoint: "Reviewing the open PR; merge once CI is green.",
    sessionId: "3f2a9c1e-7b4d-4e8a-9c05-1d6f8a2b7e43",
    inFlight: [{ name: "dev-builder", where: "C:/t/a.jsonl", quietMin: 3 }, { name: "dev-reviewer", where: "C:/t/b.jsonl", quietMin: 12 }],
  },
  design: { addDirs: [], plugins: [], checkpoint: null, inFlight: [] },
  odip: {
    addDirs: ["C:/projects/personal/example-app", "C:/projects/personal/example-tools"], plugins: ["ponytail"], checkpoint: CHECKPOINT,
    inFlight: [
      { name: "odip-builder", where: "C:/t/c.jsonl", quietMin: 25 },
      { name: "odip-fixer", where: "C:/t/d.jsonl", quietMin: 3 },
      { name: "odip-review", where: "C:/t/e.jsonl", quietMin: null },
    ],
  },
};

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** slowMs overrides mock-slow's delay (tests pass a few ms). */
export function createMock({ slowMs = 4000 } = {}) {
  return createServer((req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (token !== "mock-mixed" && token !== "mock-empty" && token !== "mock-slow") return send(res, 401, { error: "unauthorized" });
    const reply = () => {
      const path = new URL(req.url ?? "/", "http://mock").pathname;
      if (path === "/v1/orchestrators") return send(res, 200, { orchestrators: token === "mock-empty" ? [] : SUMMARIES });
      const name = /^\/v1\/orchestrators\/([^/]+)$/.exec(path)?.[1];
      const summary = token === "mock-empty" ? undefined : SUMMARIES.find((s) => s.name === name);
      if (!summary || !DETAILS[name]) return send(res, 404, { error: "not found" });
      return send(res, 200, { ...summary, ...DETAILS[name] });
    };
    if (token === "mock-slow") setTimeout(reply, slowMs);
    else reply();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 7420);
  createMock().listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(`orchestra mock on :${port}`));
}
