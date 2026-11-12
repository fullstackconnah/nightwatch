import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("home controls: AppCard renders the house lifecycle buttons and error", () => {
  const s = src("components/home/app-card.tsx");
  assert.match(s, /^import \{[^}]*LifecycleActions[^}]*LifecycleError[^}]*useLifecycle[^}]*\} from "@\/components\/resources\/container-controls"/m);
  assert.match(s, /useLifecycle\(c\.id, onChanged\)/);
  assert.match(s, /<LifecycleActions state=\{c\.state\} name=\{c\.name\} lifecycle=\{lifecycle\}/);
  assert.match(s, /<LifecycleError lifecycle=\{lifecycle\}/);
});

test("home controls: the page's refresh is threaded page -> Launcher -> AppCard", () => {
  assert.match(src("app/(dash)/page.tsx"), /onChanged=\{\(\) => void mutate\(\)\}/);
  const l = src("components/home/launcher.tsx");
  assert.match(l, /onChanged: \(\) => void;/);
  assert.match(l, /<AppCard key=\{c\.id\} c=\{c\} widget=\{widgets\?\.\[c\.name\]\} onChanged=\{onChanged\} \/>/);
});

test("home controls: the redundant Resources lifecycle link is gone", () => {
  assert.doesNotMatch(src("components/home/launcher.tsx"), /lifecycle-link|Start, stop or restart in Resources/);
});

test("home controls: an open stop confirm gives the actions a full-width row", () => {
  const css = src("app/globals.css");
  assert.match(css, /\.hm-app:has\(\.nw-confirm\)\s*\{\s*grid-template-areas:\s*"main main" "acts acts" "fields fields" "err err";?\s*\}/);
  assert.match(css, /\.hm-app:has\(\.nw-confirm\) \.hm-app-acts\s*\{\s*justify-content:\s*flex-end;\s*align-items:\s*flex-start;[^\n]*\s*\}/);
});
