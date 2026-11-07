import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUDGET_HINT, RCON_PORT_COPY, groupInputText, rconPortFieldError } from "./settings-field-checks.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("A1: the widget editor is keyed by the widget id so switching reseeds the draft", () => {
  const src = read("../components/settings/settings-widgets.tsx");
  assert.match(src, /<WidgetEditor\s+key=\{editing\.id\}/);
});

test("A2: group input keeps the raw typed text; a trailing space survives", () => {
  assert.equal(groupInputText("media ", "media"), "media ");
  assert.equal(groupInputText(undefined, "media"), "media");
  assert.equal(groupInputText("other", "media"), "media");
  assert.equal(groupInputText("  ", ""), "  ");
  const src = read("../components/settings/settings-tiles.tsx");
  assert.ok(src.includes("groupInputText("));
  assert.ok(src.includes("e.target.value.trim()"));
});

test("A5: budget hint copy comes from MAX_BUDGET_USD", () => {
  assert.equal(BUDGET_HINT, "Blank keeps the current cap. It can't be removed; the most is $1000.");
  assert.ok(read("../components/settings/settings-hermes.tsx").includes("hint={BUDGET_HINT}"));
});

test("A6: rcon port field error", () => {
  for (const ok of ["", "  ", "1", "25575", "65535"]) assert.equal(rconPortFieldError(ok), null, ok);
  for (const bad of ["abc", "0", "70000", "65536", "1.5", "-1", "1e3", "0x10"]) assert.equal(rconPortFieldError(bad), RCON_PORT_COPY, bad);
  const src = read("../components/settings/settings-integrations.tsx");
  assert.ok(src.includes("rconPortFieldError(rconPort)"));
});

test("A7: no per-section 'saved' stamp claims beyond its own section", () => {
  const src = read("../components/settings/settings-access.tsx");
  // one read (the system card, which owns the block stamp); orchestra and OIDC sections no longer read it
  assert.equal(src.split("system.updatedAt").length - 1, 1);
});
