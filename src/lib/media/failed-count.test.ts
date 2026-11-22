import { test } from "node:test";
import assert from "node:assert/strict";
import { countRecentFailedCompressions } from "./failed-count.ts";
import { mediaCompressionFailed } from "../attention-copy.ts";
import { ownerFor } from "../attention-report.ts";
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let n = 0;
const job = (path: string, state: string, at: number, extra: object = {}) => ({
  id: `j${++n}`, path, state, createdAt: ago(at + 1000), finishedAt: ago(at), crf: 22, sourceBytes: 1, attempts: 1, ...extra,
});
const clientOf = (recent: object[], queue: object[] = [], current: object | null = null) =>
  ({ jobs: async () => ({ status: "ok" as const, data: { compressEnabled: true, compressReady: true, current, queue, recent } }) }) as never;

test("one path failed 1 day ago counts as 1", async () => {
  assert.equal(await countRecentFailedCompressions(clientOf([job("/m/A Secret Film.mkv", "failed", DAY)]), NOW), 1);
});

test("three paths failed counts as 3", async () => {
  const recent = ["a", "b", "c"].map((p) => job(`/m/${p}.mkv`, "failed", DAY));
  assert.equal(await countRecentFailedCompressions(clientOf(recent), NOW), 3);
});

test("failed 8 days ago does not count; 6 days does", async () => {
  assert.equal(await countRecentFailedCompressions(clientOf([job("/m/a.mkv", "failed", 8 * DAY)]), NOW), 0);
  assert.equal(await countRecentFailedCompressions(clientOf([job("/m/a.mkv", "failed", 6 * DAY)]), NOW), 1);
});

test("a failed job followed by a later successful job for the same path does not count", async () => {
  const recent = [job("/m/a.mkv", "done", DAY), job("/m/a.mkv", "failed", 2 * DAY)];
  assert.equal(await countRecentFailedCompressions(clientOf(recent), NOW), 0);
});

test("a failed job followed by a queued retry does not count", async () => {
  const retry = job("/m/a.mkv", "queued", 0);
  assert.equal(await countRecentFailedCompressions(clientOf([job("/m/a.mkv", "failed", DAY)], [retry]), NOW), 0);
});

test("a job with no usable time does not count", async () => {
  const noTime = { ...job("/m/a.mkv", "failed", DAY), finishedAt: undefined };
  const junk = { ...job("/m/b.mkv", "failed", DAY), finishedAt: "not a date" };
  assert.equal(await countRecentFailedCompressions(clientOf([noTime, junk]), NOW), 0);
});

test("worker unreachable (client throws), non-OK and unparsable body all give 0 without throwing", async () => {
  const throws = { jobs: async () => { throw new Error("boom"); } } as never;
  const down = { jobs: async () => ({ status: "unreachable", detail: "x" }) } as never;
  const junk = { jobs: async () => ({ status: "ok", data: "<html>" }) } as never;
  const holes = { jobs: async () => ({ status: "ok", data: { recent: null } }) } as never;
  for (const c of [throws, down, junk, holes]) assert.equal(await countRecentFailedCompressions(c, NOW), 0);
});

test("copy: count 1 and count N, with no file name anywhere", () => {
  assert.deepEqual(mediaCompressionFailed(1), {
    headline: "A compression failed",
    detail: "The original file was kept.",
    action: "Open Media and choose Try again.",
  });
  assert.deepEqual(mediaCompressionFailed(3), {
    headline: "3 compressions failed",
    detail: "The original files were kept.",
    action: "Open Media and choose Try again.",
  });
  assert.doesNotMatch(JSON.stringify(mediaCompressionFailed(1)), /Secret Film|\.mkv|\/m\//);
});

test("media hits link to /media", () => {
  assert.deepEqual(ownerFor("media", "media-failed"), { href: "/media", label: "Open Media" });
});

test("attention.ts lists the media probe only when the worker is configured, after outside and before doorbell, as warn", () => {
  const src = readFileSync(new URL("../attention.ts", import.meta.url), "utf8");
  assert.match(src, /\.\.\.\(mediaWorkerCredentials\(\) \? \[\{ id: "media", label: "Media compression"/);
  assert.ok(src.indexOf('id: "outside"') < src.indexOf('id: "media"') && src.indexOf('id: "media"') < src.indexOf('id: "doorbell"'));
  assert.match(src, /hit\("media-failed", "warn", mediaCompressionFailed\(/);
});
