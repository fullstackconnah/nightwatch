import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WEEK_MS, refreshedWeekSince } from "./home.ts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const walk = (dir: URL): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [fileURLToPath(new URL(e.name, dir))],
  );

test("H45-1: no component or page builds a container action URL by hand", () => {
  const files = [...walk(new URL("../components/", import.meta.url)), ...walk(new URL("../app/", import.meta.url))].filter((f) => /\.tsx?$/.test(f));
  const bad = files.filter((f) => /\/api\/docker\/containers\/\$\{[^`]*\/action/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad.map((f) => f.replaceAll("\\", "/").replace(/^.*\/src\//, "src/")), []);
});

test("H45-3: refreshedWeekSince keeps null, small drift and a future pin", () => {
  assert.equal(refreshedWeekSince(null, NOW), null);
  const pinned = NOW - WEEK_MS - 59 * 60_000;
  assert.equal(refreshedWeekSince(pinned, NOW), pinned);
  assert.equal(refreshedWeekSince(NOW + HOUR, NOW), NOW + HOUR);
});

test("H45-3: refreshedWeekSince re-pins once the window drifted over an hour", () => {
  assert.equal(refreshedWeekSince(NOW - WEEK_MS - 61 * 60_000, NOW), NOW - WEEK_MS);
});
