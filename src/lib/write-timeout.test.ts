import test from "node:test";
import assert from "node:assert/strict";
import { formatLimit, runWithLimit, WriteTimeout } from "./write-timeout.ts";

const never = () => new Promise<void>(() => {});

test("a write that never answers rejects with a WriteTimeout naming the limit", async () => {
  await assert.rejects(
    runWithLimit(never, 30),
    (e: unknown) => e instanceof WriteTimeout && e.message === "no answer after 30 ms",
  );
});

test("a write that finishes first resolves and leaves no pending timer", async () => {
  // A leaked 60 s timer would keep this process alive past the end of the run.
  await runWithLimit(() => Promise.resolve(), 60_000);
});

test("a write's own failure passes through unchanged, not as a WriteTimeout", async () => {
  const boom = new Error("disk full");
  await assert.rejects(runWithLimit(() => Promise.reject(boom), 60_000), (e: unknown) => e === boom);
});

test("a limit of 0 means no limit", async () => {
  const slow = () => new Promise<void>((r) => setTimeout(r, 60));
  await runWithLimit(slow, 0);
});

test("a late rejection after the timeout raises no unhandled rejection", async () => {
  const seen: unknown[] = [];
  const on = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", on);
  const late = () => new Promise<void>((_, rej) => setTimeout(() => rej(new Error("late")), 60));
  await assert.rejects(runWithLimit(late, 20), WriteTimeout);
  await new Promise((r) => setTimeout(r, 120));
  process.off("unhandledRejection", on);
  assert.deepEqual(seen, []);
});

test("formatLimit prints whole minutes, else seconds", () => {
  assert.equal(formatLimit(120_000), "2 min");
  assert.equal(formatLimit(60_000), "1 min");
  assert.equal(formatLimit(90_000), "90 s");
  assert.equal(formatLimit(30), "30 ms");
});
