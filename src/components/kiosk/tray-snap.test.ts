import test from "node:test";
import assert from "node:assert/strict";
import { snapToHalfRow } from "./tray-snap.ts";

// Five rows 75 high from offset 8 (p-2): bottoms 83, 158, 233, 308, 383.
const rows = [8, 83, 158, 233, 308].map((top) => ({ top, height: 75 }));

test("snapToHalfRow: no rows leaves the cap alone", () => {
  assert.equal(snapToHalfRow(300, []), 300);
});

test("snapToHalfRow: one row that fits leaves the cap alone", () => {
  assert.equal(snapToHalfRow(120, [{ top: 8, height: 75 }]), 120);
});

test("snapToHalfRow: one row taller than the cap is cut through its middle", () => {
  assert.equal(snapToHalfRow(50, [{ top: 8, height: 75 }]), 45.5);
});

test("snapToHalfRow: a cap exactly at the last row's bottom needs no cut", () => {
  assert.equal(snapToHalfRow(383, rows), 383);
});

test("snapToHalfRow: one px short of the last bottom cuts that last row in half", () => {
  assert.equal(snapToHalfRow(382, rows), 345.5);
});

test("snapToHalfRow: many rows, the first row that crosses the cap is cut through its middle", () => {
  assert.equal(snapToHalfRow(300, rows), 270.5);
});

test("snapToHalfRow: when the middle of the crossing row lies past the cap, the row before is cut instead", () => {
  assert.equal(snapToHalfRow(240, rows), 195.5);
});
