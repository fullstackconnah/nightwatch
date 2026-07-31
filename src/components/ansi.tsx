"use client";

import * as React from "react";

/**
 * SGR (colour/style) escape rendering for the log console.
 *
 * Scope, per the measured hosts: 8 of 26 containers emit ANSI, and every byte
 * of it is SGR (`ESC[...m`). Nothing here emits cursor movement, carriage-return
 * redraws or the alternate screen, so this module only *parses* SGR — anything
 * else (`ESC[2K`, OSC title strings, bare `ESC` + one byte) is recognised just
 * well enough to be discarded without leaking digits/`[`/`m` into visible text.
 *
 * Control characters below are built with `String.fromCharCode` rather than
 * string-literal escapes: embedded (however spelled) in source, they are
 * invisible and easy to corrupt silently, so each codepoint is spelled out
 * once, in decimal, and reused everywhere.
 */

// ESC, the escape-sequence regex and the two predicates live in an import-free
// leaf module because the server needs them too (the level classifier strips
// escapes before matching). Re-exported here so client callers keep one import.
import { ANSI_SEQUENCE, ESC, hasAnsi, stripAnsi } from "@/lib/ansi-escapes";

export { hasAnsi, stripAnsi };

/* ---------------------------------------------------------------------- */
/* SGR parsing                                                            */
/* ---------------------------------------------------------------------- */

type ColorToken = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";

interface SgrState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg: ColorToken | null;
  fgBright: boolean;
  bg: ColorToken | null;
  bgBright: boolean;
}

const DEFAULT_STATE: SgrState = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  fg: null,
  fgBright: false,
  bg: null,
  bgBright: false,
};

/**
 * Colour mapping — the design decision this module exists for. Raw terminal
 * colours (`#00ff00`) never appear on screen; every ANSI colour is bent onto
 * this app's own "nightwatch" palette (`globals.css` `@theme` tokens) so a
 * coloured log line still belongs to the dark console it's rendered in:
 *   red -> --color-bad, green -> --color-ok, yellow -> --color-warn,
 *   blue -> --color-blue, magenta & cyan -> --color-accent (cyan is this app's
 *   own accent hue; magenta has no token of its own, so it borrows accent),
 *   white/default -> --color-ink, black -> --color-ink-faint.
 * Bright (90-97/100-107) reuses the same token rather than a brighter token
 * that doesn't exist; the distinction is rendered instead with
 * `filter: brightness(1.15)` on foreground text. `2` (dim) is the opposite
 * knob, `opacity: 0.75`, kept consistent regardless of which colour is active.
 */
const FG_VAR: Record<ColorToken, string> = {
  black: "var(--color-ink-faint)",
  red: "var(--color-bad)",
  green: "var(--color-ok)",
  yellow: "var(--color-warn)",
  blue: "var(--color-blue)",
  magenta: "var(--color-accent)",
  cyan: "var(--color-accent)",
  white: "var(--color-ink)",
};

const BASIC_FG: Record<number, ColorToken> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
};
const BASIC_BG: Record<number, ColorToken> = {
  40: "black",
  41: "red",
  42: "green",
  43: "yellow",
  44: "blue",
  45: "magenta",
  46: "cyan",
  47: "white",
};
const BRIGHT_FG: Record<number, ColorToken> = {
  90: "black",
  91: "red",
  92: "green",
  93: "yellow",
  94: "blue",
  95: "magenta",
  96: "cyan",
  97: "white",
};
const BRIGHT_BG: Record<number, ColorToken> = {
  100: "black",
  101: "red",
  102: "green",
  103: "yellow",
  104: "blue",
  105: "magenta",
  106: "cyan",
  107: "white",
};

const PALETTE_16: ColorToken[] = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** Buckets an approximate RGB triple onto one of the 8 base tokens by hue,
 * falling back to black/white for low-saturation (grey) colours. This is
 * intentionally coarse — 256-colour and truecolour params are consumed
 * correctly (see `applySgr`) but always resolved to one of the app's 8
 * palette tokens, never rendered as a raw hex colour. */
function classifyRgb(r: number, g: number, b: number): ColorToken {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  if (max - min < 24) return lightness < 0.5 ? "black" : "white";

  const d = max - min;
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;

  if (hue < 15 || hue >= 345) return "red";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 200) return "cyan";
  if (hue < 255) return "blue";
  if (hue < 345) return "magenta";
  return "red";
}

/** Resolves a 256-colour palette index (the `N` in `38;5;N`) to a token. */
function color256(n: number): { token: ColorToken; bright: boolean } {
  if (n < 8) return { token: PALETTE_16[n], bright: false };
  if (n < 16) return { token: PALETTE_16[n - 8], bright: true };
  if (n < 232) {
    const idx = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(idx / 36) % 6];
    const g = levels[Math.floor(idx / 6) % 6];
    const b = levels[idx % 6];
    return { token: classifyRgb(r, g, b), bright: false };
  }
  const level = 8 + (n - 232) * 10;
  return { token: level < 128 ? "black" : "white", bright: false };
}

/** Applies one SGR parameter list to a state, returning a new state. Handles
 * `38;5;N` / `48;5;N` and `38;2;r;g;b` / `48;2;r;g;b` by consuming exactly the
 * parameters they own (via the loop index `i`) even though the resulting
 * colour is only approximated — an under-consuming parser is what leaks
 * digits into the rendered text, which this is written to avoid. */
function applySgr(state: SgrState, params: number[]): SgrState {
  let next = state;
  for (let i = 0; i < params.length; i++) {
    const code = params[i];
    if (code === 0) {
      next = DEFAULT_STATE;
    } else if (code === 1) {
      next = { ...next, bold: true };
    } else if (code === 2) {
      next = { ...next, dim: true };
    } else if (code === 3) {
      next = { ...next, italic: true };
    } else if (code === 4) {
      next = { ...next, underline: true };
    } else if (code === 22) {
      next = { ...next, bold: false, dim: false };
    } else if (code === 23) {
      next = { ...next, italic: false };
    } else if (code === 24) {
      next = { ...next, underline: false };
    } else if (code === 39) {
      next = { ...next, fg: null, fgBright: false };
    } else if (code === 49) {
      next = { ...next, bg: null, bgBright: false };
    } else if (code >= 30 && code <= 37) {
      next = { ...next, fg: BASIC_FG[code], fgBright: false };
    } else if (code >= 40 && code <= 47) {
      next = { ...next, bg: BASIC_BG[code], bgBright: false };
    } else if (code >= 90 && code <= 97) {
      next = { ...next, fg: BRIGHT_FG[code], fgBright: true };
    } else if (code >= 100 && code <= 107) {
      next = { ...next, bg: BRIGHT_BG[code], bgBright: true };
    } else if (code === 38 || code === 48) {
      const isFg = code === 38;
      const mode = params[i + 1];
      if (mode === 5) {
        const { token, bright } = color256(params[i + 2] ?? 0);
        next = isFg ? { ...next, fg: token, fgBright: bright } : { ...next, bg: token, bgBright: bright };
        i += 2;
      } else if (mode === 2) {
        const token = classifyRgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        next = isFg ? { ...next, fg: token, fgBright: false } : { ...next, bg: token, bgBright: false };
        i += 4;
      }
      // Unknown extended-colour mode (neither 5 nor 2): nothing more to consume.
    }
    // Any other SGR code (e.g. 5 blink, 7 reverse) is recognised-but-ignored.
  }
  return next;
}

function styleFromState(state: SgrState): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (state.bold) style.fontWeight = 600;
  if (state.italic) style.fontStyle = "italic";
  if (state.underline) style.textDecoration = "underline";
  if (state.dim) style.opacity = 0.75;
  if (state.fg) {
    style.color = FG_VAR[state.fg];
    if (state.fgBright) style.filter = "brightness(1.15)";
  }
  if (state.bg) {
    style.backgroundColor = `color-mix(in srgb, ${FG_VAR[state.bg]} 22%, transparent)`;
  }
  return style;
}

interface AnsiSegment {
  text: string;
  style: React.CSSProperties;
}

/** Walks `text`, folding SGR sequences into running state and non-SGR escapes
 * into nothing, emitting one segment per style change. Pure function — also
 * duplicated (tokenizer only) into the scratchpad node test script. */
function segmentAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let state: SgrState = DEFAULT_STATE;
  let lastIndex = 0;
  const re = new RegExp(ANSI_SEQUENCE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), style: styleFromState(state) });
    }
    const [, paramsStr, final] = match;
    if (final === "m") {
      const params =
        paramsStr === undefined || paramsStr.length === 0
          ? [0]
          : paramsStr.split(";").map((p) => {
              const v = p.split(":")[0];
              return v === "" ? 0 : parseInt(v, 10);
            });
      state = applySgr(state, params);
    }
    // Non-SGR CSI, OSC, and bare-ESC sequences: silently discarded.
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: styleFromState(state) });
  }
  return segments;
}

/* ---------------------------------------------------------------------- */
/* Highlight                                                              */
/* ---------------------------------------------------------------------- */

interface HighlightPart {
  text: string;
  marked: boolean;
}

/** Splits `text` around every match of `highlight`, never mutating the caller's
 * regex (a fresh `g`-flagged clone is used) and never trusting `lastIndex`
 * across calls. Zero-length matches (e.g. a pattern like `x*`, which can match
 * an empty string) are guarded so they cannot spin forever — a non-advancing
 * match consumes one character as unmarked text and moves on. */
function splitHighlight(text: string, highlight: RegExp): HighlightPart[] {
  if (text.length === 0) return [{ text, marked: false }];
  const flags = highlight.flags.includes("g") ? highlight.flags : highlight.flags + "g";
  const re = new RegExp(highlight.source, flags);
  const parts: HighlightPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), marked: false });
    }
    if (match[0].length > 0) {
      parts.push({ text: match[0], marked: true });
      lastIndex = re.lastIndex;
    } else {
      if (match.index < text.length) {
        parts.push({ text: text[match.index], marked: false });
      }
      lastIndex = match.index + 1;
      re.lastIndex = lastIndex;
    }
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), marked: false });
  }
  return parts;
}

const MARK_STYLE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
  color: "inherit",
  borderRadius: "0.15em",
};

function renderParts(text: string, highlight: RegExp | null | undefined, keyPrefix: string): React.ReactNode {
  if (!highlight) return text;
  return splitHighlight(text, highlight).map((part, i) =>
    part.marked ? (
      <mark key={`${keyPrefix}-${i}`} style={MARK_STYLE}>
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{part.text}</React.Fragment>
    ),
  );
}

/* ---------------------------------------------------------------------- */
/* Component                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Renders one log line. With `ansi: false` it renders `stripAnsi(text)` as
 * plain text; with `ansi: true` it parses SGR into styled spans. Either way,
 * `highlight` (when non-null) wraps matches in `<mark>` *within* each segment,
 * so a match spanning a colour boundary highlights only the parts it covers.
 * No wrapper element — a `Fragment` — so the caller (which sets
 * `white-space: pre-wrap` on its own container) controls layout and spacing
 * is emitted verbatim, never trimmed or collapsed.
 */
export const AnsiText = React.memo(function AnsiText({
  text,
  ansi,
  highlight,
}: {
  text: string;
  ansi: boolean;
  highlight?: RegExp | null;
}) {
  if (!ansi) {
    return <>{renderParts(stripAnsi(text), highlight, "p")}</>;
  }

  const segments = segmentAnsi(text);
  return (
    <>
      {segments.map((seg, i) => {
        const hasStyle = Object.keys(seg.style).length > 0;
        const content = renderParts(seg.text, highlight, `s${i}`);
        return hasStyle ? (
          <span key={i} style={seg.style}>
            {content}
          </span>
        ) : (
          <React.Fragment key={i}>{content}</React.Fragment>
        );
      })}
    </>
  );
});
