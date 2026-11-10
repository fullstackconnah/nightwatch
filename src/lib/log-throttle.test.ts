import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { throttledError, recovered } from "./log-throttle.ts";

function capture(run: () => void): string[] {
  const lines: string[] = [];
  const err = console.error;
  const info = console.info;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.info = console.error;
  mock.timers.enable({ apis: ["Date"] });
  try {
    run();
  } finally {
    mock.timers.reset();
    console.error = err;
    console.info = info;
  }
  return lines;
}

test("logs the first failure, suppresses repeats for 60 s, then reports the count", () => {
  const lines = capture(() => {
    throttledError("a1", new Error("boom"));
    for (let i = 0; i < 59; i++) {
      mock.timers.tick(900);
      throttledError("a1", new Error("boom"));
    }
    mock.timers.tick(60_000);
    throttledError("a1", new Error("boom"));
    // The second log reset the window: +30 s is suppressed (count 1), +60 s logs again with that 1.
    mock.timers.tick(30_000);
    throttledError("a1", new Error("boom"));
    mock.timers.tick(30_000);
    throttledError("a1", new Error("boom"));
  });
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines[0], /suppressed/);
  assert.match(lines[1], /\(59 similar suppressed\)/);
  assert.match(lines[2], /\(1 similar suppressed\)/);
});

test("recovered logs once after failures and never without them", () => {
  const lines = capture(() => {
    recovered("b1");
    throttledError("b2", "x");
    throttledError("b2", "x");
    throttledError("b2", "x");
    recovered("b2");
    recovered("b2");
  });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^\[telemetry\] b2 recovered after 3 failures$/);
});

test("keys are independent", () => {
  const lines = capture(() => {
    throttledError("c1", "x");
    throttledError("c2", "x");
    throttledError("c1", "x");
  });
  assert.equal(lines.length, 2);
});

const root = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("telemetry.ts keeps bare console.error only on the two dead-code host catches", () => {
  const bare = root("./telemetry.ts").match(/^\s*console\.error\(.*$/gm) ?? [];
  assert.equal(bare.length, 2);
  assert.match(bare[0], /getHostDiskIoCounters/);
  assert.match(bare[1], /getHostNetCounters/);
});

test("both compose files cap the dashboard container log", () => {
  for (const f of ["docker-compose.yml", "docker-compose.test.yml"]) {
    const text = root(`../../${f}`);
    const block = text.split(/^  dashboard:$/m)[1].split(/^\S/m)[0];
    assert.match(block, /max-size: "10m"/, f);
    // dashboard and socket-proxy are both capped
    assert.equal((text.match(/max-size: "10m"/g) ?? []).length, 2, f);
  }
});

test("a withTimeout null fallback is not a recovery", () => {
  for (const k of ["getHostVitals", "getGpuSnapshot"]) {
    const lines = root("./telemetry.ts").match(new RegExp(`^.*recovered\\("${k}"\\).*$`, "gm")) ?? [];
    assert.equal(lines.length, 1, k);
    assert.match(lines[0], /^\s*if \(v !== null\) recovered\(/, k);
  }
});
