import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Routes and stores import "@/" and can't all load under node:test, so these scan the source.
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("hermes model route: the daemon file is written before the config, and a failure uses the house error text", () => {
  const s = src("../app/api/hermes/model/route.ts");
  const file = s.indexOf("writeHermesModelFile({");
  const save = s.indexOf("saveConfig(next)");
  assert.ok(file >= 0 && save > file, "writeHermesModelFile before saveConfig");
  assert.match(s, /saveErrorText\(e\)/);
  assert.doesNotMatch(s, /error: "Save failed\."/);
});

test("metrics history: an append starts with a newline so a torn fragment cannot eat the sample", () => {
  assert.match(src("./metrics-history.ts"), /appendFile\([^]{0,60}`\\n\$\{JSON\.stringify\(sample\)\}\\n`/);
});

test("kiosk list store: the temp file is synced before the rename", () => {
  const s = src("./kiosk-list-store.ts");
  const sync = s.indexOf(".sync()");
  assert.ok(sync >= 0 && sync < s.indexOf("fs.rename(tmp, file)"));
});

test("change log store: the baseline temp file is synced before the rename", () => {
  const s = src("./change-log-store.ts");
  const sync = s.indexOf(".sync()");
  assert.ok(sync >= 0 && sync < s.indexOf("fs.rename(tmp, file)"));
});
