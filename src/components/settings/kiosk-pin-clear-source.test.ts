import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The component imports "@/" and can't load under node:test, so scan its source (LF-normalised).
const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const src = read("./settings-access.tsx");
const a = src.indexOf("function SystemConfigCard(");
const sys = src.slice(a, src.indexOf("\nfunction ", a + 10));
const clearFn = sys.slice(sys.indexOf("async function clearPin()"), sys.indexOf("async function handleSave()"));

test("the clear request carries clearKioskPin and the current password, and nothing else", () => {
  assert.ok(clearFn.length > 0, "clearPin exists");
  assert.match(clearFn, /postJson\("\/api\/settings\/system", \{ clearKioskPin: true, currentPassword: password \}\)/);
  assert.doesNotMatch(clearFn, /mcpToken|kioskPin:|generateMcpToken|pinDraft|mcpDraft/);
});

test("the control is the house ClearAction, shown only for a saved PIN, held until the password is typed", () => {
  assert.match(sys, /const pinSaved = data\?\.system\.kioskPinSaved \?\? false;/);
  assert.match(sys, /action=\{\s*pinSaved &&\s*\(\s*<ClearAction[\s\S]*?run=\{clearPin\}/);
  const use = sys.slice(sys.indexOf("<ClearAction"), sys.indexOf("run={clearPin}"));
  assert.match(use, /disabled=\{authConfigured && !password\}/);
  assert.match(use, /describedBy="system-step-up-hint"/);
  assert.match(use, /ariaLabel="Clear kiosk PIN"/);
  assert.match(use, /failure="Couldn’t clear the PIN"/);
  assert.equal((src.match(/<ClearAction/g) ?? []).length, 2, "one for the Orchestra token, one here; no second component");
});

test("a step-up refusal goes to the footer like Generate; success refreshes and empties the password, typed PIN text stays", () => {
  assert.match(clearFn, /isStepUpRefusal\(e\)\) return stepUpFailed\(e\)/);
  assert.match(clearFn, /await mutate\(\);\s*setPassword\(""\);/);
  assert.match(clearFn, /throw new Error\(/);
});

test("the confirm question and the hint say the true consequence for each state", () => {
  assert.ok(src.includes("Removes the saved kiosk PIN. The kiosk then uses KIOSK_PIN from the environment if one is set, and stays locked if not."));
  assert.ok(sys.includes("Replace it to change the PIN, or clear it. KIOSK_PIN in the environment applies only when none is saved."));
  assert.ok(sys.includes("This PIN comes from KIOSK_PIN in the environment. A PIN saved here replaces it."));
  assert.ok(sys.includes("No PIN set — kiosk elevation stays locked until you save one."));
});

test("ClearAction passes disabled and describedBy through to WriteAction; SecretField reopens its input when the secret goes away", () => {
  const integ = read("./settings-integrations.tsx");
  const c = integ.slice(integ.indexOf("export function ClearAction"), integ.indexOf("const clearSay"));
  assert.match(c, /disabled=\{disabled\}/);
  assert.match(c, /describedBy=\{describedBy\}/);
  assert.match(integ, /setReplacing\(!configured\)/);
});

test("the label row wraps, so an open ask frame takes its own row and the label stays on one line", () => {
  const integ = read("./settings-integrations.tsx");
  assert.match(integ, /className="flex flex-wrap items-center justify-between gap-2 mb-1"/);
  assert.match(integ, /<Label id=\{labelId\} htmlFor=\{id\} className="mb-0 whitespace-nowrap">/);
});

test("the ask frame takes focus on open (Cancel) and hands it back to the trigger on Cancel or Escape", () => {
  const w = read("../strips/write-action.tsx");
  assert.match(w, /<Button autoFocus aria-describedby=\{sayId\} size="sm" variant="ghost" onClick=\{cancel\}>/);
  assert.match(w, /const cancel = \(\) => \{\s*refocus\.current = true;\s*setPhase\("idle"\);/);
  assert.match(w, /if \(phase === "idle" && refocus\.current\) \{[\s\S]*?trigger\.current\?\.focus\(\)/);
  assert.match(w, /e\.key === "Escape"[\s\S]*?cancel\(\)/);
});

test("Orchestra: a token that comes from the environment says so, beside the field, and Clear stays tied to a saved one", () => {
  const o = src.slice(src.indexOf("function OrchestraSettingsCard("), src.indexOf("\nfunction ", src.indexOf("function OrchestraSettingsCard(") + 10));
  assert.match(o, /const tokenFromEnv = Boolean\(data\?\.meta\.orchestraTokenSet\) && !data\?\.meta\.orchestraTokenSaved;/);
  assert.match(o, /describedBy=\{tokenFromEnv \? "orchestra-token-hint" : undefined\}/);
  assert.match(o, /\{tokenFromEnv && \(\s*<p id="orchestra-token-hint" className="text-\[0\.7rem\] text-ink-faint -mt-2">\s*Using the token from the server environment\. Entering one here replaces it\.\s*<\/p>\s*\)\}/);
  assert.match(o, /\{data\?\.meta\.orchestraTokenSaved \? \(\s*<ClearAction/);
});
