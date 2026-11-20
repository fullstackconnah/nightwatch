import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("H100-6 the report passes the partial flag on, only when set", () => {
  const att = src("./attention.ts");
  assert.match(att, /const \{ lines, loggedFrom, partial \} = await readChangeLog\(/);
  assert.match(att, /\.\.\.\(partial \? \{ partial: true as const \} : \{\}\)/);
  assert.match(src("./attention-report.ts"), /loggedFrom: string \| null; partial\?: true \}/);
  assert.match(src("../components/home/changes-list.tsx"), /weekHeading\([^\n]*changes\?\.partial === true\)/);
});

test("polish5 the kiosk error line wraps with text-pretty", () => {
  assert.match(src("../components/kiosk/kiosk-voice.tsx"), /text-bad\/90 whitespace-pre-wrap break-words text-pretty"/);
});
