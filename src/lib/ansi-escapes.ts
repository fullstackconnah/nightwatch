/**
 * ANSI escape recognition, shared by the client renderer and the server.
 *
 * Deliberately import-free and NOT marked `"use client"`. It lives here rather
 * than in `src/components/ansi.tsx` because both sides need it: the browser
 * renders SGR colour, and the server's level classifier has to strip escapes
 * before matching a line's level token. Importing it from the client module
 * instead throws at runtime — "Attempted to call stripAnsi() from the server but
 * stripAnsi is on the client" — and neither `tsc` nor the webpack build catches
 * that, so it surfaced only as every scrollback seed failing against a live
 * host. One implementation, no boundary to cross.
 *
 * Scope, per the measured hosts: 8 of 26 containers emit ANSI, and every byte of
 * it is SGR (`ESC[...m`). Nothing emits cursor movement, carriage-return redraws
 * or the alternate screen, so anything that is not SGR only needs to be
 * recognised well enough to discard without leaking digits, `[` or `m` into
 * visible text.
 *
 * Control characters are built with `String.fromCharCode` rather than
 * string-literal escapes: embedded in source (however spelled) they are
 * invisible and easy to corrupt silently, so each codepoint is spelled out once,
 * in decimal, and reused everywhere.
 */

export const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BACKSLASH = String.fromCharCode(92);

/**
 * Matches any escape sequence this host is known to emit: a CSI
 * (`ESC[...<letter>`, SGR included), an OSC string (`ESC]...BEL` or `ESC]...ST`),
 * or a bare two-byte Fe escape (`ESC` + one letter, e.g. `ESC7`). Used both to
 * strip everything and, in the client renderer's `segmentAnsi`, to walk the
 * string sequence-by-sequence. Assembled with `new RegExp(source)` from the
 * plain-character pieces above instead of a regex literal, for the same
 * invisible-control-character reason.
 */
export const ANSI_SEQUENCE = new RegExp(
  ESC +
    "\\[([0-9;:]*)([a-zA-Z])" + // CSI ... final letter (SGR when final is "m")
    "|" +
    ESC +
    "\\][^" +
    ESC +
    BEL +
    "]*(?:" +
    BEL +
    "|" +
    ESC +
    BACKSLASH +
    BACKSLASH +
    ")" + // OSC ... terminated by BEL or ST (ESC + backslash)
    "|" +
    ESC +
    "[@-Z" +
    BACKSLASH +
    BACKSLASH +
    BACKSLASH +
    "]^_]", // bare ESC + one Fe byte
  "g",
);

export function hasAnsi(text: string): boolean {
  return text.indexOf(ESC) !== -1;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}
