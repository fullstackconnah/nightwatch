import test from "node:test";
import assert from "node:assert/strict";
import { mergeDashPut, publicWidgets } from "./dash-put.ts";
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

test("K12: only the five dashboard fields are merged; hermes, system and extra keys in the body are ignored", () => {
  const body = JSON.parse('{ "widgets": [], "hermes": null, "system": {}, "extra": 1, "__proto__": { "polluted": 1 } }');
  const withSystem = { ...current, system: { adminHash: "h" } } as unknown as AppConfig;
  const next = ok(mergeDashPut(withSystem, body)) as unknown as Record<string, unknown>;
  assert.deepEqual(next.hermes, current.hermes);
  assert.deepEqual(next.system, { adminHash: "h" });
  assert.equal("extra" in next, false);
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal((next as { polluted?: unknown }).polluted, undefined);
});

const withSecrets = {
  ...current,
  widgets: [
    { id: "w1", container: "a", type: "generic", url: "u", key: "wsecret-123", password: "wsecret-pw" },
    { id: "w2", container: "b", type: "generic", url: "u", key: "wsecret-456" },
  ],
} as unknown as AppConfig;

test("O1: no sanitized widget, nor the sanitized merge result, contains a secret", () => {
  const pub = publicWidgets(withSecrets.widgets);
  assert.ok(!JSON.stringify(pub).includes("wsecret"));
  assert.deepEqual(pub.map((w) => [w.keySet, w.passwordSet]), [[true, true], [true, false]]);
  const next = ok(mergeDashPut(withSecrets, { widgets: [{ ...pub[0], key: "wsecret-new" }, pub[1]] }));
  assert.ok(!JSON.stringify({ config: { ...next, widgets: publicWidgets(next.widgets) } }).includes("wsecret"));
});

test("O1: an omitted or empty key keeps the stored one; a new one replaces; clear removes", () => {
  const pub = publicWidgets(withSecrets.widgets);
  const kept = ok(mergeDashPut(withSecrets, { widgets: [{ ...pub[0], key: "" }, pub[1]] }));
  assert.equal(kept.widgets[0].key, "wsecret-123");
  assert.equal(kept.widgets[0].password, "wsecret-pw");
  assert.equal(kept.widgets[1].key, "wsecret-456");
  const replaced = ok(mergeDashPut(withSecrets, { widgets: [{ ...pub[0], key: "new" }, pub[1]] }));
  assert.equal(replaced.widgets[0].key, "new");
  const cleared = ok(mergeDashPut(withSecrets, { widgets: [{ ...pub[0], clearKey: true, clearPassword: true }, pub[1]] }));
  assert.equal(cleared.widgets[0].key, undefined);
  assert.equal(cleared.widgets[0].password, undefined);
  assert.equal(cleared.widgets[1].key, "wsecret-456");
});

test("O1: secrets follow the widget id when widgets are re-ordered or added; wire flags are not stored", () => {
  const pub = publicWidgets(withSecrets.widgets);
  const fresh = { id: "w3", container: "c", type: "generic", url: "u" };
  const next = ok(mergeDashPut(withSecrets, { widgets: [pub[1], fresh, pub[0]] }));
  assert.deepEqual(next.widgets.map((w) => [w.id, w.key]), [["w2", "wsecret-456"], ["w3", undefined], ["w1", "wsecret-123"]]);
  assert.ok(!JSON.stringify(next.widgets).includes("keySet"));
});
