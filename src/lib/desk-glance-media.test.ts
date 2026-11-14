import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlance, glanceDownloads, glanceMediaExtras, glanceNowPlaying } from "./desk-glance.ts";
import type { NowPlayingSnapshot } from "./types/nowplaying.ts";
import type { KioskDownloadsResult } from "./types/downloads.ts";
import type { AttentionReport } from "./attention-report.ts";

const keys = (o: object) => Object.keys(o).sort();
const report = (): AttentionReport => ({
  checkedAt: "2026-01-01T00:00:30.000Z",
  probes: [],
  hits: [],
  changes: { since: "x", status: "answered", events: [], loggedFrom: null },
});
const np = (over: object = {}) => ({ status: "ok", source: "ha", title: "The Lighthouse Keeper", state: "playing", ...over }) as unknown as NowPlayingSnapshot;
const item = (over: object = {}) => ({ hash: "abc123", name: "Field Recordings Vol 3", progress: 0.43, dlspeed: 2_100_000, size: 5_000_000, eta: 720, ...over });
const ok = (...items: object[]) => ({ status: "ok", items }) as unknown as KioskDownloadsResult;
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

test("nowPlaying keeps only the allowlist", () => {
  const out = glanceNowPlaying(
    np({ subtitle: "Harbour Lights", appName: "Jellyfin", progress01: 0.4, entityId: "media_player.lounge", entity_picture: "/x.png", sessionId: "s-1" }),
  )!;
  assert.deepEqual(keys(out), ["appName", "progress01", "state", "subtitle", "title"]);
  const text = JSON.stringify(buildGlance(report(), null, { weather: null, forecast: null, camera: false, nowPlaying: out }));
  for (const banned of ["source", "status", "entityId", "entity_picture", "sessionId", "media_player", "s-1"]) assert.equal(text.includes(banned), false, banned);
});

test("nowPlaying: an entity-id-shaped title is null; a title with a dot is kept; subtitle and app unchanged", () => {
  assert.equal(glanceNowPlaying(np({ title: "media_player.spare_room" })), null);
  assert.equal(glanceNowPlaying(np({ title: "  media_player.spare_room " })), null);
  for (const t of ["Vol. 2", "Mr. Nobody"]) assert.equal(glanceNowPlaying(np({ title: t }))!.title, t);
  const out = glanceNowPlaying(np({ subtitle: "Harbour Lights", appName: "Jellyfin" }))!;
  assert.deepEqual([out.subtitle, out.appName], ["Harbour Lights", "Jellyfin"]);
});

test("nowPlaying drops empty clauses; idle and an empty title give null", () => {
  assert.deepEqual(keys(glanceNowPlaying(np({ appName: "" }))!), ["state", "title"]);
  assert.equal(glanceNowPlaying({ status: "idle" }), null);
  assert.equal(glanceNowPlaying(np({ title: "" })), null);
});

test("nowPlaying caps strings and never splits a surrogate pair", () => {
  const out = glanceNowPlaying(np({ title: "t".repeat(100), subtitle: "s".repeat(100), appName: "a".repeat(30) }))!;
  assert.equal(out.title.length, 80);
  assert.ok(out.title.endsWith("…"));
  assert.equal(out.subtitle!.length, 80);
  assert.equal(out.appName!.length, 24);
  assert.ok(out.appName!.endsWith("…"));
  const pair = glanceNowPlaying(np({ title: "a".repeat(79) + "\u{1F3B5}" + "b" }))!;
  assert.equal(pair.title, "a".repeat(79) + "…");
  assert.doesNotMatch(pair.title, lone);
  assert.equal(glanceNowPlaying(np({ title: "a".repeat(80) }))!.title, "a".repeat(80));
});

test("control characters become one space; a blank title gives null; a control-only download name is dropped", () => {
  assert.equal(glanceNowPlaying(np({ title: "A\nB\tC" }))!.title, "A B C");
  assert.equal(glanceNowPlaying(np({ title: "x\r\n\u{2028}y", subtitle: "p\u0000q", appName: "j\u007fk" }))!.title, "x y");
  assert.equal(glanceNowPlaying(np({ subtitle: "p\u0000q", appName: "j\u007fk" }))!.subtitle, "p q");
  assert.equal(glanceNowPlaying(np({ title: " \n\t\u{2029} " })), null);
  const out = glanceDownloads(ok(item({ name: "\n\t\u0007" }), item({ name: "a\nb" }), item({ name: "c" })))!;
  assert.equal(out.count, 3);
  assert.deepEqual(out.items.map((i) => i.name), ["a b", "c"]);
  assert.equal(glanceNowPlaying(np({ title: "\n" + "t".repeat(100) }))!.title.length, 80); // the cap holds after cleaning
  const pair = glanceNowPlaying(np({ title: "\n" + "a".repeat(79) + "\u{1F3B5}" + "b" }))!;
  assert.equal(pair.title, "a".repeat(79) + "…");
  assert.doesNotMatch(pair.title, lone);
});

test("nowPlaying progress01 clamps and drops non-finite; an unknown state gives null", () => {
  assert.equal(glanceNowPlaying(np({ progress01: 1.3 }))!.progress01, 1);
  assert.equal(glanceNowPlaying(np({ progress01: -0.2 }))!.progress01, 0);
  for (const bad of [NaN, Infinity]) assert.equal("progress01" in glanceNowPlaying(np({ progress01: bad }))!, false);
  assert.equal(glanceNowPlaying(np({ state: "paused" }))!.state, "paused");
  assert.equal(glanceNowPlaying(np({ state: "buffering" })), null);
});

test("downloads is null when unconfigured or unreachable; ok and empty is count 0", () => {
  assert.equal(glanceDownloads({ status: "unconfigured" }), null);
  assert.equal(glanceDownloads({ status: "unreachable" }), null);
  assert.deepEqual(glanceDownloads(ok()), { count: 0, items: [] });
});

test("downloads counts all and lists 3 in source order", () => {
  const out = glanceDownloads(ok(...["a", "b", "c", "d", "e"].map((name) => item({ name }))))!;
  assert.equal(out.count, 5);
  assert.deepEqual(out.items.map((i) => i.name), ["a", "b", "c"]);
});

test("download items keep only the allowlist and cap the name", () => {
  const out = glanceDownloads(ok(item({ savePath: "/mnt/x", name: "n".repeat(70) })))!;
  assert.deepEqual(keys(out), ["count", "items"]);
  assert.deepEqual(keys(out.items[0]), ["etaS", "name", "progress", "speedBps"]);
  assert.equal(out.items[0].name.length, 60);
  assert.ok(out.items[0].name.endsWith("…"));
  const text = JSON.stringify(out);
  for (const banned of ["hash", "abc123", "size", "savePath", "/mnt/x"]) assert.equal(text.includes(banned), false, banned);
});

test("download numbers clamp", () => {
  const one = (over: object) => glanceDownloads(ok(item(over)))!.items[0];
  assert.equal(one({ progress: 1.2 }).progress, 1);
  assert.equal(one({ progress: -1 }).progress, 0);
  assert.equal(one({ progress: NaN }).progress, 0);
  assert.equal(one({ dlspeed: -5 }).speedBps, 0);
  assert.equal(one({ dlspeed: NaN }).speedBps, 0);
  assert.equal(one({ eta: -3 }).etaS, null);
  assert.equal(one({ eta: NaN }).etaS, null);
  assert.equal(one({ eta: 12.6 }).etaS, 13);
  assert.equal(one({ eta: null }).etaS, null);
});

test("glanceMediaExtras: a never-resolving source is null inside the budget and the other is kept", { timeout: 5000 }, async () => {
  const never = () => new Promise<never>(() => {});
  const good = async () => np();
  const dl = async () => ok(item());
  const t0 = Date.now();
  const a = await glanceMediaExtras(never, dl, 50);
  assert.equal(a.nowPlaying, null);
  assert.equal(a.downloads!.count, 1);
  assert.ok(Date.now() - t0 < 1000);
  const b = await glanceMediaExtras(good, never, 50);
  assert.equal(b.nowPlaying!.title, "The Lighthouse Keeper");
  assert.equal(b.downloads, null);
  const rej = () => Promise.reject(new Error("x"));
  assert.deepEqual(await glanceMediaExtras(rej, rej, 50), { nowPlaying: null, downloads: null });
});

test("glanceMediaExtras: a mapper throw or a synchronous throw gives null for that source only", { timeout: 5000 }, async () => {
  const badDl = async () => ({ status: "ok", items: null }) as unknown as KioskDownloadsResult;
  const sync = (): Promise<NowPlayingSnapshot> => {
    throw new Error("boom");
  };
  const r = await glanceMediaExtras(sync, badDl, 50);
  assert.deepEqual(r, { nowPlaying: null, downloads: null });
  const syncDl = (): Promise<KioskDownloadsResult> => {
    throw new Error("boom");
  };
  const r2 = await glanceMediaExtras(async () => np(), syncDl, 50);
  assert.equal(r2.nowPlaying!.state, "playing");
  assert.equal(r2.downloads, null);
});

test("buildGlance passes media through and defaults to null", () => {
  const nowPlaying = { title: "T", state: "paused" as const };
  const downloads = { count: 0, items: [] };
  const g = buildGlance(report(), null, { weather: null, forecast: null, camera: false, nowPlaying, downloads });
  assert.deepEqual(g.nowPlaying, nowPlaying);
  assert.deepEqual(g.downloads, downloads);
  const d = buildGlance(report(), null);
  assert.equal(d.nowPlaying, null);
  assert.equal(d.downloads, null);
  const partial = buildGlance(report(), null, { weather: null, forecast: null, camera: false });
  assert.equal(partial.nowPlaying, null);
  assert.equal(partial.downloads, null);
});
