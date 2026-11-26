import test from "node:test";
import assert from "node:assert/strict";
import { notFoundHome } from "./not-found-home.ts";

test("a mistyped kiosk path links back to the wall display", () => {
  const wall = { href: "/kiosk", label: "Back to the wall display" };
  assert.deepEqual(notFoundHome("/kiosk/x"), wall);
  assert.deepEqual(notFoundHome("/kiosk"), wall);
});

test("every other path keeps Home", () => {
  const home = { href: "/", label: "Back to Home" };
  assert.deepEqual(notFoundHome("/foo"), home);
  assert.deepEqual(notFoundHome("/kioskish"), home);
  assert.deepEqual(notFoundHome(null), home);
});
