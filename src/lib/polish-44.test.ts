import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// H162-2: a repeat save inside 2 s must re-announce and must not be cut short by the first timer.
for (const f of ["settings-access", "settings-integrations", "settings-hermes"]) {
  test(`${f}: saves go through useSavedFlash, no bare setSaved timer`, () => {
    const s = read(`components/settings/${f}.tsx`);
    assert.ok(!s.includes("setTimeout(() => setSaved(false)"), "bare timer left");
    assert.ok(!s.includes("setSaved(true)"), "direct setSaved(true) left");
    assert.match(s, /useSavedFlash\(\)/);
  });
}

test("useSavedFlash clears the previous timer, drops and refills the flag, and clears on unmount", () => {
  const s = read("components/settings/form-report.tsx");
  const hook = s.slice(s.indexOf("export function useSavedFlash"));
  assert.ok(hook.length > 0 && s.includes("export function useSavedFlash"));
  assert.ok((hook.match(/clearTimeout/g) ?? []).length >= 2, "clear before restart and on unmount");
  assert.match(hook, /setSaved\(false\)[\s\S]*setSaved\(true\)/);
});

// H165-1: the network page shows how old its (possibly kept) numbers are.
test("network page labels the snapshot age: CHECKED when fresh, STALE when an error keeps old numbers", () => {
  const s = read("app/(dash)/networks/page.tsx");
  assert.match(s, /relativeTime\(snapshot\.ts\)/);
  assert.ok(s.includes('"STALE · "') && s.includes('"CHECKED "'));
});

// H163-3: Hermes run errors are redacted before a person reads them.
test("hermes-ctl redacts the 409 and non-202 text", () => {
  const s = read("lib/hermes-ctl.ts");
  assert.match(s, /redactLogText\(errMsg\)\.slice\(0, 200\)/);
  assert.match(s, /redactLogText\(text\)\.slice\(0, 200\)/);
});
