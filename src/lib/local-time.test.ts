import test from "node:test";
import assert from "node:assert/strict";

// Set before any Date is formatted so the helpers see the owner's zone.
process.env.TZ = "Australia/Sydney";
const { localStamp, localDateString } = await import("./local-time.ts");

test("localStamp shows the browser's local date and 24-hour time", () => {
  assert.equal(localStamp(Date.parse("2026-11-09T21:00:00Z")), "2026-11-10 08:00");
  assert.equal(localStamp(Date.parse("2026-11-09T13:05:00Z")), "2026-11-10 00:05");
});

test("localDateString with no zone falls back to Australia/Sydney, not UTC", () => {
  const at = new Date("2026-11-09T21:00:00Z");
  assert.equal(localDateString(undefined, at), "2026-11-10");
  assert.equal(localDateString("America/New_York", at), "2026-11-09");
});
