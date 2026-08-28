import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeWindow,
  localDateKey,
  parseClimateAutoOffPatch,
  parseTime,
  shouldFire,
  statusFor,
  upcomingWindow,
  warnWindow,
  type ClimateAutoOffConfig,
} from "./climate-auto-off.ts";

/** All date math is LOCAL time — construct via the local Date constructor,
 *  never ISO strings, so these tests are timezone-independent. */
const at = (h: number, m: number, day = 23) => new Date(2026, 7, day, h, m);

const cfg = (over: Partial<ClimateAutoOffConfig> = {}): ClimateAutoOffConfig => ({
  enabled: true,
  time: "23:00",
  ...over,
});

describe("parseTime", () => {
  it("parses valid 24h times", () => {
    assert.deepEqual(parseTime("23:00"), { hour: 23, minute: 0 });
    assert.deepEqual(parseTime("00:15"), { hour: 0, minute: 15 });
  });
  it("rejects malformed times", () => {
    assert.equal(parseTime("24:00"), null);
    assert.equal(parseTime("9:00"), null);
    assert.equal(parseTime("23:60"), null);
    assert.equal(parseTime(""), null);
  });
});

describe("activeWindow", () => {
  it("is null before the scheduled time", () => {
    assert.equal(activeWindow(at(22, 0), "23:00"), null);
  });
  it("covers the 60 minutes from the scheduled time", () => {
    const w = activeWindow(at(23, 30), "23:00");
    assert.ok(w);
    assert.equal(w.dateKey, "2026-08-23");
    assert.equal(w.startMs, at(23, 0).getTime());
  });
  it("is null once the window has passed", () => {
    assert.equal(activeWindow(at(0, 30, 24), "23:00"), null);
  });
  it("spans midnight: a 23:40 schedule is still active at 00:20 with yesterday's dateKey", () => {
    const w = activeWindow(at(0, 20, 24), "23:40");
    assert.ok(w);
    assert.equal(w.dateKey, "2026-08-23");
  });
});

describe("upcomingWindow", () => {
  it("returns today's window while it is still ahead", () => {
    assert.equal(upcomingWindow(at(22, 58), "23:00")?.dateKey, "2026-08-23");
  });
  it("rolls to tomorrow once today's start has passed", () => {
    assert.equal(upcomingWindow(at(23, 30), "23:00")?.dateKey, "2026-08-24");
  });
  it("is null for a malformed time", () => {
    assert.equal(upcomingWindow(at(22, 0), "nope"), null);
  });
});

describe("shouldFire", () => {
  it("fires inside the window", () => {
    assert.equal(shouldFire(cfg(), at(23, 10))?.dateKey, "2026-08-23");
  });
  it("does not fire when disabled, already run, or skipped", () => {
    assert.equal(shouldFire(cfg({ enabled: false }), at(23, 10)), null);
    assert.equal(shouldFire(cfg({ lastRunDate: "2026-08-23" }), at(23, 10)), null);
    assert.equal(shouldFire(cfg({ skipDate: "2026-08-23" }), at(23, 10)), null);
  });
  it("yesterday's lastRunDate does not block tonight", () => {
    assert.equal(shouldFire(cfg({ lastRunDate: "2026-08-22" }), at(23, 10))?.dateKey, "2026-08-23");
  });
});

describe("warnWindow", () => {
  it("warns inside the 5-minute lead", () => {
    assert.equal(warnWindow(cfg(), at(22, 56))?.dateKey, "2026-08-23");
  });
  it("does not warn earlier, when skipped, or when disabled", () => {
    assert.equal(warnWindow(cfg(), at(22, 54)), null);
    assert.equal(warnWindow(cfg({ skipDate: "2026-08-23" }), at(22, 56)), null);
    assert.equal(warnWindow(cfg({ enabled: false }), at(22, 56)), null);
  });
});

describe("statusFor", () => {
  it("off when disabled", () => {
    assert.equal(statusFor(cfg({ enabled: false }), at(12, 0)).kind, "off");
  });
  it("scheduled before the window", () => {
    const s = statusFor(cfg(), at(12, 0));
    assert.equal(s.kind, "scheduled");
  });
  it("skipped when tonight's window is skipped", () => {
    assert.equal(statusFor(cfg({ skipDate: "2026-08-23" }), at(22, 0)).kind, "skipped");
  });
  it("done inside the window after firing, back to scheduled after it", () => {
    assert.equal(statusFor(cfg({ lastRunDate: "2026-08-23" }), at(23, 10)).kind, "done");
    const later = statusFor(cfg({ lastRunDate: "2026-08-23" }), at(1, 0, 24));
    assert.equal(later.kind, "scheduled");
  });
});

describe("parseClimateAutoOffPatch", () => {
  it("accepts a valid partial patch", () => {
    assert.deepEqual(parseClimateAutoOffPatch({ enabled: true, time: "22:30" }), {
      enabled: true,
      time: "22:30",
    });
  });
  it("accepts null skipDate (un-skip)", () => {
    assert.deepEqual(parseClimateAutoOffPatch({ skipDate: null }), { skipDate: null });
  });
  it("rejects unknown fields, bad types, bad formats, and empty patches", () => {
    assert.ok("error" in parseClimateAutoOffPatch({ nope: 1 }));
    assert.ok("error" in parseClimateAutoOffPatch({ enabled: "yes" }));
    assert.ok("error" in parseClimateAutoOffPatch({ time: "9pm" }));
    assert.ok("error" in parseClimateAutoOffPatch({ lastRunDate: "23-08-2026" }));
    assert.ok("error" in parseClimateAutoOffPatch({}));
    assert.ok("error" in parseClimateAutoOffPatch(null));
    assert.ok("error" in parseClimateAutoOffPatch([]));
  });
});
