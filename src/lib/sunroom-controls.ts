/* Sunroom controls (Sill DS PR 2): the small pure pieces of bundle.js the React controls share. */

/** The sun catch disc's transform-origin, so it grows from where the finger landed (bundle.js aimCatch).
 *  The disc is 160% wide and its layout box starts at (-0.3w, h/2 - 0.8w) inside the lit layer.
 *  A missing touch point (keyboard activation) clears the origin back to the centre. */
export function catchOrigin(lit: { left: number; top: number; width: number; height: number }, x: number | null, y: number | null): string {
  if (x == null || y == null) return "";
  return `${x - lit.left + 0.3 * lit.width}px ${y - lit.top - lit.height / 2 + 0.8 * lit.width}px`;
}

/** The word beside a chip's pip (rule 5: a state is never colour alone). An error is the only status colour here. */
export function chipWord(s: { on: boolean; error?: boolean; busy?: boolean }): { word: string; tone?: "bad" } {
  if (s.error) return { word: "Error", tone: "bad" };
  if (s.busy) return { word: "Working" };
  return { word: s.on ? "On" : "Off" };
}
