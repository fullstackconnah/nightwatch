import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChores,
  choreOrder,
  findKind,
  fold,
  foldGroups,
  heldMembers,
  heroBytes,
  heroLine,
  pillText,
  slotItem,
  unusedTaggedBytes,
  type ChoreInput,
  type Sources,
} from "./docker-chores.ts";

const GiB = 1024 ** 3;
const img = (id: string, size: number, o: Record<string, unknown> = {}) => ({
  id, tags: ["a:1"], size, created: 1, inUse: false, usedBy: [], stack: null, ...o,
});
const ctr = (id: string, state: string, o: Record<string, unknown> = {}) => ({
  id, name: id, state, composeProject: null, created: 1, ...o,
});
const input = (o: Partial<ChoreInput> = {}): ChoreInput => ({
  reclaim: {
    images: { dangling: [], danglingBytes: 0 },
    volumes: { orphans: [], orphanBytes: 0 },
    buildCacheBytes: null,
    totals: { reclaimableBytes: 0 },
  },
  images: [],
  containers: [],
  volumes: [],
  ...o,
});
const withPrunes = (dBytes: number, dN: number, oBytes: number | null, oN: number) =>
  input({
    reclaim: {
      images: { dangling: Array.from({ length: dN }, (_, i) => ({ id: `d${i}` })), danglingBytes: dBytes },
      volumes: {
        orphans: Array.from({ length: oN }, (_, i) => ({ name: `v${i}`, size: oBytes == null ? null : oBytes / Math.max(oN, 1) })),
        orphanBytes: oBytes ?? 0,
      },
      buildCacheBytes: 5 * GiB,
      totals: { reclaimableBytes: dBytes + (oBytes ?? 0) },
    },
    images: [img("u1", 3 * GiB), img("u2", GiB, { inUse: true }), img("d0", 9, { tags: [] })],
    containers: [ctr("s1", "exited"), ctr("r1", "running")],
  });

test("C2: tier 0 is the prunes with a count, biggest bytes first; cache is always last", () => {
  const order = choreOrder(buildChores(withPrunes(2 * GiB, 3, 8 * GiB, 2))).map((c) => c.id);
  assert.deepEqual(order, ["orphans", "dangling", "unused", "stopped", "cache"]);
});

test("C2: one prune at zero drops to tier 2, after the review chores", () => {
  const order = choreOrder(buildChores(withPrunes(2 * GiB, 3, 0, 0))).map((c) => c.id);
  assert.deepEqual(order, ["dangling", "unused", "stopped", "orphans", "cache"]);
});

test("C2: null orphan sizes sort last inside tier 0", () => {
  const order = choreOrder(buildChores(withPrunes(GiB, 1, null, 4))).map((c) => c.id);
  assert.deepEqual(order.slice(0, 2), ["dangling", "orphans"]);
});

test("C2: all empty keeps the fixed order with cache last; a prune leads whenever prunable > 0", () => {
  const empty = choreOrder(buildChores(input())).map((c) => c.id);
  assert.deepEqual(empty, ["dangling", "orphans", "unused", "stopped", "cache"]);
  for (const [d, o] of [[1, 0], [0, 1], [5 * GiB, 5 * GiB]]) {
    const first = choreOrder(buildChores(withPrunes(d, d ? 1 : 0, o, o ? 1 : 0)))[0];
    assert.equal(first.kind, "prune");
  }
});

test("stopped chore lists created, exited and dead, never running, restarting or paused", () => {
  const c = buildChores(input({ containers: ["created", "exited", "dead", "running", "restarting", "paused"].map((s) => ctr(s, s)) }));
  assert.deepEqual(c.find((x) => x.id === "stopped")!.memberIds, ["created", "exited", "dead"]);
});

test("unused tagged bytes skip dangling and in-use images (no double count)", () => {
  assert.equal(unusedTaggedBytes([img("a", 5), img("b", 7, { inUse: true }), img("c", 11, { tags: [] })]), 5);
});

test("hero: dangling plus orphans, plus sign while orphan sizes are pending", () => {
  assert.deepEqual(heroBytes(withPrunes(GiB, 1, 2 * GiB, 1).reclaim, false), { bytes: 3 * GiB, plus: false });
  assert.equal(heroBytes(withPrunes(GiB, 1, null, 1).reclaim, true).plus, true);
});

const ok = { error: null, loaded: true };
const sources = (o: Partial<Sources> = {}): Sources => ({
  containers: ok, images: ok, volumes: ok, disk: ok, sizesPending: false, buildCacheBytes: 5 * GiB, staleMs: null, agoText: "2 min ago", ...o,
});

test("C12: hero copy per state; a df failure never reads Nothing", () => {
  assert.equal(heroLine({ loading: true, diskError: false, bytes: 0, plus: false }).lead, "Reading Docker…");
  assert.equal(heroLine({ loading: false, diskError: true, bytes: 0, plus: false }).lead, "Can't size the clean-up right now");
  assert.equal(heroLine({ loading: false, diskError: false, bytes: 0, plus: false }).lead, "Nothing can go right now");
  const full = heroLine({ loading: false, diskError: false, bytes: 41.4 * GiB, plus: false });
  assert.deepEqual([full.lead, full.label], ["41.4 GiB", "can go now"]);
  assert.equal(heroLine({ loading: false, diskError: false, bytes: GiB, plus: true }).lead, "1.0 GiB+");
});

test("C12: slot priority error, stale, sizes, cache, with exact copy", () => {
  const down = { error: "ECONNREFUSED", loaded: true };
  const s = slotItem(sources({ containers: down, images: down, volumes: down, staleMs: 120_000, sizesPending: true }));
  assert.equal(s.kind, "error");
  assert.equal(s.text, "Docker unreachable: ECONNREFUSED. Showing the last list from 2 min ago; nothing here can change until it is back.");
  assert.equal(slotItem(sources({ disk: { error: "HTTP 502", loaded: true } })).kind, "error");
  const stale = slotItem(sources({ staleMs: 3 * 60_000, sizesPending: true }));
  assert.equal(stale.kind, "stale");
  assert.equal(stale.text, "Last update 3 min ago. The list may be out of date; actions still check live before they run.");
  assert.equal(slotItem(sources({ sizesPending: true })).text, "Sizes still arriving (Docker takes up to a minute)");
  const cache = slotItem(sources());
  assert.equal(cache.kind, "cache");
  assert.equal(cache.text, "Build cache 5.0 GiB can't be cleared from here: the socket proxy doesn't allow it (BUILD=0).");
});

test("C12: each source failing alone only trips the slot for disk", () => {
  const bad = { error: "boom", loaded: true };
  for (const k of ["containers", "images", "volumes"] as const) assert.notEqual(slotItem(sources({ [k]: bad })).kind, "error");
  assert.equal(slotItem(sources({ disk: bad })).kind, "error");
});

test("C4: held members keep ids constant over 6 ticks; pill text is exact", () => {
  const snap = ["a", "b", "c"];
  const ticks = [["a", "b", "c"], ["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "c", "d"], ["a", "c", "d", "e"], ["c", "d", "e", "f"]];
  for (const live of ticks) assert.deepEqual(heldMembers(snap, live).rows, snap);
  const t1 = heldMembers(snap, ticks[1]);
  assert.deepEqual([t1.newIds, t1.goneIds], [["d"], []]);
  assert.equal(pillText(1, 0), "1 new · show");
  assert.equal(pillText(0, 1), "Update list");
  assert.equal(pillText(2, 1), "2 new · show");
  assert.equal(pillText(0, 0), "");
  const t3 = heldMembers(snap, ticks[3]);
  assert.deepEqual([t3.newIds, t3.goneIds], [["d"], ["b"]]);
});

test("C4: a null snapshot takes everything live (first paint)", () => {
  assert.deepEqual(heldMembers(null, ["x", "y"]).rows, ["x", "y"]);
});

test("fold: 12 visible then the rest; prefix groups at 8 or more matches", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `i${i}`);
  assert.deepEqual([fold(ids, false).shown.length, fold(ids, false).hidden], [12, 3]);
  assert.deepEqual([fold(ids, true).shown.length, fold(ids, true).hidden], [15, 0]);
  const items = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `odiptest-run${i}` })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, name: `other-${i}` })),
    { id: "solo", name: "plain" },
  ];
  const g = foldGroups(items);
  assert.deepEqual(g.groups.map((x) => [x.prefix, x.ids.length]), [["odiptest", 8]]);
  assert.equal(g.rest.length, 8);
});

test("findKind parses the ?find= value", () => {
  assert.equal(findKind("images"), "images");
  assert.equal(findKind("volumes"), "volumes");
  assert.equal(findKind("nope"), "containers");
  assert.equal(findKind(null), "containers");
});
