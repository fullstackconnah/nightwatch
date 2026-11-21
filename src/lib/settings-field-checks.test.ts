import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plainReason } from "./settings/page-model.ts";
import { BUDGET_HINT, budgetFieldError, MAX_PASSWORD_BYTES, RCON_PORT_COPY, appUrlError, appUrlOffender, groupInputText, isPasswordOverBytes, passwordFieldHints, rconPortFieldError } from "./settings-field-checks.ts";

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
  const refuse = src.indexOf("budgetFieldError(pipelineBudget, daemon?.pipelineDailyBudgetUsd)");
  assert.ok(refuse > 0 && refuse < src.indexOf('postJson("/api/settings/hermes-daemon"'));
  assert.equal(budgetFieldError("1001", 5), "Daily budget: the most is $1000");
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

test("password 72-byte limit: measured in UTF-8 bytes, not characters", () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(isPasswordOverBytes(""), false);
  assert.equal(isPasswordOverBytes("a".repeat(72)), false);
  assert.equal(isPasswordOverBytes("a".repeat(73)), true);
  assert.equal(isPasswordOverBytes("\u{1F600}".repeat(18)), false); // 72 bytes
  assert.equal(isPasswordOverBytes("\u{1F600}".repeat(19)), true); // 76 bytes
});

test("password 72-byte limit: the route refuses before hashing; the card disables Save and shows the copy", () => {
  const route = read("../app/api/settings/password/route.ts");
  const tooLong = route.indexOf("isPasswordOverBytes(newPassword)");
  assert.ok(tooLong > route.indexOf("newPassword.length < MIN_LENGTH"));
  assert.ok(tooLong < route.indexOf("bcrypt.hashSync("));
  assert.match(route, /"New password is too long: the most is 72 bytes"[^]{0,40}status: 400/);
  assert.ok(tooLong < route.indexOf("checkCurrentPassword("), "a too-long request must not use up a rate-limiter attempt");
  const sent = /isPasswordOverBytes\(newPassword\)[^]*?error: "([^"]+)"/.exec(route)![1];
  assert.equal(plainReason(sent), sent.replace(/\.$/, "")); // the form shows the server's own words, not "the server refused it"
  const ui = read("../components/settings/settings-access.tsx");
  assert.match(ui, /const \{[^}]*tooLong[^}]*\} = passwordFieldHints\(/); // tooLong is isPasswordOverBytes(next) inside the helper (polish12)
  assert.match(ui, /canSubmit = [^;]*!tooLong/);
  assert.ok(ui.includes("Too long: the most is 72 bytes (72 plain letters, fewer with accents or emoji)."));
  assert.ok(!/isPasswordOverBytes\(current\)/.test(ui), "the current password is never length-checked");
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

test("polish11: a stored URL with spaces round it is unchanged when the trimmed draft matches; real changes and odd stored types are safe", () => {
  assert.equal(appUrlError({ a: "ftp://x" }, { a: " ftp://x " }), null);
  assert.equal(appUrlError({ a: " ftp://x " }, { a: "ftp://x" }), null);
  assert.equal(appUrlError({ a: "ftp://y" }, { a: "ftp://x" }), "The App URL for a must start with http:// or https://");
  assert.equal(appUrlError({ a: "ftp://y" }, { a: " ftp://x " }), "The App URL for a must start with http:// or https://");
  for (const odd of [5, null, { x: 1 }, undefined]) {
    assert.equal(appUrlError({ a: "http://a.lan" }, { a: odd }), null);
    assert.equal(appUrlError({ a: "ftp://x" }, { a: odd }), "The App URL for a must start with http:// or https://");
  }
});

test("polish11: the password fields' Save-blocking messages use the house error tone", () => {
  const src = read("../components/settings/settings-access.tsx");
  assert.equal(src.match(/errorClassName="text-bad"/g)?.length, 2);
});

test("polish12: appUrlOffender names the offending tile key, null when none or unchanged", () => {
  assert.equal(appUrlOffender({ a: "http://a.lan", b: "myapp.lan:8080", c: "x" }), "b");
  assert.equal(appUrlOffender({ a: "https://a.lan/" + "a".repeat(2048) }), "a");
  assert.equal(appUrlOffender({ a: "bad" }, { a: "bad" }), null);
  assert.equal(appUrlOffender({ a: " bad " }, { a: "bad" }), null);
  assert.equal(appUrlOffender({}), null);
  assert.equal(appUrlOffender({ a: "bad" }, { a: 42 }), "a");
  assert.equal(appUrlOffender({ a: "http://a.lan" }, { a: 42 }), null);
  assert.equal(appUrlOffender({ a: 42 }, { a: 42 }), null);
  assert.equal(appUrlOffender({ a: 42 }, { a: "x" }), "a");
});

test("polish12: password errors wait for their own field's first blur; too long shows at once", () => {
  const f = (p: Partial<Parameters<typeof passwordFieldHints>[0]>) =>
    passwordFieldHints({ next: "", confirm: "", nextTouched: false, confirmTouched: false, ...p });
  assert.deepEqual(f({}), { tooShort: false, tooLong: false, mismatch: false });
  assert.deepEqual(f({ next: "abc", confirm: "x" }), { tooShort: false, tooLong: false, mismatch: false });
  assert.deepEqual(f({ next: "abc", nextTouched: true }), { tooShort: true, tooLong: false, mismatch: false });
  assert.equal(f({ next: "", nextTouched: true }).tooShort, false); // blank stays a hint, not an error
  assert.equal(f({ next: "abc", nextTouched: true }).tooShort, true);
  assert.equal(f({ next: "abcdefgh", nextTouched: true }).tooShort, false);
  assert.deepEqual(f({ next: "é".repeat(37) }), { tooShort: false, tooLong: true, mismatch: false });
  assert.deepEqual(f({ next: "abcdefgh", confirm: "abcdefgx" }), { tooShort: false, tooLong: false, mismatch: false });
  assert.deepEqual(f({ next: "abcdefgh", confirm: "abcdefgx", confirmTouched: true }), { tooShort: false, tooLong: false, mismatch: true });
  assert.equal(f({ next: "abcdefgh", confirm: "", confirmTouched: true }).mismatch, false);
  assert.equal(f({ next: "abcdefgh", confirm: "abcdefgh", confirmTouched: true }).mismatch, false);
  assert.equal(f({ next: "abc", confirm: "x", confirmTouched: true, nextTouched: true }).mismatch, false);
  assert.equal(f({ next: "é".repeat(37), confirm: "x", confirmTouched: true }).mismatch, false);
});

test("polish12: the refused App URL is marked invalid on both layouts and the mark is derived from the refused value", () => {
  const page = read("../app/(dash)/settings/page.tsx");
  assert.ok(page.includes("appUrlOffender(urls,") && page.includes("invalidUrl="));
  assert.ok(page.includes("tileDraft.urls[refusedUrl.name] === refusedUrl.value"));
  const tiles = read("../components/settings/settings-tiles.tsx");
  assert.equal(tiles.match(/aria-invalid=\{invalidUrl === name \|\| undefined\}/g)?.length, 2);
  assert.ok(read("../components/ui/input.tsx").includes('children.props["aria-invalid"]'));
});

test("budgetFieldError: an unchanged stored cap above the max is not refused; any other value over it is", () => {
  assert.equal(budgetFieldError("5000", 5000), null);
  assert.equal(budgetFieldError("5000.0", 5000), null);
  assert.ok(budgetFieldError("6000", 5000));
  assert.ok(budgetFieldError("1001", 500));
  for (const stored of ["abc", null, undefined, NaN, {}]) assert.ok(budgetFieldError("1001", stored));
  assert.equal(budgetFieldError("", 5000), null);
  assert.equal(budgetFieldError("  ", undefined), null);
  assert.ok(budgetFieldError("1e9", 500));
  assert.ok(budgetFieldError("-1", 500));
  assert.ok(budgetFieldError("abc", 500));
  assert.equal(budgetFieldError("1000", 5), null);
});

test("budgetFieldError: only plain decimal text is a budget (no hex, binary, exponent, bare dot or separators)", () => {
  const bad = "Daily budget must be a non-negative number";
  for (const t of ["-1", "abc", "0x10", "0b11", "1e2", ".5", "5.", "1,000", "1 000"]) assert.equal(budgetFieldError(t, 5), bad, t);
  for (const t of ["12", "12.5", " 12 "]) assert.equal(budgetFieldError(t, 5), null, t);
  for (const t of ["", "   "]) assert.equal(budgetFieldError(t, 5), null, t);
});
