import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createRadarFrameCache } from "./radar-frame-cache.ts";

const buf = (n: number) => new Uint8Array([n]).buffer;

describe("radar frame cache", () => {
  it("returns a stored body until it is 10 minutes old", () => {
    let t = 0;
    const c = createRadarFrameCache(() => t);
    c.set("/a.png", buf(1));
    t = 9 * 60 * 1000;
    assert.ok(c.get("/a.png"));
    t = 10 * 60 * 1000;
    assert.equal(c.get("/a.png"), null);
  });
  it("evicts the oldest entry past the cap", () => {
    const c = createRadarFrameCache(() => 0, 3);
    for (const k of ["a", "b", "c", "d"]) c.set(k, buf(1));
    assert.equal(c.get("a"), null);
    assert.ok(c.get("b") && c.get("c") && c.get("d"));
  });
  it("the default cap is 60", () => {
    const c = createRadarFrameCache(() => 0);
    for (let i = 0; i < 61; i++) c.set(`k${i}`, buf(1));
    assert.equal(c.get("k0"), null);
    assert.ok(c.get("k1"));
  });
  it("the route only caches after the PNG check, never on an error path", () => {
    const src = readFileSync(new URL("../app/kiosk/api/weather/radar/frame/route.ts", import.meta.url), "utf8");
    const iPng = src.indexOf("isPngBytes(body)");
    const iSet = src.indexOf("frameCache.set(");
    assert.ok(iPng > 0 && iSet > iPng);
    assert.equal(src.split("frameCache.set(").length, 2);
  });
});
