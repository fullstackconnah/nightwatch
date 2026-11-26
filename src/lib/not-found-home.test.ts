import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the 404 page renders its link through the client component, not a fixed href", () => {
  const src = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8");
  assert.match(src, /<NotFoundHomeLink \/>/);
  assert.doesNotMatch(src, /href="\/"/);
});
