import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("K10/D6: widget Delete asks first through WriteAction, and only Yes runs the PUT", () => {
  const w = read("components/settings/settings-widgets.tsx");
  const at = w.indexOf("<WriteAction");
  assert.ok(at > 0, "WriteAction is used");
  const a = w.slice(at, w.indexOf("onActive", at));
  assert.match(a, /yes="Yes, delete"/);
  assert.match(a, /\bdanger\b/);
  assert.match(a, /run=\{\(\) => onDelete\(w\.id\)\}/);
  assert.doesNotMatch(a, /confirm=\{false\}/);
  assert.doesNotMatch(w, /onClick=\{\(\) => onDelete/);
});

test("K12: a widget save PUTs only widgets, a tile save only the four tile fields, and neither resets the tile draft", () => {
  const p = read("app/(dash)/settings/page.tsx");
  assert.match(p, /persist\(\{ widgets \}\)/);
  assert.match(p, /persist\(\{ widgets: data\.config\.widgets\.filter/);
  assert.match(p, /persist\(\{ groups: tileDraft\.groups, urls: tileDraft\.urls, icons: tileDraft\.icons, hidden: tileDraft\.hidden \}\)/);
  const persist = p.slice(p.indexOf("async function persist"), p.indexOf("const why"));
  assert.ok(persist.length > 20);
  assert.doesNotMatch(persist, /setTileDraft/);
  assert.doesNotMatch(p, /putJson\("\/api\/settings", \{ \.\.\./);
});

test("D5/R7: Hermes model, Hermes daemon, widgets and tiles each report dirty and error", () => {
  const h = read("components/settings/settings-hermes.tsx");
  assert.match(h, /useFormReport\("hermes-model"/);
  assert.match(h, /useFormReport\("hermes-daemon"/);
  assert.match(read("components/settings/settings-widgets.tsx"), /useFormReport\("widgets", \{ dirty: editing !== null, error \}\)/);
  assert.match(read("components/settings/settings-tiles.tsx"), /useFormReport\("tiles", \{ dirty, error \}\)/);
});

test("dashError copy: the three failure sentences are the spec's words", () => {
  const p = read("app/(dash)/settings/page.tsx");
  for (const s of ["Couldn’t save the widget: ", "Couldn’t save tiles: "]) assert.ok(p.includes(s), s);
  // F4: a failed Delete is worded by the WriteAction frame only, not by dashError as well
  assert.ok(read("components/settings/settings-widgets.tsx").includes("Couldn’t delete the widget"));
  assert.ok(!p.includes("Couldn’t delete the widget"));
});

test("K12: the settings PUT route merges through mergeDashPut and refuses with 400 before saveConfig", () => {
  const r = read("app/api/settings/route.ts");
  const put = r.slice(r.indexOf("mergeDashPut("));
  assert.ok(r.includes("mergeDashPut("), "route calls mergeDashPut(");
  assert.ok(put.indexOf("status: 400") > -1 && put.indexOf("status: 400") < put.indexOf("saveConfig("), "400 return before saveConfig(");
});

test("O1/F1: GET and the PUT reply both go through sanitizeConfig, which strips widget secrets with publicWidgets(", () => {
  const r = read("app/api/settings/route.ts");
  const fn = r.slice(r.indexOf("function sanitizeConfig("), r.indexOf("function sanitizeConfig(") + 400);
  assert.ok(fn.includes("widgets: publicWidgets(config.widgets"), "sanitizeConfig calls publicWidgets(");
  assert.ok(r.includes("config: sanitizeConfig(config)"), "GET body uses sanitizeConfig");
  assert.ok(r.includes("config: sanitizeConfig(merged.next)"), "PUT reply uses sanitizeConfig");
});

test("F1: a good Hermes daemon save re-seeds the drafts from the stored values", () => {
  const h = read("components/settings/settings-hermes.tsx");
  const i = h.indexOf('postJson("/api/settings/hermes-daemon"');
  assert.ok(i > 0);
  assert.match(h.slice(i, i + 200), /await mutate\(\);\s*setSeeded\(false\)/);
});
