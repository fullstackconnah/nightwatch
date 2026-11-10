import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/* Source scans (these files import the "@/" alias, so they can't load under node:test): upstream error text never reaches the client raw. */

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("hunt 6 secrets", () => {
  it("forgejo masks and caps a mirror's lastError", () => {
    assert.match(read("./forgejo.ts"), /lastError: pm\.last_error\?\.trim\(\) \? maskCredentials\(pm\.last_error\)\.slice\(0, 300\) : null/);
  });
  it("maskCredentials strips every embedded userinfo, not just the first", () => {
    assert.ok(read("./forgejo.ts").includes(String.raw`url.replace(/:\/\/[^\s/@]+@/g, "://")`));
  });
  it("throwingSnapshotRoute sends the fixed fallback, never e.message", () => {
    const src = read("./snapshot-route.ts");
    assert.ok(!src.includes("e.message"));
    assert.ok(src.includes("error: fallbackMessage"));
  });
  it("smart.json read errors are a fixed string", () => {
    const src = read("./smart.ts");
    assert.ok(!src.includes("readError = err instanceof Error"));
    assert.ok(src.includes('readError = "smart.json could not be read"'));
  });
  it("process cmdlines go through redactCmdline", () => {
    assert.ok(read("./processes.ts").includes("redactCmdline(cleaned)"));
  });
});

describe("hunt 10 fixed error text", () => {
  it("the upload proxy answers 502 with a fixed message and logs the real error", () => {
    const src = read("./minecraft/upload-proxy.ts");
    assert.ok(!src.includes("e.message"));
    assert.ok(src.includes('"Could not reach the Minecraft manager."'));
    assert.ok(src.includes("console.error("));
  });
  it("the log stream emits fixed text for stream and start errors", () => {
    const src = read("./log-stream.ts");
    assert.ok(!src.includes("err.message"));
    assert.ok(src.includes('detail: "Log stream failed."'));
  });
  it("the container action fallback is a fixed message", () => {
    const src = read("../app/api/docker/containers/[id]/action/route.ts");
    assert.ok(src.includes('return "Docker action failed."'));
  });
});
