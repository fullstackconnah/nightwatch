import test from "node:test";
import assert from "node:assert/strict";
import { mergeDashPut, publicWidgets } from "./dash-put.ts";
import { widgetTarget } from "../widgets/target.ts";
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

const sec = (id: string | undefined, over: Record<string, unknown> = {}) =>
  ({ id, container: "a", type: "sonarr", url: "http://host-a:8989/x", ...over });
const store = (...w: unknown[]) => ({ ...current, widgets: w }) as unknown as AppConfig;

test("O1 polish: a duplicate or missing widget id inherits no stored secret", () => {
  const cfg = store({ ...sec("w1"), key: "k1" }, { ...sec("w2"), key: "k2" });
  const dup = ok(mergeDashPut(cfg, { widgets: [sec("w1"), sec("w1")] }));
  assert.deepEqual(dup.widgets.map((w) => w.key), [undefined, undefined]);
  const none = ok(mergeDashPut(cfg, { widgets: [sec(undefined), sec("")] }));
  assert.deepEqual(none.widgets.map((w) => w.key), [undefined, undefined]);
});

test("O1 polish: a secret does not follow the widget to a new origin or type", () => {
  const cfg = store({ ...sec("w1"), key: "k1", password: "p1" });
  const run = (over: Record<string, unknown>) => ok(mergeDashPut(cfg, { widgets: [sec("w1", over)] })).widgets[0];
  assert.equal(run({ url: "http://host-b:8989/x" }).key, undefined);
  assert.equal(run({ url: "http://host-a:9999/x" }).password, undefined);
  assert.equal(run({ type: "radarr" }).key, undefined);
  assert.equal(run({ url: "http://host-a:8989/other" }).key, "k1");
  assert.equal(run({ url: "http://host-a:8989/other" }).password, "p1");
  assert.equal(run({ url: "http://host-b:8989/x", key: "new" }).key, "new");
});

const hdr = (over: Record<string, unknown> = {}) => sec("w1", { type: "generic", headers: { Authorization: "Bearer x", "X-A": "keep" }, ...over });
const hdrs = (cfgW: unknown, incoming: unknown) => (ok(mergeDashPut(store(cfgW), { widgets: [incoming] })).widgets[0] as { headers?: Record<string, string> }).headers;

test("J1: GET shape keeps header names, blanks every value and sets headersSet", () => {
  const [a, b] = publicWidgets([hdr({ headers: { Authorization: "Bearer x", "X-A": "" } }), sec("w2")] as never) as unknown as Record<string, unknown>[];
  assert.deepEqual(a.headers, { Authorization: "", "X-A": "" });
  assert.equal(a.headersSet, true);
  assert.equal(b.headersSet, false);
  assert.equal("headers" in b, false);
  assert.equal(publicWidgets([hdr({ headers: { "X-A": "" } })] as never)[0].headersSet, false);
  assert.ok(!JSON.stringify(publicWidgets([hdr()] as never)).includes("Bearer x"));
});

test("J1: the public widget sent back unchanged keeps the stored headers", () => {
  const stored = hdr();
  assert.deepEqual(hdrs(stored, publicWidgets([stored] as never)[0]), { Authorization: "Bearer x", "X-A": "keep" });
});

test("J1: a value replaces, an empty value keeps, a new name is added", () => {
  assert.deepEqual(hdrs(hdr(), hdr({ headers: { Authorization: "Bearer y", "X-A": "", "X-B": "b", "X-C": "" } })),
    { Authorization: "Bearer y", "X-A": "keep", "X-B": "b" });
});

test("J1: a headers object from an API client sets the full list", () => {
  assert.deepEqual(hdrs(hdr(), hdr({ headers: { "X-B": "b" } })), { "X-B": "b" });
});

test("J1: headers missing on the incoming widget keeps the stored ones", () => {
  const { headers: _h, ...bare } = hdr() as Record<string, unknown>;
  assert.deepEqual(hdrs(hdr(), bare), { Authorization: "Bearer x", "X-A": "keep" });
  assert.equal(hdrs(sec("w1", { type: "generic" }), bare), undefined);
});

test("J1: a changed origin, type or duplicate id copies no stored header value", () => {
  const blank = { Authorization: "", "X-A": "" };
  assert.equal(hdrs(hdr(), hdr({ url: "http://host-b:8989/x", headers: blank })), undefined);
  assert.equal(hdrs(hdr(), hdr({ type: "radarr", headers: blank })), undefined);
  const dup = ok(mergeDashPut(store(hdr()), { widgets: [hdr({ headers: blank }), hdr({ headers: blank })] })).widgets as { headers?: unknown }[];
  assert.equal(dup[0].headers, undefined);
  assert.deepEqual(hdrs(hdr(), hdr({ url: "http://host-b:8989/x", headers: { Authorization: "new" } })), { Authorization: "new" });
});

test("J1: a result with no headers stores no headers field", () => {
  const r = ok(mergeDashPut(store(hdr()), { widgets: [hdr({ headers: {} })] })).widgets[0] as object;
  assert.equal("headers" in r, false);
});

test("J1 round 1: a changed endpoint (absolute or relative) keeps no stored secret", () => {
  const stored = hdr({ key: "k-placeholder", url: "http://host-a:8989" });
  for (const endpoint of ["http://evil.example/x", "@evil.example/x"]) {
    const w = ok(mergeDashPut(store(stored), { widgets: [hdr({ endpoint, url: "http://host-a:8989", headers: { Authorization: "" } })] })).widgets[0] as { headers?: unknown; key?: string };
    assert.equal(w.headers, undefined, endpoint);
    assert.equal(w.key, undefined, endpoint);
  }
});

test("J1 round 1: an unchanged endpoint keeps the stored secrets", () => {
  for (const endpoint of [undefined, "/api/x"]) {
    const stored = hdr({ key: "k-placeholder", endpoint });
    const w = ok(mergeDashPut(store(stored), { widgets: [hdr({ endpoint, headers: { Authorization: "" } })] })).widgets[0] as { headers?: Record<string, string>; key?: string };
    assert.equal(w.headers?.Authorization, "Bearer x");
    assert.equal(w.key, "k-placeholder");
  }
});

test("J1 round 1: inherited property names copy nothing", () => {
  assert.equal(hdrs(hdr(), hdr({ headers: { constructor: "", toString: "" } })), undefined);
});

test("widgetTarget: absolute endpoint, relative endpoint, none", () => {
  assert.equal(widgetTarget({ url: "http://h", endpoint: "http://e/x" }), "http://e/x");
  assert.equal(widgetTarget({ url: "http://h", endpoint: "/x" }), "http://h/x");
  assert.equal(widgetTarget({ url: "http://h" }), "http://h");
});
