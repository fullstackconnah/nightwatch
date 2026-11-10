import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches } from "./bearer.ts";

// Pins today's isAuthorized behaviour (src/lib/mcp/auth.ts) before it is moved here.
const T = "tok-0123456789";

test("exact match passes", () => assert.equal(bearerMatches(`Bearer ${T}`, T), true));
test("missing header fails", () => {
  assert.equal(bearerMatches(null, T), false);
  assert.equal(bearerMatches("", T), false);
});
test("no Bearer prefix fails", () => assert.equal(bearerMatches(T, T), false));
test("lowercase bearer fails", () => assert.equal(bearerMatches(`bearer ${T}`, T), false));
test("empty token after the prefix fails", () => {
  assert.equal(bearerMatches("Bearer ", T), false);
  assert.equal(bearerMatches("Bearer", T), false);
});
test("wrong value of the same length fails", () => assert.equal(bearerMatches("Bearer tok-0123456780", T), false));
test("wrong length fails (no throw)", () => {
  assert.equal(bearerMatches(`Bearer ${T}x`, T), false);
  assert.equal(bearerMatches("Bearer x", T), false);
});
test("a double space after Bearer fails", () => assert.equal(bearerMatches(`Bearer  ${T}`, T), false));
test("an empty configured token never matches", () => assert.equal(bearerMatches("Bearer ", ""), false));
