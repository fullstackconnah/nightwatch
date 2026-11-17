import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Routes import "@/" and can't load under node:test, so scan their source.
const sys = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const pw = readFileSync(new URL("../password/route.ts", import.meta.url), "utf8");
const at = (s: string, needle: string) => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

test("system route: the gate sits after the last field 400 and before every save, sync and token echo", () => {
  const gate = at(sys, "checkCurrentPassword(");
  assert.ok(at(sys, "stepUpNeeded(") < gate);
  assert.ok(at(sys, "outside.error") < at(sys, "stepUpNeeded("));
  for (const later of ["saveConfig(next)", "syncHermesMcpToken(mcpToken)", "generatedMcpToken: generated"]) {
    assert.ok(gate < at(sys, later), later);
  }
  assert.match(sys, /candidatePasswordHashes\(\)/);
});

test("system route: wrong is 403, missing 400, locked 429, with the final copy, and never 401", () => {
  assert.match(sys, /Current password is incorrect\.[^]{0,80}status: 403/);
  assert.match(sys, /Enter your current password to change this\.[^]{0,80}status: 400/);
  assert.match(sys, /Too many attempts\. Wait a minute and try again\.[^]{0,80}status: 429/);
  assert.doesNotMatch(sys, /status: 401/);
});

test("system route: each step-up refusal carries its stepUp tag so the client can tell it from a middleware 403", () => {
  assert.match(sys, /Current password is incorrect\.", stepUp: "wrong"/);
  assert.match(sys, /Enter your current password to change this\.", stepUp: "missing"/);
  assert.match(sys, /Too many attempts\. Wait a minute and try again\.", stepUp: "limited"/);
});

test("system route: a typed currentPassword that is not a string counts as missing", () => {
  assert.match(sys, /typeof body\.currentPassword === "string" \? body\.currentPassword : ""/);
});

test("system route: the helper gets the route's trimmed values, not the raw body", () => {
  assert.match(sys, /stepUpNeeded\(\s*\{[^}]*typedMcpToken[^}]*typedKioskPin[^}]*typedOidcClientSecret[^}]*oidcIssuer[^}]*oidcClientId/);
  assert.doesNotMatch(sys, /stepUpNeeded\(body/);
});

test("system route: the call site names every input of the helper, so dropping one fails", () => {
  const helper = readFileSync(new URL("../../../../lib/step-up.ts", import.meta.url), "utf8");
  const inputs = [...(helper.match(/interface StepUpChange \{([^}]*)\}/)?.[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  assert.equal(inputs.length, 9, "helper inputs read from the interface");
  const call = sys.match(/stepUpNeeded\(\s*\{([^}]*)\}/)?.[1] ?? "";
  for (const name of inputs) assert.match(call, new RegExp(`(^|[\\s,])${name}\\b`), `route does not pass ${name}`);
});

test("password route: shared helper and limiter, own limiter gone, contract byte-identical", () => {
  assert.match(pw, /checkCurrentPassword\(/);
  assert.match(pw, /currentPasswordLimiter/);
  assert.doesNotMatch(pw, /createAttemptLimiter\(\)/);
  for (const s of [
    "Current password is required",
    "Too many attempts — wait a minute",
    "Current password is incorrect",
    "No admin password is configured yet — set ADMIN_PASSWORD_HASH in the environment first, then it can be rotated here.",
  ]) assert.ok(pw.includes(s), s);
  assert.match(pw, /Current password is incorrect[^]{0,60}status: 401/);
  // the new-password length check stays before the helper call
  assert.ok(at(pw, "New password must be at least") < at(pw, "checkCurrentPassword("));
});

test("system route: no await sits between the load that feeds the saved object and saveConfig", () => {
  const load = sys.lastIndexOf("loadConfigForSave()");
  const save = at(sys, "saveConfig(next)");
  assert.ok(load > at(sys, "checkCurrentPassword("), "the load feeding next comes after the step-up await");
  assert.doesNotMatch(sys.slice(load, save), /\bawait\b/);
});
