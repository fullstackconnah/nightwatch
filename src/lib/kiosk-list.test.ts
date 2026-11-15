import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAdd, restoreGone, norm, sweepBoundary, suggestions, parseListFile, MAX_ITEMS, MAX_ROWS, MAX_LEN, type ListItem } from "./kiosk-list.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, text: string, o: Partial<ListItem> = {}): ListItem => ({
  id: ID(n), listId: "shopping", text, done: false, createdAt: 1000 + n, doneAt: null, updatedAt: 1000 + n, ...o,
});

test("1 checkAdd port parity", () => {
  const it = [{ text: "Oat milk", done: false }, { text: "Bread", done: true }];
  const k = (raw: string, list: { text: string; done: boolean }[] = it) => checkAdd(raw, list).kind;
  const full = Array.from({ length: MAX_ITEMS }, (_, i) => ({ text: "x" + i, done: false }));
  assert.equal(k("   "), "blank");
  assert.equal(k("\u0007"), "blank");
  assert.equal(k("  oat   MILK "), "dupe");
  assert.equal(k("bread"), "revive");
  assert.equal(k("x".repeat(MAX_LEN + 1)), "long");
  assert.equal(k("x".repeat(MAX_LEN)), "add");
  assert.equal(k("Eggs", full), "full");
  assert.equal(k("x3", full), "dupe");
  const r = checkAdd(" Tea \u{1F375} ", it);
  assert.deepEqual(r, { kind: "add", text: "Tea \u{1F375}" });
});

test("2 checkAdd NFC and control characters", () => {
  assert.equal(checkAdd("Cafe\u0301", [{ text: "Caf\u00e9", done: false }]).kind, "dupe");
  assert.deepEqual(checkAdd("Oat\u0000milk", []), { kind: "add", text: "Oatmilk" });
  // strip first, then NFC: norm is idempotent and a saved item survives a reload
  assert.equal(norm("Cafe\u0001́"), "Café");
  assert.equal(norm(norm("Cafe\u0001́")), norm("Cafe\u0001́"));
  const it = { id: "00000000-0000-4000-8000-000000000001", listId: "shopping", text: norm("Cafe\u0001́"), done: false, createdAt: 1, doneAt: null, updatedAt: 1 };
  assert.equal(parseListFile(JSON.stringify({ v: 1, items: [it], history: [] }))?.items.length, 1);
  // zero-width and format characters are stripped
  assert.equal(checkAdd("\u200b\u200b", []).kind, "blank");
  assert.equal(norm("milk\u200b"), "milk");
});

test("3 sweepBoundary in Australia/Sydney", () => {
  const tz = "Australia/Sydney";
  // 2026-07-10 is AEST (+10): 04:00 local = 18:00Z the day before
  assert.equal(sweepBoundary(tz, Date.parse("2026-07-10T03:59:00+10:00")), Date.parse("2026-07-09T04:00:00+10:00"));
  assert.equal(sweepBoundary(tz, Date.parse("2026-07-10T04:00:00+10:00")), Date.parse("2026-07-10T04:00:00+10:00"));
  // DST starts 2026-10-04 at 02:00 local: 04:00 that day is +11:00
  assert.equal(sweepBoundary(tz, Date.parse("2026-10-04T12:00:00+11:00")), Date.parse("2026-10-04T04:00:00+11:00"));
  assert.equal(sweepBoundary(tz, Date.parse("2026-10-04T03:00:00+11:00")), Date.parse("2026-10-03T04:00:00+10:00"));
  assert.equal(sweepBoundary("Not/AZone", Date.parse("2026-07-10T12:00:00+10:00")), Date.parse("2026-07-10T04:00:00+10:00"));
});

test("4 suggestions", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");
  const day = 86400000;
  const h = (key: string, count: number, lastAt: number) => ({ key, text: key.toUpperCase(), count, lastAt });
  const history = [
    h("a", 5, now - day), h("b", 5, now - 2 * day), h("c", 9, now - 3 * day), h("d", 1, now - 4 * day),
    h("e", 2, now - 5 * day), h("old", 99, now - 91 * day), h("open", 50, now - day),
  ];
  const items = [item(1, "Open"), item(2, "A", { done: true, doneAt: 5 })];
  assert.deepEqual(suggestions(history, items, now), ["C", "A", "B", "E"]);
});

test("5 parseListFile", () => {
  assert.equal(parseListFile("{nope"), null);
  assert.equal(parseListFile("[]"), null);
  const good = item(1, "Bread");
  const long = item(2, "x".repeat(61));
  const bad = { ...item(3, "Tea"), done: "no" };
  const badId = { ...item(4, "Eggs"), id: "1" };
  const f = parseListFile(JSON.stringify({ v: 1, items: [good, long, bad, badId], history: [{ key: "bread", text: "Bread", count: 1, lastAt: 5 }, { nope: 1 }] }));
  assert.deepEqual(f?.items, [good]);
  assert.equal(f?.history.length, 1);
  const many = Array.from({ length: MAX_ROWS + 3 }, (_, i) => item(i + 1, "n" + i));
  const g = parseListFile(JSON.stringify({ v: 1, items: many, history: [] }));
  assert.equal(g?.items.length, MAX_ROWS); // the row ceiling, so ticked rows never push open ones out on a read
  assert.equal(g?.items[0].text, "n" + (MAX_ROWS + 2)); // newest kept
});

// ── slice 2: pane and button views, row order ────────────────────────────────
import { listPaneView, listButtonView, settleRows } from "./kiosk-list.ts";

const open = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1, ["Oat milk", "Bread", "Apples", "Eggs", "Tea", "Rice", "Jam", "Salt", "Soap", "Figs"][i % 10] + (i >= 10 ? ` ${i}` : "")));

test("23a listPaneView: 0 open (or not loaded) drops the pane", () => {
  assert.equal(listPaneView([], false), null);
  assert.equal(listPaneView(null, false), null);
  assert.equal(listPaneView([item(1, "Tea", { done: true, doneAt: 5 })], false), null);
});

test("23b listPaneView: 3 open shows the caption and 3 names, newest first", () => {
  const v = listPaneView(open(3), false);
  assert.equal(v?.caption, "Shopping \u00b7 3 to get");
  assert.deepEqual(v?.names, ["Apples", "Bread", "Oat milk"]);
  assert.equal(v?.more, 0);
  assert.equal(v?.sr, "Shopping, 3 to get: Apples, Bread, Oat milk");
});

test("23c listPaneView: exactly 4 open shows all 4; 9 open shows 3 and 'and 6 more'; ticked never count", () => {
  assert.equal(listPaneView(open(4), false)?.names.length, 4);
  assert.equal(listPaneView(open(4), false)?.more, 0);
  const nine = [...open(9), item(20, "Old", { done: true, doneAt: 9 })];
  const v = listPaneView(nine, false);
  assert.equal(v?.caption, "Shopping \u00b7 9 to get");
  assert.equal(v?.names.length, 3);
  assert.equal(v?.more, 6);
  assert.equal(v?.sr, "Shopping, 9 to get: Soap, Salt, Jam and 6 more");
});

test("23d listPaneView passes stale through", () => {
  assert.equal(listPaneView(open(1), true)?.stale, true);
  assert.equal(listPaneView(open(1), false)?.stale, false);
});

test("24 listButtonView: count, zero, failed and the accessible names", () => {
  assert.deepEqual(listButtonView(open(9)), { label: "Shopping", count: 9, aria: "Shopping list, 9 to get" });
  assert.deepEqual(listButtonView([]), { label: "Shopping", count: 0, aria: "Shopping list, empty" });
  assert.deepEqual(listButtonView(null), { label: "Shopping", count: null, aria: "Shopping list, not loaded" });
  assert.equal(listButtonView([...open(2), item(30, "Old", { done: true, doneAt: 1 })]).count, 2);
});

test("24b settleRows: first call splits open and ticked; a tick does not move a row; an add goes on top; a clear drops the id", () => {
  const items = [item(1, "A"), item(2, "B"), item(3, "C", { done: true, doneAt: 5 })];
  const a = settleRows(null, items);
  assert.deepEqual(a, { open: [ID(2), ID(1)], ticked: [ID(3)] });
  const ticked = items.map((i) => (i.id === ID(1) ? { ...i, done: true, doneAt: 9 } : i));
  assert.deepEqual(settleRows(a, ticked), a); // ticked row 1 stays where it was
  const added = [...ticked, item(4, "D")];
  assert.deepEqual(settleRows(a, added).open, [ID(4), ID(2), ID(1)]);
  assert.deepEqual(settleRows(a, ticked.filter((i) => i.id !== ID(3))).ticked, []);
});

test("3 checkAdd: ticked rows do not count towards the cap; a hard ceiling does", () => {
  const ticked = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ text: "t" + i, done: true }));
  assert.equal(checkAdd("Eggs", ticked).kind, "add");
  const open = Array.from({ length: MAX_ITEMS }, (_, i) => ({ text: "o" + i, done: false }));
  assert.equal(checkAdd("Eggs", [...open, ...ticked]).kind, "full");
  const rows = Array.from({ length: MAX_ITEMS * 3 }, (_, i) => ({ text: "r" + i, done: true }));
  assert.equal(checkAdd("Eggs", rows).kind, "full");
  assert.equal(checkAdd("r1", rows).kind, "revive");
});

test("4 restoreGone puts back only the cleared rows that are missing", () => {
  const a = item(1, "A"), b = item(2, "B"), c = item(3, "C");
  assert.deepEqual(restoreGone([c], [a, b], new Set([a.id])).map((i) => i.id), [c.id, a.id]);
  assert.deepEqual(restoreGone([a, c], [a, b], new Set([a.id])).map((i) => i.id), [a.id, c.id]);
});

test("52d settleRows: a fresh ticked row lands in ticked, a fresh open row on top of open", () => {
  const prev = { open: [ID(2), ID(1)], ticked: [] as string[] };
  const items = [item(1, "A"), item(2, "B"), item(5, "T", { done: true, doneAt: 9 }), item(6, "N")];
  assert.deepEqual(settleRows(prev, items), { open: [ID(6), ID(2), ID(1)], ticked: [ID(5)] });
});
