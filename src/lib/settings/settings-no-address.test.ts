import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// C4 / R-ip: this repo is public, so no settings code carries a dotted-quad address, not even as a placeholder.
const SRC = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIRS = ["components/settings", "app/(dash)/settings", "app/api/settings", "lib/settings"];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));

test("no dotted-quad address in the settings page, components, routes or model", () => {
  const re = /\b\d{1,3}(\.\d{1,3}){3}\b/;
  const hits = DIRS.flatMap((d) => walk(join(SRC, d))).flatMap((f) =>
    readFileSync(f, "utf8").split("\n").flatMap((l, n) => (re.test(l) ? [`${f.slice(SRC.length)}:${n + 1}`] : [])),
  );
  assert.deepEqual(hits, []);
});
