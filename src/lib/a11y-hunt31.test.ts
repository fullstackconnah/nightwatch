import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("F1 and create-container share the dialog focus hook", () => {
  assert.match(src("components/side-nav.tsx"), /^\s+const onKeyDown = useDialogFocus\(/m);
  assert.match(src("components/resources/create-container.tsx"), /^\s+const onTab = useDialogFocus\(/m);
  assert.match(src("components/side-nav.tsx"), /onKeyDown=\{onKeyDown\}/);
});

test("F2 widget menu is plain buttons, not role=menu", () => {
  const s = src("components/widget-actions.tsx");
  assert.doesNotMatch(s, /role="menu/);
  assert.doesNotMatch(s, /aria-haspopup="menu"/);
  assert.match(s, /data-action=\{action\.id\}/);
  assert.match(s, /autoFocus/);
});

test("F3 create-container names every row control", () => {
  const s = src("components/resources/create-container.tsx");
  for (const n of ["Host port", "Container port", "Protocol", "Variable name", "Variable value", "Host path", "Container path", "Remove port", "Remove variable", "Remove volume"]) {
    assert.ok(s.includes(`aria-label={\`${n} \${i + 1}\`}`), n);
  }
});

test("F4 inline confirms use the confirm-focus hook", () => {
  for (const f of ["resources/remove-container-action.tsx", "resources/image-delete-action.tsx", "resources/reclaim-shared.tsx"]) {
    const s = src(`components/${f}`);
    assert.match(s, /useConfirmFocus\(/, f);
    assert.match(s, /autoFocus/, f);
    assert.match(s, /onKeyDown=\{onKeyDown\}/, f);
  }
});

test("F5 log tail select has a name", () => {
  assert.match(src("app/(dash)/containers/[id]/page.tsx"), /aria-label="Lines to show"/);
});

test("F6 status dots are hidden from AT with the state in text", () => {
  assert.match(src("app/(dash)/networks/page.tsx"), /aria-hidden \/>\s*\n\s*<span className="sr-only">\{iface\.state\}/);
  assert.match(src("app/(dash)/resources/page.tsx"), /<span className="sr-only">\{c\.state\}<\/span>/);
  const pt = src("components/resources/process-table.tsx");
  assert.equal((pt.match(/<span className="sr-only">\{tone\.title\}<\/span>/g) ?? []).length, 2);
});
