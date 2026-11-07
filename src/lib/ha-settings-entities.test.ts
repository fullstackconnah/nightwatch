import test from "node:test";
import assert from "node:assert/strict";
import { hiddenIdsFromRegistry, withoutSettingsEntities, readHiddenFailOpen } from "./ha-settings-entities.ts";

test("registry: config and diagnostic are hidden; null, other and malformed are not", () => {
  const ids = hiddenIdsFromRegistry([
    { entity_id: "switch.a_email", entity_category: "config" },
    { entity_id: "sensor.b_rssi", entity_category: "diagnostic" },
    { entity_id: "switch.c", entity_category: null },
    { entity_id: "switch.d", entity_category: "other" },
    { entity_id: "switch.e" },
    { entity_category: "config" },
    null,
    "junk",
  ]);
  assert.deepEqual([...ids].sort(), ["sensor.b_rssi", "switch.a_email"]);
});
test("registry: a non-array payload gives an empty set", () => {
  assert.equal(hiddenIdsFromRegistry({}).size, 0);
});

const e = (entityId: string) => ({ entityId });
test("filter: only switches and lights are filtered", () => {
  const ent = {
    lights: [e("light.x"), e("light.hide")], switches: [e("switch.x"), e("switch.hide")],
    climates: [e("climate.hide")], locks: [e("lock.hide")], sensors: [e("sensor.x"), e("sensor.hide")],
    scenes: [e("scene.hide")], mediaPlayers: [e("media_player.hide"), e("media_player.x")],
  };
  const hidden = new Set(["light.hide", "switch.hide", "climate.hide", "lock.hide", "sensor.hide", "scene.hide", "media_player.hide"]);
  const out = withoutSettingsEntities(ent, hidden);
  assert.deepEqual(out.lights, [e("light.x")]);
  assert.deepEqual(out.switches, [e("switch.x")]);
  assert.deepEqual(out.climates, ent.climates);
  assert.deepEqual(out.locks, ent.locks);
  assert.deepEqual(out.sensors, ent.sensors);
  assert.deepEqual(out.scenes, ent.scenes);
  assert.deepEqual(out.mediaPlayers, ent.mediaPlayers);
});
test("filter: an empty hidden set returns the same lists", () => {
  const ent = { lights: [e("light.x")], switches: [], climates: [], locks: [], sensors: [], scenes: [], mediaPlayers: [] };
  assert.deepEqual(withoutSettingsEntities(ent, new Set()), ent);
});
test("fail open: a rejected registry read gives an empty set", async () => {
  const hidden = await readHiddenFailOpen(() => Promise.reject(new Error("ws down")));
  assert.equal(hidden.size, 0);
});
test("fail open: a good read passes through", async () => {
  const hidden = await readHiddenFailOpen(async () => new Set(["switch.a"]));
  assert.ok(hidden.has("switch.a"));
});

// --- fetchRegistryHiddenIds with a fake WebSocket ---------------------------
import { fetchRegistryHiddenIds, createHiddenIdsCache } from "./ha-settings-entities.ts";

class FakeWs {
  static last: FakeWs;
  sent: unknown[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeWs.last = this; }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  push(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
async function withFake<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { WebSocket: unknown };
  const orig = g.WebSocket;
  g.WebSocket = FakeWs;
  try { return await fn(); } finally { g.WebSocket = orig; }
}
const creds = { url: "https://ha.example:8123", token: "tok" };

test("ws: happy path authenticates, lists the registry, returns the hidden set and closes", () => withFake(async () => {
  const p = fetchRegistryHiddenIds(creds, 1000);
  const ws = FakeWs.last;
  assert.equal(ws.url, "wss://ha.example:8123/api/websocket");
  ws.push({ type: "auth_required" });
  assert.deepEqual(ws.sent[0], { type: "auth", access_token: "tok" });
  ws.push({ type: "auth_ok" });
  assert.deepEqual(ws.sent[1], { id: 1, type: "config/entity_registry/list" });
  ws.push({ type: "result", id: 1, success: true, result: [{ entity_id: "switch.a", entity_category: "config" }, { entity_id: "switch.b", entity_category: null }] });
  assert.deepEqual([...(await p)], ["switch.a"]);
  assert.ok(ws.closed);
}));
test("ws: auth_invalid rejects and closes", () => withFake(async () => {
  const p = fetchRegistryHiddenIds(creds, 1000);
  const ws = FakeWs.last;
  ws.push({ type: "auth_required" });
  ws.push({ type: "auth_invalid" });
  await assert.rejects(p, /auth rejected/);
  assert.ok(ws.closed);
}));
test("ws: no reply rejects at the timeout and closes", () => withFake(async () => {
  const p = fetchRegistryHiddenIds(creds, 20);
  const ws = FakeWs.last;
  await assert.rejects(p, /timeout/);
  assert.ok(ws.closed);
}));
test("ws: success false rejects", () => withFake(async () => {
  const p = fetchRegistryHiddenIds(creds, 1000);
  const ws = FakeWs.last;
  ws.push({ type: "auth_ok" });
  ws.push({ type: "result", id: 1, success: false });
  await assert.rejects(p, /refused/);
  assert.ok(ws.closed);
}));

test("ws: a trailing slash in the url never yields //api/websocket", () => withFake(async () => {
  const p = fetchRegistryHiddenIds({ url: "http://ha.example:8123//", token: "t" }, 20);
  assert.equal(FakeWs.last.url, "ws://ha.example:8123/api/websocket");
  await assert.rejects(p);
}));

test("cache: a failure is not retried within 60s, then retried", async () => {
  let t = 0, reads = 0, fails = 0;
  const get = createHiddenIdsCache({
    read: () => { reads++; return Promise.reject(new Error("down")); },
    ttlMs: 600_000, failTtlMs: 60_000, now: () => t, onFail: () => { fails++; },
  });
  assert.equal((await get()).size, 0);
  t = 59_000;
  assert.equal((await get()).size, 0);
  assert.equal(reads, 1);
  assert.equal(fails, 1);
  t = 61_000;
  await get();
  assert.equal(reads, 2);
});
test("cache: a success is kept for the ttl", async () => {
  let t = 0, reads = 0;
  const get = createHiddenIdsCache({ read: async () => { reads++; return new Set(["a"]); }, ttlMs: 600_000, failTtlMs: 60_000, now: () => t });
  await get(); t = 599_000; assert.ok((await get()).has("a")); assert.equal(reads, 1);
  t = 601_000; await get(); assert.equal(reads, 2);
});
test("cache: two concurrent calls open one read", () => withFake(async () => {
  let opened = 0;
  class Counting extends FakeWs { constructor(u: string) { super(u); opened++; } }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = Counting;
  const get = createHiddenIdsCache({ read: () => fetchRegistryHiddenIds(creds, 20), ttlMs: 600_000, failTtlMs: 60_000 });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(opened, 1);
  assert.equal(a.size + b.size, 0);
}));

// --- controls only: sensors (battery) must survive; the route body is kioskEntities ---
import { kioskEntities } from "./ha-settings-entities.ts";

test("kioskEntities: hidden switches and lights drop, a hidden battery sensor stays, locks are emptied", () => {
  const ent = {
    lights: [e("light.x"), e("light.hide")], switches: [e("switch.x"), e("switch.hide")],
    climates: [e("climate.hide")], locks: [e("lock.hide")], sensors: [e("sensor.battery_hide"), e("sensor.y")],
    scenes: [e("scene.hide")], mediaPlayers: [e("media_player.hide")],
  };
  const hidden = new Set(["light.hide", "switch.hide", "climate.hide", "lock.hide", "sensor.battery_hide", "scene.hide", "media_player.hide"]);
  const out = kioskEntities(ent, hidden);
  assert.deepEqual(out.lights, [e("light.x")]);
  assert.deepEqual(out.switches, [e("switch.x")]);
  assert.deepEqual(out.sensors, [e("sensor.battery_hide"), e("sensor.y")]);
  assert.deepEqual(out.climates, [e("climate.hide")]);
  assert.deepEqual(out.scenes, [e("scene.hide")]);
  assert.deepEqual(out.mediaPlayers, [e("media_player.hide")]);
  assert.deepEqual(out.locks, []);
});

// --- kiosk action route: hidden ids are not writable (hunt 15 H15K) ---
import { kioskActionRefusal } from "./ha-settings-entities.ts";

test("kioskActionRefusal: a hidden switch or light is refused", () => {
  const hidden = new Set(["switch.fake_cfg", "light.fake_cfg"]);
  assert.equal(kioskActionRefusal("switch.fake_cfg", hidden), "hidden");
  assert.equal(kioskActionRefusal("light.fake_cfg", hidden), "hidden");
});
test("kioskActionRefusal: a visible switch or light is allowed", () => {
  const hidden = new Set(["switch.fake_cfg"]);
  assert.equal(kioskActionRefusal("switch.fake_plug", hidden), null);
  assert.equal(kioskActionRefusal("light.fake_lamp", hidden), null);
});
test("kioskActionRefusal: an unreadable hidden set fails closed for light and switch only", () => {
  assert.equal(kioskActionRefusal("light.fake_lamp", null), "unknown");
  assert.equal(kioskActionRefusal("switch.fake_plug", null), "unknown");
  assert.equal(kioskActionRefusal("scene.fake_movie", null), null);
  assert.equal(kioskActionRefusal("climate.fake_ac", null), null);
});
