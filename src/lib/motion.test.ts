import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}

/** Every JSX opening tag whose text holds `needle` (the tag ends at the first `>` outside braces that is not `=>`). */
function tagsWith(src: string, needle: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    const start = Math.max(src.lastIndexOf("<div", i), src.lastIndexOf("<span", i));
    let depth = 0;
    let end = i;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth <= 0 && src[end - 1] !== "=") break;
    }
    out.push(src.slice(start, end + 1));
  }
  return [...new Set(out)]; // a tag naming the token twice (class and the origin variable) is one root
}

const CONFIRM_ROOTS: Record<string, number> = {
  "components/resources/container-controls.tsx": 1,
  "components/resources/remove-container-action.tsx": 2,
  "components/resources/reclaim-shared.tsx": 2,
  "components/resources/image-delete-action.tsx": 2,
  "components/widget-actions.tsx": 2,
  "components/integrations/hermes-actions.tsx": 1,
  "components/strips/write-action.tsx": 2,
};

test("#1 nw-confirm sits on exactly the confirm and error roots, each with its own key", () => {
  let total = 0;
  for (const [file, n] of Object.entries(CONFIRM_ROOTS)) {
    const tags = tagsWith(read(file), "nw-confirm");
    assert.equal(tags.length, n, file);
    for (const t of tags) assert.match(t, /\bkey=/, `${file}: ${t.slice(0, 60)}`);
    total += tags.length;
  }
  assert.equal(total, 12);
  const all = walk(SRC).filter((f) => /nw-confirm/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length).replace(/\\/g, "/"));
  assert.deepEqual(all.sort(), Object.keys(CONFIRM_ROOTS).sort());
});

test("#6 the error roots carry data-kind=error", () => {
  const errors = ["remove-container-action", "reclaim-shared", "image-delete-action"].map((f) => `components/resources/${f}.tsx`);
  for (const f of [...errors, "components/strips/write-action.tsx"]) {
    assert.equal(tagsWith(read(f), "nw-confirm").filter((t) => /data-kind="error"/.test(t)).length, 1, f);
  }
});

test("#1 the left-aligned confirms set their origin inline", () => {
  for (const f of ["components/widget-actions.tsx", "components/integrations/hermes-actions.tsx"]) {
    assert.match(read(f), /"--nw-confirm-origin": "left center"/, f);
  }
});

test("#1 WriteAction wraps the default ask only when renderAsk is absent", () => {
  const src = read("components/strips/write-action.tsx");
  assert.match(src, /renderAsk \? "st-frame" : "st-frame nw-confirm"/);
});

test("#3 the widget menu panel is nw-pop", () => {
  assert.match(read("components/widget-actions.tsx"), /role="menu"[\s\S]{0,120}nw-pop/);
});

test("#2 the pills fade through data-on, not inline visibility", () => {
  for (const f of ["components/home/attention-list.tsx", "app/(dash)/minecraft/page.tsx"]) {
    const src = read(f);
    assert.match(src, /data-on=/, f);
    assert.doesNotMatch(src, /style=\{\{ visibility/, f);
  }
});

test("#4 both saved badges are always rendered and fade", () => {
  const src = read("components/settings/settings-access.tsx");
  assert.equal((src.match(/className="nw-fade"/g) ?? []).length, 2);
  assert.doesNotMatch(src, /\{saved && <Badge/);
});

test("F3 the Dashboard saved badge is out of the flow", () => {
  const src = read("app/(dash)/settings/page.tsx");
  assert.match(src, /className="relative space-y-5">\s*<Badge[^>]*nw-fade absolute -top-8 right-0/);
});

test("#5 and F7: the segment button presses, and both press scales release under reduced motion", () => {
  const seg = read("components/ui/segment-button.tsx");
  assert.match(seg, /active:scale-\[0\.98\]/);
  assert.match(seg, /motion-reduce:active:scale-100/);
  assert.match(read("components/ui/button.tsx"), /motion-reduce:active:scale-100/);
});

test("F1-F4, F8: no width or left transitions remain in tsx", () => {
  const hits = walk(SRC).flatMap((f) =>
    readFileSync(f, "utf8").split("\n").flatMap((l, i) => (/transition-\[(width|left)\]/.test(l) ? [`${f.slice(SRC.length)}:${i + 1}`] : [])),
  );
  assert.deepEqual(hits, []);
});

test("F1-F4, F8: the bar fills scale, and reduced motion drops the transition", () => {
  for (const f of [
    "app/(dash)/networks/page.tsx",
    "components/charts.tsx",
    "components/resources/process-table.tsx",
    "components/resources/drive-health.tsx",
    "components/smarthome/devices.tsx",
    "components/kiosk/kiosk-now-playing.tsx",
  ]) {
    const src = read(f);
    assert.match(src, /origin-left|translateX/, f);
    assert.match(src, /scaleX|translateX/, f);
  }
  for (const f of ["app/(dash)/networks/page.tsx", "components/charts.tsx", "components/resources/process-table.tsx"]) {
    assert.match(read(f), /motion-reduce:transition-none/, f);
  }
});

test("F5: the overview disclosure no longer transitions grid-template-rows", () => {
  assert.doesNotMatch(read("components/resources/resource-overview.tsx"), /grid-template-rows|grid-rows-\[/);
});

test("F6: every spinner or pulse in the listed files rests under reduced motion", () => {
  for (const f of [
    "components/resources/container-controls.tsx",
    "app/(dash)/containers/[id]/page.tsx",
    "components/kiosk/kiosk-admin-panel.tsx",
    "components/resources/disk-contents.tsx",
    "components/resources/disk-pinned.tsx",
    "components/resources/disk-scan-jobs.tsx",
  ]) {
    for (const l of read(f).split("\n")) {
      if (/animate-(spin|pulse)/.test(l)) assert.match(l, /motion-reduce:animate-none/, `${f}: ${l.trim()}`);
    }
  }
});

test("M2: the kiosk timer chip pulses 30 times then holds; the panel never pulses", () => {
  const src = read("components/kiosk/kiosk-timers.tsx");
  assert.match(src, /animate-\[pulse_2s_cubic-bezier\(0\.4,0,0\.6,1\)_30\]/);
  assert.match(src, /_30\][^\n]*motion-reduce:animate-none|motion-reduce:animate-none[^\n]*_30\]/);
  assert.doesNotMatch(src, /finished && "animate-pulse/);
});

test("F9: the mic keyframes never animate box-shadow, and the reduced block keeps a ring", () => {
  const css = read("app/globals.css");
  const kf = css.match(/@keyframes voice-mic-pulse\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(kf.length > 0);
  assert.doesNotMatch(kf, /box-shadow/);
  assert.match(css, /\.voice-mic-recording::after/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.voice-mic-recording\s*\{[^}]*box-shadow/);
});

test("the motion block closes globals.css, unlayered, after the .hm reduced rule", () => {
  const css = read("app/globals.css");
  const at = css.indexOf("/* nw motion */");
  assert.ok(at > css.lastIndexOf(".hm * {"), "block comes after the .hm * rule");
  const tail = css.slice(at);
  for (const sel of [".nw-confirm", ".nw-pop", ".nw-fade", ".hm-pill", ".st-pill", ".dk-new"]) assert.ok(tail.includes(sel), sel);
  assert.match(tail, /@starting-style\s*\{\s*\.nw-confirm/);
  assert.doesNotMatch(tail, /@layer/);
  assert.doesNotMatch(tail, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(tail, /transition:\s*all|transition-property:\s*all/);
});
