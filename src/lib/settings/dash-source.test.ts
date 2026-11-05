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
  for (const s of ["Couldn’t save the widget: ", "Couldn’t delete the widget: ", "Couldn’t save tiles: "]) assert.ok(p.includes(s), s);
});
