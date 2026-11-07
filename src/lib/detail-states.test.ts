import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOAD_FAILED, LOGS_FAILED, REFRESH_FAILED, detailNotice, nearBottom, statsWhileRunning } from "./detail-states.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("B1: only a 404 is not-found; other errors keep the page", () => {
  assert.equal(detailNotice({ status: 404 }, true), "not-found");
  assert.equal(detailNotice({ status: 404 }, false), "not-found");
  assert.equal(detailNotice({ status: 500 }, true), REFRESH_FAILED);
  assert.equal(detailNotice(new TypeError("fetch failed"), true), REFRESH_FAILED);
  assert.equal(detailNotice(new TypeError("fetch failed"), false), LOAD_FAILED);
  assert.equal(detailNotice(undefined, true), null);
  assert.equal(REFRESH_FAILED, "Couldn't refresh. Showing the last update.");
  assert.equal(LOAD_FAILED, "Couldn't load this container. Retrying.");
});

test("B2: a stopped container has no stats history", () => {
  assert.deepEqual(statsWhileRunning([1, 2], false), []);
  assert.deepEqual(statsWhileRunning([1, 2], true), [1, 2]);
});

test("B4: sticks to the bottom only within 32 px (or on first load)", () => {
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true);
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 570, clientHeight: 400 }), true);
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 }), false);
});

test("B3: the logs card reads error and never shows 'no output' for one", () => {
  const s = src("app/(dash)/containers/[id]/page.tsx");
  assert.match(s, /const \{ data, error \} = useSWR<\{ logs: string \}>/);
  assert.equal(LOGS_FAILED, "Couldn't read logs.");
  assert.ok(s.includes("{LOGS_FAILED}"));
  assert.ok(s.includes("error ? null : \"no output\"") || s.includes("(error ? \"\" : \"no output\")"));
});

test("B5: the Digest reads error and shows dashes", () => {
  const s = src("components/home/side-panel.tsx");
  assert.match(s, /const \{ data, error \} = useHost\(5000\)/);
  assert.match(s, /const x = error \? undefined : data/);
});

test("B6: lanes say 'not reachable' on a route-level error", () => {
  const s = src("components/home/side-panel.tsx");
  assert.match(s, /const \{ data, error \} = useOrchestraStatus\(\)/);
  assert.match(s, /else if \(data \|\| error\) text = "not reachable"/);
});

test("B7: orphans are null while sizes are pending", () => {
  assert.match(src("app/(dash)/docker/page.tsx"), /orphans: sizesPending \? null :/);
  assert.match(src("components/docker/answer.tsx"), /orphans: number \| null;/);
});

test("B8: the logs page prints fixed text and logs the detail server side", () => {
  const s = src("app/(dash)/logs/page.tsx");
  assert.ok(s.includes("Couldn't read logs from Docker."));
  assert.ok(!s.includes("err.message"));
  assert.match(s, /console\.error\(/);
});
