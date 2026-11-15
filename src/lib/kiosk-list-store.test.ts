import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleListAction, handleListGet, resetKioskListState } from "./kiosk-list-store.ts";
import type { ListItem } from "./kiosk-list.ts";

const TZ = "Australia/Sydney";
const T = Date.parse("2026-07-10T12:00:00+10:00");
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let dir = "";
let seq = 100;
const file = () => path.join(dir, "kiosk-list.json");
const bytes = () => fs.readFileSync(file(), "utf8");
const stored = (): { items: ListItem[]; history: { key: string; count: number; lastAt: number }[] } => JSON.parse(bytes());
const mk = (n: number, text: string, o: Partial<ListItem> = {}): ListItem => ({
  id: ID(n), listId: "shopping", text, done: false, createdAt: T - 1000 + n, doneAt: null, updatedAt: T - 1000 + n, ...o,
});
const seed = (items: ListItem[]) => {
  fs.writeFileSync(file(), JSON.stringify({ v: 1, items, history: [] }));
  resetKioskListState();
};

type Reply = { status: number; json: Record<string, any> };
const post = async (action: string, body: unknown, now = T, extra: Record<string, unknown> = {}): Promise<Reply> => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return (await handleListAction(action, { body: text, contentLength: text.length, tz: TZ, now, ...extra })) as Reply;
};
const add = (text: string, now = T, id = ID(seq++)) => post("add", { listId: "shopping", id, text }, now);
const get = async (now = T): Promise<Reply> => (await handleListGet({ list: null, tz: TZ, now })) as Reply;
const names = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i}`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-list-"));
  process.env.DATA_DIR = dir;
  resetKioskListState();
});
afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("6 add new: 200 added, on top, file has it", async () => {
  await add("Bread", T - 5);
  const r = await add("  oat   milk ", T);
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "added");
  assert.equal(r.json.item.text, "oat milk");
  assert.deepEqual(stored().items.map((i) => i.text), ["oat milk", "Bread"]);
  assert.equal(stored().items[0].createdAt, T);
});

test("7 add same open name: exists, file bytes unchanged", async () => {
  await add("Oat milk");
  const before = bytes();
  const r = await add("OAT  milk");
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "exists");
  assert.equal(stored().items.length, 1);
  assert.equal(bytes(), before);
});

test("8 add a ticked name at 13: revived, still 13", async () => {
  seed([mk(1, "Bread", { done: true, doneAt: T - 10 }), ...names(12).map((t, i) => mk(i + 2, t))]);
  const r = await add("bread", T);
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "revived");
  assert.equal(r.json.item.done, false);
  assert.equal(r.json.item.doneAt, null);
  const s = stored().items;
  assert.equal(s.length, 13);
  assert.equal(s[0].id, ID(1));
  assert.equal(s[0].createdAt, T);
});

test("9 add a new name at 13: 409 full, bytes unchanged", async () => {
  seed(names(13).map((t, i) => mk(i + 1, t)));
  const before = bytes();
  const r = await add("Eggs");
  assert.deepEqual([r.status, r.json], [409, { error: "full" }]);
  assert.equal(bytes(), before);
});

test("10 replay at 13 items: 200 replay, nothing new", async () => {
  await add("Tea", T, ID(1));
  for (const t of names(12)) await add(t);
  assert.equal(stored().items.length, 13);
  const r = await add("Tea", T, ID(1).toUpperCase());
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "replay");
  assert.equal(stored().items.length, 13);
});

test("11 validation rows each store nothing", async () => {
  seed([mk(1, "Bread")]);
  const before = bytes();
  const L = { listId: "shopping" };
  const raw = JSON.stringify({ ...L, id: ID(50), text: "Tea" });
  const cases: [string, string, number, string, Record<string, unknown>?][] = [
    ["add", raw, 400, "too_large", { contentLength: 5000 }],
    ["add", JSON.stringify({ ...L, id: ID(50), text: "x".repeat(2100) }), 400, "too_large"],
    ["add", "{nope", 400, "bad_json"],
    ["add", "[1]", 400, "bad_json"],
    ["add", JSON.stringify({ listId: "todo", id: ID(50), text: "Tea" }), 400, "bad_list"],
    ["add", JSON.stringify({ id: ID(50), text: "Tea" }), 400, "bad_list"],
    ["add", JSON.stringify({ ...L, id: "1", text: "Tea" }), 400, "bad_id"],
    ["add", JSON.stringify({ ...L, id: ID(50), text: "  \u0007 " }), 400, "blank"],
    ["add", JSON.stringify({ ...L, id: ID(50), text: "x".repeat(61) }), 400, "long"],
    ["done", JSON.stringify({ ...L, id: ID(1), done: "yes" }), 400, "bad_done"],
    ["done", JSON.stringify({ ...L, id: "zz", done: true }), 400, "bad_id"],
    ["restore", JSON.stringify({ ...L, ids: [] }), 400, "bad_ids"],
    ["restore", JSON.stringify({ ...L, ids: Array.from({ length: 27 }, (_, i) => ID(i)) }), 400, "bad_ids"],
    ["restore", JSON.stringify({ ...L, ids: ["nope"] }), 400, "bad_ids"],
    ["nuke", raw, 404, "unknown_action"],
  ];
  for (const [action, body, status, error, extra] of cases) {
    const r = (await handleListAction(action, { body, contentLength: body.length, tz: TZ, now: T, ...extra })) as Reply;
    assert.deepEqual([action, r.status, r.json], [action, status, { error }]);
  }
  assert.equal(bytes(), before);
  // unknown fields and client times are ignored
  const r = await post("add", { ...{ listId: "shopping" }, id: ID(60), text: "Tea", updatedAt: 1, createdAt: 1, doneAt: 1, done: true, extra: "x" });
  assert.equal(r.status, 200);
  const tea = stored().items.find((i) => i.text === "Tea");
  assert.deepEqual([tea?.updatedAt, tea?.createdAt, tea?.done, tea?.doneAt], [T, T, false, null]);
});

test("12 set done: stamps doneAt, repeat is a no-op, unknown id 404", async () => {
  seed([mk(1, "Bread")]);
  const r = await post("done", { listId: "shopping", id: ID(1), done: true }, T);
  assert.equal(r.status, 200);
  assert.deepEqual([stored().items[0].done, stored().items[0].doneAt, stored().items[0].updatedAt], [true, T, T]);
  const before = bytes();
  const again = await post("done", { listId: "shopping", id: ID(1), done: true }, T + 5000);
  assert.equal(again.status, 200);
  assert.equal(bytes(), before);
  const miss = await post("done", { listId: "shopping", id: ID(9), done: true });
  assert.deepEqual([miss.status, miss.json], [404, { error: "missing" }]);
});

test("13 clear ticked returns exactly the ticked items", async () => {
  seed([mk(1, "Bread", { done: true, doneAt: T - 5 }), mk(2, "Eggs"), mk(3, "Tea", { done: true, doneAt: T - 9 })]);
  const r = await post("clear-ticked", { listId: "shopping" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.removed.map((i: ListItem) => i.text), ["Bread", "Tea"]);
  assert.deepEqual(stored().items.map((i) => i.text), ["Eggs"]);
});

test("14 restore: window, dedupe, cap, ids only, upper-case ids", async () => {
  const ticked = [mk(1, "Bread", { done: true, doneAt: T - 5 }), mk(2, "Tea", { done: true, doneAt: T - 9 })];
  seed(ticked);
  await post("clear-ticked", { listId: "shopping" }, T);
  const forged = [{ id: ID(1), text: "Hacked" }];
  const r = await post("restore", { listId: "shopping", ids: [ID(1).replace(/0/g, "0").toUpperCase(), ID(2), ID(77)], items: forged }, T + 30_000);
  assert.deepEqual(r.json.restored.map((i: ListItem) => i.text).sort(), ["Bread", "Tea"]);
  assert.deepEqual(r.json.restored.find((i: ListItem) => i.id === ID(1)), ticked[0]);
  assert.deepEqual(r.json.skipped, [{ id: ID(77), reason: "expired" }]);
  assert.deepEqual(stored().items.map((i) => i.text).sort(), ["Bread", "Tea"]);

  seed([mk(1, "Bread", { done: true, doneAt: T - 5 })]);
  await post("clear-ticked", { listId: "shopping" }, T);
  const late = await post("restore", { listId: "shopping", ids: [ID(1)] }, T + 61_000);
  assert.deepEqual(late.json.skipped, [{ id: ID(1), reason: "expired" }]);
  assert.equal(stored().items.length, 0);

  seed([mk(1, "Bread", { done: true, doneAt: T - 5 })]);
  await post("clear-ticked", { listId: "shopping" }, T);
  await add("bread", T + 1);
  const dupe = await post("restore", { listId: "shopping", ids: [ID(1)] }, T + 2);
  assert.deepEqual(dupe.json.skipped, [{ id: ID(1), reason: "exists" }]);

  seed([mk(1, "Bread", { done: true, doneAt: T - 5 })]);
  await post("clear-ticked", { listId: "shopping" }, T);
  for (const t of names(13)) await add(t, T + 1);
  const full = await post("restore", { listId: "shopping", ids: [ID(1)] }, T + 2);
  assert.deepEqual(full.json.skipped, [{ id: ID(1), reason: "full" }]);
  assert.equal(stored().items.length, 13);
});

test("15 clear-all with no cookie: 403, file and limiter untouched", async () => {
  seed([mk(1, "Bread"), mk(2, "Eggs")]);
  const before = bytes();
  const none = await post("clear-all", { listId: "shopping" });
  assert.deepEqual([none.status, none.json], [403, { error: "elevation" }]);
  assert.equal(bytes(), before);
  // 40 refused clear-alls must not use up the budget
  for (let i = 0; i < 40; i++) await post("clear-all", { listId: "shopping" });
  assert.equal((await add("Tea")).status, 200);
});

test("15b clear-all with cookies (needs the jose package)", async () => {
  seed([mk(1, "Bread"), mk(2, "Eggs")]);
  const junk = await post("clear-all", { listId: "shopping" }, T, { elevationCookie: "garbage" });
  assert.equal(junk.status, 403);
  assert.equal(bytes(), JSON.stringify({ v: 1, items: [mk(1, "Bread"), mk(2, "Eggs")], history: [] }));
  process.env.SESSION_SECRET = "test-secret-for-kiosk-list";
  const auth = await import("./auth.ts");
  const elev = await post("clear-all", { listId: "shopping" }, T, { elevationCookie: await auth.createKioskElevationToken() });
  assert.equal(elev.status, 200);
  assert.equal(elev.json.removed.length, 2);
  assert.equal(stored().items.length, 0);
  seed([mk(1, "Bread")]);
  const sess = await post("clear-all", { listId: "shopping" }, T, { sessionCookie: await auth.createSessionToken() });
  assert.equal(sess.status, 200);
  assert.equal(stored().items.length, 0);
});

test("16 sweep at 04:00 local on read", async () => {
  const doneAt = Date.parse("2026-07-09T20:00:00+10:00");
  seed([mk(1, "Bread", { done: true, doneAt }), mk(2, "Old", { createdAt: Date.parse("2026-07-03T10:00:00+10:00") })]);
  const at359 = await get(Date.parse("2026-07-10T03:59:00+10:00"));
  assert.deepEqual(at359.json.items.map((i: ListItem) => i.text), ["Old", "Bread"].sort((a, b) => (a === "Old" ? -1 : 1)));
  resetKioskListState();
  const at400 = await get(Date.parse("2026-07-10T04:00:00+10:00"));
  assert.deepEqual(at400.json.items.map((i: ListItem) => i.text), ["Old"]);
  assert.deepEqual(stored().items.map((i) => i.text), ["Old"]);
});

test("17 missing, corrupt and unreadable store", async () => {
  const empty = await get();
  assert.deepEqual([empty.status, empty.json.items], [200, []]);
  assert.equal(fs.existsSync(file() + ".corrupt"), false);

  resetKioskListState();
  fs.writeFileSync(file(), "{garbage");
  const r = await get();
  assert.deepEqual([r.status, r.json.items], [200, []]);
  assert.equal(fs.readFileSync(file() + ".corrupt", "utf8"), "{garbage");

  resetKioskListState();
  fs.rmSync(file() + ".corrupt");
  fs.rmSync(file(), { force: true });
  fs.mkdirSync(file());
  const bad = await get();
  assert.deepEqual([bad.status, bad.json], [503, { error: "store" }]);
  assert.equal((await add("Tea")).status, 503);
  assert.equal(fs.statSync(file()).isDirectory(), true);
});

test("18 concurrent adds", async () => {
  const rs = await Promise.all(names(20).map((t) => add(t)));
  assert.equal(rs.filter((r) => r.status === 200).length, 13);
  assert.equal(rs.filter((r) => r.status === 409).length, 7);
  assert.equal(stored().items.length, 13);
  resetKioskListState();
  fs.rmSync(file());
  const two = await Promise.all([add("Tea"), add("tea")]);
  assert.deepEqual(two.map((r) => r.json.result).sort(), ["added", "exists"]);
  assert.equal(stored().items.length, 1);
});

test("19 growth caps", async () => {
  const day = 86400000;
  let n = 0;
  for (let d = 0; d < 20; d++) {
    const now = T + d * day;
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) { const id = ID(seq++); ids.push(id); await add(`Name ${n++}`, now, id); }
    for (const id of ids) await post("done", { listId: "shopping", id, done: true }, now);
    await post("clear-ticked", { listId: "shopping" }, now);
  }
  assert.equal(stored().history.length, 200);
  await add("Fresh", T + 130 * day);
  assert.equal(stored().history.length, 1);
  for (let r = 0; r < 3; r++) {
    const now = T + 200 * day + r * 1000;
    // seeded straight to disk: 13 adds, 13 ticks and a clear per round would trip the 40 a minute limiter
    const items = Array.from({ length: 13 }, (_, i) => mk(seq++, `R${r} ${i}`, { done: true, doneAt: now - 5 }));
    fs.writeFileSync(file(), JSON.stringify({ v: 1, items, history: [] }));
    (globalThis as any).__kioskList.file = null;
    await post("clear-ticked", { listId: "shopping" }, now);
  }
  assert.equal((globalThis as any).__kioskList.buffer.length, 26); // 39 removed in 3 s, capped at 2 x 13
});

test("20 rate limit: 40 a minute, refusals and 400s are free", async () => {
  seed([mk(1, "Bread")]);
  for (let i = 0; i < 40; i++) assert.equal((await post("done", { listId: "shopping", id: ID(1), done: true })).status, 200);
  const before = bytes();
  const r = await add("Tea");
  assert.deepEqual([r.status, r.json], [429, { error: "rate" }]);
  assert.equal(bytes(), before);
  assert.equal((await get()).status, 200);
  assert.equal((await add("Tea", T + 60_001)).status, 200);

  seed([]);
  for (let i = 0; i < 41; i++) assert.equal((await post("add", "{nope")).status, 400);
  assert.equal((await add("Tea")).status, 200);
});
