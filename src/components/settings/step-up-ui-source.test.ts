import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The component imports "@/" and can't load under node:test, so scan its source (LF-normalised).
const src = readFileSync(new URL("./settings-access.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const card = (name: string) => {
  const a = src.indexOf(`function ${name}(`);
  assert.ok(a >= 0, name);
  const next = src.indexOf("\nfunction ", a + 10);
  return src.slice(a, next < 0 ? undefined : next);
};
const sso = card("SsoCard");
const sys = card("SystemConfigCard");

test("both cards send currentPassword on every /api/settings/system call and never use own401", () => {
  assert.match(sys, /generateMcpToken: true, currentPassword: password/);
  assert.match(sys, /body\.currentPassword = password/);
  assert.match(sso, /body\.currentPassword = password/);
  assert.doesNotMatch(sso + sys, /own401/);
});

test("System: Generate and Save wait for the password; the hint is wired to Generate", () => {
  assert.match(sys, /disabled=\{authConfigured && !password\}/);
  assert.match(sys, /describedBy="system-step-up-hint"/);
  assert.match(sys, /\(authConfigured && !password\)\} onClick=\{handleSave\}/);
});

test("SSO: the field shows only while a protected change is pending, and Save waits for it", () => {
  assert.match(sso, /const askPassword = dirty && authConfigured;/);
  assert.match(sso, /\{askPassword && \(\s*<StepUpField/);
  assert.match(sso, /disabled=\{saving \|\| \(askPassword && !password\)\}/);
});

test("a refusal goes to the footer: Generate does not rethrow a step-up status, 403 clears and focuses the field", () => {
  assert.match(sys, /STEP_UP_STATUSES\.includes\(e\.status\)\) return stepUpFailed\(e\)/);
  assert.match(sys, /e\.status === 403\) \{\s*setPassword\(""\);\s*passwordRef\.current\?\.focus\(\)/);
  assert.match(sso, /e\.status === 403\) \{\s*setPassword\(""\);\s*passwordRef\.current\?\.focus\(\)/);
  assert.match(src, /STEP_UP_STATUSES = \[400, 403, 429\]/);
});

test("the step-up input is the only one with current-password; only it carries the field, with the final copy", () => {
  assert.match(src, /<Input ref=\{inputRef\} type="password" autoComplete="current-password"/);
  assert.ok(src.includes('<Field label="Current password" required describedBy={hintId}>'));
  assert.ok(src.includes("Changing sign-in settings needs your current password."));
  assert.ok(src.includes("Needed to generate a token or save anything in this card."));
  assert.ok(src.includes("No admin password is set, so changes here don't ask for one. Set ADMIN_PASSWORD_HASH to protect them."));
});

test("numeric checks that need no browser: hint, warning and error lines share kiosk-pin-hint's size; error stays text-bad", () => {
  assert.match(src, /<p id=\{hintId\} className="mt-1 text-\[0\.7rem\] text-ink-faint">/);
  assert.equal(src.match(/<p className="text-\[0\.7rem\] text-warn\/80">\{NO_PASSWORD_WARNING\}<\/p>/g)?.length, 2);
  for (const c of [sso, sys]) assert.match(c, /<span className="text-\[0\.7rem\] text-bad">\{error\}<\/span>/);
  assert.ok(!/(autoComplete="off"|data-1p-ignore)/.test(sso + sys), "autofill attributes are out of scope here");
});
