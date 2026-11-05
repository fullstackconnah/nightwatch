import test from "node:test";
import assert from "node:assert/strict";
import { mergeDashPut } from "./dash-put.ts";
import type { AppConfig } from "../config.ts";

const current = {
  groups: [{ name: "Media", containers: ["jellyfin"] }],
  urls: { jellyfin: "http://homelab.local:8096" },
  icons: { jellyfin: "jellyfin" },
  hidden: ["old"],
  widgets: [{ id: "w1", container: "jellyfin", type: "generic", url: "http://homelab.local:8096" }],
  hermes: { tier: "local", model: "m" },
} as unknown as AppConfig;

const ok = (r: ReturnType<typeof mergeDashPut>) => {
  assert.ok("next" in r, "expected a merge");
  return r.next;
};

test("K12: a widget save leaves the tile fields and other blocks byte-identical", () => {
  const next = ok(mergeDashPut(current, { widgets: [] }));
  for (const k of ["groups", "urls", "icons", "hidden", "hermes"] as const) {
    assert.equal(JSON.stringify(next[k]), JSON.stringify(current[k]), k);
  }
  assert.deepEqual(next.widgets, []);
});

test("K12: a tile save leaves the widgets and other blocks identical", () => {
  const next = ok(mergeDashPut(current, { groups: [], urls: {}, icons: {}, hidden: [] }));
  assert.equal(JSON.stringify(next.widgets), JSON.stringify(current.widgets));
  assert.equal(JSON.stringify(next.hermes), JSON.stringify(current.hermes));
  assert.deepEqual(next.groups, []);
});

test("K12: an empty, non-object or wrongly typed body is refused and merges nothing", () => {
  for (const body of [{}, null, [], "x", 3, { widgets: "no" }, { groups: {} }, { urls: [] }, { hidden: "a" }, { icons: null }]) {
    const r = mergeDashPut(current, body);
    assert.ok("error" in r, JSON.stringify(body));
  }
});
