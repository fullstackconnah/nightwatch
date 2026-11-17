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
  assert.match(sso, /const askPassword = authConfigured && seeded && ssoStepUpPending\(\{ issuer, clientId, clientSecret \}, sys \?\? \{\}\);/);
  assert.match(sso, /\{askPassword && \(\s*<StepUpField/);
  assert.match(sso, /disabled=\{saving \|\| \(askPassword && !password\)\}/);
});

test("a refusal goes to the footer: only the route's step-up tag counts, so a middleware 403 or a field 400 takes the normal error path", () => {
  assert.match(sys, /isStepUpRefusal\(e\)\) return stepUpFailed\(e\)/);
  assert.match(sys, /isStepUpRefusal\(e\)\) stepUpFailed\(e\);\s*else setError/);
  assert.match(sys, /e\.stepUp === "wrong"\) \{\s*setPassword\(""\);\s*passwordRef\.current\?\.focus\(\)/);
  assert.match(sso, /isStepUpRefusal\(e\) && e\.stepUp === "wrong"\) \{\s*setPassword\(""\);\s*passwordRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(src, /STEP_UP_STATUSES|e\.status === 403/);
});

test("the password hint no longer names the config file", () => {
  assert.ok(src.includes("stored on the server"));
  assert.doesNotMatch(src, /stored in config\.json/);
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
  assert.ok(!/data-1p-ignore/.test(sso + sys), "no password-manager vendor attributes");
});

test("secrets that are not the login password opt out of autofill; step-up and change-password keep theirs", () => {
  const integ = readFileSync(new URL("./settings-integrations.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const field = integ.slice(integ.indexOf("export function SecretField("), integ.indexOf("export function ClearAction"));
  assert.match(field, /type="password"\n\s+autoComplete="off"/);
  assert.match(sso, /<Input autoComplete="off" placeholder="http:\/\/homelab\.local:9091"/);
  assert.match(sso, /<Input autoComplete="off" placeholder="nightwatch"/);
  assert.equal(src.match(/autoComplete="current-password"/g)?.length, 2);
  assert.equal(src.match(/autoComplete="new-password"/g)?.length, 2);
});

test("the kiosk PIN hint names only controls the field has: Clear shows for a saved PIN, so only then does the hint say so", () => {
  assert.ok(sys.includes("Replace it to change the PIN, or clear it. KIOSK_PIN in the environment applies only when none is saved."));
  assert.match(sys, /pinSaved\s*\?\s*"Replace it to change the PIN, or clear it\./);
});

test("client.ts copies the route's step-up tag onto ApiError (dropping the third argument fails this)", () => {
  const client = readFileSync(new URL("../../lib/client.ts", import.meta.url), "utf8");
  assert.match(client, /new ApiError\([^;]*typeof data\.stepUp === "string" \? data\.stepUp : undefined\)/);
});

// The daemon card: Discord access asks for the password the way the SSO card does (the shared pending rule lives in lib/discord-step-up.ts).
const hermesSrc = readFileSync(new URL("./settings-hermes.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const daemonStart = hermesSrc.indexOf("function HermesDaemonCard(");
const daemon = hermesSrc.slice(daemonStart, hermesSrc.indexOf("\nfunction ", daemonStart + 10));

test("Daemon: the field shows only while Discord access is pending or after a refusal, and Save waits for it", () => {
  assert.match(daemon, /const pending =\s*authConfigured &&\s*seeded &&\s*discordStepUpNeeded\(/);
  assert.match(daemon, /const askPassword = stepUpAsked\(pending, askedAt, draftKey\);/);
  assert.match(daemon, /\{askPassword && \(\s*<StepUpField[^>]*hintId="discord-step-up-hint"/);
  assert.match(daemon, /disabled=\{saving \|\| \(askPassword && !password\)\}/);
  assert.match(daemon, /if \(askPassword\) body\.currentPassword = password;/);
});

test("Daemon: the pending check and the request share one allowlist split; any refusal shows the field, a wrong one empties and focuses it", () => {
  assert.equal(daemon.match(/splitUserIds\(allowedUserIds\)/g)?.length, 2);
  assert.doesNotMatch(daemon, /\.split\(","\)/);
  assert.match(daemon, /isStepUpRefusal\(e\)\) \{\s*setAskedAt\(draftKey\);\s*if \(e\.stepUp === "wrong"\) \{\s*setPassword\(""\);\s*passwordRef\.current\?\.focus\(\)/);
  assert.match(daemon, /setPassword\(""\);\s*setAskedAt\(null\);/);
});

test("Daemon: the final hint and the shared no-password warning, and the helpers are the exported originals", () => {
  assert.ok(daemon.includes('hint="Changing Discord access needs your current password."'));
  assert.match(daemon, /<p className="text-\[0\.7rem\] text-warn\/80">\{NO_PASSWORD_WARNING\}<\/p>/);
  assert.match(daemon, /<span className="text-\[0\.7rem\] text-bad">\{error\}<\/span>/);
  assert.match(src, /export const NO_PASSWORD_WARNING = /);
  assert.match(src, /export function StepUpField\(/);
  assert.doesNotMatch(hermesSrc, /function StepUpField|const NO_PASSWORD_WARNING/);
});
