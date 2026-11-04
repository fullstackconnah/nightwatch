/* The strips pattern's pure logic: which strip opens by itself (R4) and the held Players list (R5).
 * The hold itself is Home's gate/pillText; this file only wires them to a list that is committed when not held. */
import { gate, pillText } from "./home.ts";

export interface OpenState {
  open: string | null;
  /** Who opened it: a person's strip is never closed or replaced by the page. */
  by: "auto" | "person" | null;
}
/** A strip id, null (the answer names none) or "keep" (loading, stale: the subject is not known). */
export type OpenTarget = string | null;

const server = (): OpenState => ({ open: "server", by: "auto" });

/** R4. Called on first paint and when the answer's subject changes, never on a tick. */
export function nextOpen(s: OpenState, target: OpenTarget | "keep", wide: boolean): OpenState {
  if (s.by === "person") return s;
  if (target === "keep") return s.open === null && wide ? server() : s;
  if (target === null) return wide ? server() : s.by === "auto" ? { open: null, by: null } : s;
  return { open: target, by: "auto" };
}

export interface HeldRows {
  rows: string[];
  /** Rows kept in their slot after they left; they read "left". */
  gone: ReadonlySet<string>;
  waiting: number;
  /** "N new · show", or "" (the pill's slot stays reserved either way). */
  pill: string;
}
/** R5. `prev` is the committed list (null before first paint). Not held: the live rows are committed. */
export function heldRows(prev: readonly string[] | null, live: readonly string[], held: boolean): HeldRows {
  if (!held || prev === null) return { rows: live.slice(), gone: new Set(), waiting: 0, pill: "" };
  const g = gate(prev, live);
  return { rows: g.shown, gone: new Set(g.fixed), waiting: g.waiting.length, pill: pillText(g.waiting.length, 0) };
}
