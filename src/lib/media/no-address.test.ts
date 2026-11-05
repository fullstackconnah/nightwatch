import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// C10n: this repo is public, so no media code, fixture or script carries a host, a path or a raw-error word.
// The *.example.invalid placeholder is allowed in tests only.
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIRS = ["src/components/media", "src/lib/media", "src/app/(dash)/media", "scripts/fixtures/media"];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(tsx?|mjs)$/.test(n) ? [join(d, n)] : []));

test("no address, mount path, URL or raw error in the media code", () => {
  const res = [/\b\d{1,3}(\.\d{1,3}){3}\b/, /\/mnt\//, /https?:\/\/(?!.*\.example\.invalid)/, /:\d{4,5}\b/];
  const hits = DIRS.flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !/\.test\.ts$/.test(f))
    .flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((l, n) => (res.some((re) => re.test(l)) ? [`${f.slice(ROOT.length)}:${n + 1}`] : [])),
    );
  assert.deepEqual(hits, []);
});

test("the page code never renders a raw error field", () => {
  const files = ["src/components/media", "src/app/(dash)/media", "src/lib/media"].flatMap((d) => walk(join(ROOT, d))).filter((f) => !/\.test\.ts$/.test(f));
  const hits = files.flatMap((f) => (/\b(probeError|scan\.error|\.detail)\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")) ? [f.slice(ROOT.length)] : []));
  assert.deepEqual(hits, []);
});
