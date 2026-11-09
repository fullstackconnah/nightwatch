import test from "node:test";
import assert from "node:assert/strict";
import { jobView } from "./job-view.ts";
import { ApiError } from "../api-error.ts";

const good = { ok: true, job: { id: "j1", state: "running" } } as never;

test("an error with no data yet becomes a failed fetch", () => {
  assert.deepEqual(jobView(undefined, new ApiError("HTTP 500", 500)), { ok: false, status: "error", detail: "HTTP 500" });
  assert.deepEqual(jobView(undefined, new Error("offline")), { ok: false, status: "error", detail: "offline" });
});
test("a 401 fails even with data", () => {
  assert.equal(jobView(good, new ApiError("unauthorized", 401))?.ok, false);
});
test("a 500 after a good reading keeps the data", () => {
  assert.equal(jobView(good, new ApiError("HTTP 500", 500)), good);
});
test("no error passes the data through", () => {
  assert.equal(jobView(good, undefined), good);
  assert.equal(jobView(undefined, undefined), undefined);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
test("useHermesRun maps the poll through jobView and a 401 stops the retries", () => {
  const src = readFileSync(fileURLToPath(new URL("../use-hermes.ts", import.meta.url)), "utf8");
  assert.match(src, /^\s+const job = jobView\(data, error\);\s*$/m);
  assert.match(src, /^\s+shouldRetryOnError: .*401/m);
});
