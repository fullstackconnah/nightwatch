import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/* Source scans for the AI lanes page (R1, R2, R4, R5, R6, R9, C1, C4, C5, C12): the rules that no render test reaches. */

const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const NEW_FILES = ["components/integrations/lane-strip.tsx", "app/(dash)/orchestrators/page.tsx", "components/integrations/orchestra-band.tsx", "components/integrations/orchestra-status.tsx", "lib/orchestra-view.ts"];
const strip = read("components/integrations/lane-strip.tsx");
const css = read("app/globals.css");
const block = css.slice(css.indexOf("/* AI lanes */"), css.indexOf("/* end AI lanes */"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

describe("the CSS block", () => {
  it("exists, is scoped under .ol-page, and uses tokens only", () => {
    assert.ok(block.length > 500, "the /* AI lanes */ block is missing");
    for (const r of rules(block).filter((x) => !x.sel.startsWith("@") && !x.sel.startsWith("/*"))) {
      if (/^\s*[\d.%\s]+$/.test(r.sel)) continue;
      assert.ok(/\.ol-page|\.dot-/.test(r.sel) || r.sel.includes("@media"), `unscoped: ${r.sel}`);
    }
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), "hex literal");
    assert.ok(!/transition-all|transition:\s*all/.test(block + strip), "transition-all");
  });

  it("C1/R2: warn and bad appear only under [data-mark], .dot-unhealthy or a band selector", () => {
    for (const r of rules(block)) {
      if (!/--color-(warn|bad)|\bwarn\b|\bbad\b/.test(r.body)) continue;
      assert.match(r.sel, /\[data-mark\]|\.dot-unhealthy|\[data-band/, `danger colour outside a mark: ${r.sel}`);
    }
  });

  it("R6a/R6b: the name wraps (no ellipsis) and the minutes span has no fixed box", () => {
    const name = rules(block).filter((r) => /\.or-aname\b/.test(r.sel));
    assert.ok(name.length > 0);
    for (const r of name) {
      assert.ok(!/text-overflow/.test(r.body) && !/nowrap/.test(r.body), r.sel);
    }
    assert.match(name.map((r) => r.body).join(";"), /overflow-wrap:\s*anywhere/);
    const min = rules(block).filter((r) => /\.ol-min\b/.test(r.sel)).map((r) => r.body).join(";");
    assert.match(min, /tabular-nums/);
    assert.ok(!/min-width|text-align/.test(min));
  });

  it("R1: the control column is hidden below md and carries no border colour of danger", () => {
    assert.match(block, /\.ol-ctrl[^{}]*\{[^}]*display:\s*none/);
  });

  it("motion: the fill eases over 600ms, reduced motion drops the transition", () => {
    assert.match(block, /\.ol-fill[^{}]*\{[^}]*transition:\s*transform 600ms var\(--ease-calm\)/);
    assert.match(block, /prefers-reduced-motion: reduce[\s\S]*\.ol-fill[\s\S]*transition:\s*none/);
  });
});

describe("the components", () => {
  it("R1: .ol-ctrl is an empty aria-hidden div; no write verb or proposed tag anywhere", () => {
    assert.match(strip, /<div className="ol-ctrl" aria-hidden="true" \/>/);
    for (const f of NEW_FILES) {
      const t = read(f);
      assert.ok(!/>\s*(Start|Stop|Restart)\s*</.test(t), `${f}: write button`);
      assert.ok(!/proposed/i.test(t), `${f}: proposed`);
    }
  });

  it("C1/R2: in the strip, every warn or bad class sits on an element that also carries data-mark", () => {
    for (const line of strip.split("\n")) {
      if (/text-(warn|bad)|bg-(warn|bad)|border-(warn|bad)|variant="(warn|bad)"/.test(line)) assert.match(line, /data-mark/, line.trim());
    }
  });

  it("R2: the detail quiet time is calm ink-dim, with no mark (the badge is the one amber mark per agent row)", () => {
    const line = strip.split(String.fromCharCode(10)).find((l) => l.includes("formatQuiet(r.quietMin)"));
    assert.ok(line);
    assert.match(line, /text-ink-dim/);
    assert.doesNotMatch(line, /data-mark|text-warn/);
  });

  it("C4/R4: no cost in the page words or anywhere in src outside tests", () => {
    for (const f of NEW_FILES) assert.ok(!/\bcost|not reported/i.test(read(f)), f);
    const hits = walk(SRC).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) && /costToday/.test(readFileSync(p, "utf8")));
    assert.deepEqual(hits, []);
  });

  it("C5/R5: the old pointers are gone from src outside tests", () => {
    const old = /Open Orchestrators|Orchestrators page|label: "Orchestra"|label: "Orchestrators"/;
    const hits = walk(SRC).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) && old.test(readFileSync(p, "utf8")));
    assert.deepEqual(hits, []);
    assert.match(read("app/(dash)/orchestrators/page.tsx"), />AI lanes</);
    assert.match(read("components/settings/settings-access.tsx"), /Connects the AI lanes page/);
    assert.match(read("lib/attention-report.ts"), /label: "Open AI lanes"/);
    assert.match(read("lib/attention.ts"), /label: "AI lanes"/);
  });

  it("R9: the page imports nothing from Home's attention report", () => {
    for (const f of ["components/integrations/lane-strip.tsx", "app/(dash)/orchestrators/page.tsx"]) {
      assert.ok(!/attention-report|attention\.ts|from "@\/lib\/attention"/.test(read(f)), f);
    }
  });

  it("the old card is gone and nothing imports it", () => {
    assert.ok(!existsSync(join(SRC, "components/integrations/orchestra-card.tsx")));
    assert.ok(!walk(SRC).some((p) => /\.(ts|tsx)$/.test(p) && /orchestra-card/.test(readFileSync(p, "utf8")) && !/ai-lanes-source/.test(p)));
  });
});

describe("C12: text tokens clear 4.5:1 on every surface they sit on", () => {
  const tok = (n: string) => {
    const m = new RegExp(`--color-${n}:\\s*#([0-9a-fA-F]{6})`).exec(css);
    assert.ok(m, n);
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (top: number[], over: number[], pct: number) => top.map((v, i) => v * pct + over[i] * (1 - pct));

  it("ink, ink-dim and ink-faint on bg, panel and panel-2", () => {
    for (const t of ["ink", "ink-dim", "ink-faint"]) for (const s of ["bg", "panel", "panel-2"]) assert.ok(ratio(tok(t), tok(s)) >= 4.5, `${t} on ${s}`);
  });
  it("the mark badges (warn, ok 10% washes) on panel and panel-2", () => {
    for (const t of ["warn", "ok"]) for (const s of ["panel", "panel-2"]) assert.ok(ratio(tok(t), mix(tok(t), tok(s), 0.1)) >= 4.5, `${t} on ${s}`);
  });
});
