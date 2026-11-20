import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUDGET_HINT, RCON_PORT_COPY, appUrlError, groupInputText, rconPortFieldError } from "./settings-field-checks.ts";

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

test("P1: a budget over the cap is refused in the browser before the post; server texts name no field", () => {
  const src = read("../components/settings/settings-hermes.tsx");
  const refuse = src.indexOf("Daily budget: the most is $${MAX_BUDGET_USD}");
  assert.ok(refuse > 0 && refuse < src.indexOf('postJson("/api/settings/hermes-daemon"'));
  assert.ok(src.includes("n > MAX_BUDGET_USD"));
  const checks = read("./settings-checks.ts");
  assert.ok(!checks.includes("pipelineDailyBudgetUsd must"));
  assert.ok(checks.includes("`Daily budget must be at most ${MAX_BUDGET_USD}`"));
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

test("nw-tileurl: appUrlError names the first offender; saveTiles runs it before the PUT with the server's text", () => {
  assert.equal(appUrlError({ a: "http://a.lan", b: "myapp.lan:8080", c: "x" }), "The App URL for b must start with http:// or https://");
  assert.equal(appUrlError({ a: "https://a.lan/" + "a".repeat(2048) }), "The App URL for a is too long (the most is 2048 characters)");
  assert.equal(appUrlError({ a: " http://a.lan " }), null);
  assert.equal(appUrlError({}), null);
  const src = read("../app/(dash)/settings/page.tsx");
  const save = src.slice(src.indexOf("async function saveTiles"));
  assert.ok(save.indexOf("appUrlError(urls, data?.config.urls ?? {})") > 0 && save.indexOf("appUrlError(") < save.indexOf("persist("));
  assert.ok(read("./settings/dash-put.ts").includes("appUrlError("));
});

test("nw-tileurl fix1: appUrlError skips values equal to the stored one; saveTiles trims what it checks and sends", () => {
  const stored = { gone: "old.lan:80" };
  assert.equal(appUrlError({ gone: "old.lan:80", a: "http://a" }, stored), null);
  assert.equal(appUrlError({ gone: "other.lan:80" }, stored), "The App URL for gone must start with http:// or https://");
  assert.equal(appUrlError({ gone: "old.lan:80", b: "b.lan" }, stored), "The App URL for b must start with http:// or https://");
  const src = read("../app/(dash)/settings/page.tsx");
  const save = src.slice(src.indexOf("async function saveTiles"), src.indexOf("const tilesDirty"));
  assert.ok(save.includes("trim()") && save.includes("data?.config.urls") && save.includes("urls,"));
  assert.ok(!save.includes("urls: tileDraft.urls"));
  assert.ok(read("./settings/dash-put.ts").includes("current.urls"));
});
