import type { HaStatus } from "./types/ha.ts";

/* `/kiosk?door=1` — the desk widget's deep link to the front-door picture.
   Pure decisions only; page.tsx owns the effect (relative imports, so node:test loads it). */

/** Exactly `door=1`; any other value, or a repeated key, is ignored. */
export function hasDoorParam(search: string): boolean {
  const all = new URLSearchParams(search).getAll("door");
  return all.length === 1 && all[0] === "1";
}

/** Past the deadline: ignore. Else wait for a real answer (HA down or unauthorized is not one); open only on "ok" with a camera and door=1. */
export function doorLinkDecision(
  search: string,
  status: HaStatus | undefined,
  hasCamera: boolean,
  deadlinePassed: boolean,
): "wait" | "ignore" | "open" {
  if (deadlinePassed) return "ignore";
  if (status === undefined || status === "unreachable" || status === "unauthorized") return "wait";
  return status === "ok" && hasCamera && hasDoorParam(search) ? "open" : "ignore";
}

/** The URL without `door`, every other param and the hash kept. */
export function withoutDoorParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete("door");
  const q = params.toString();
  return `${pathname}${q ? `?${q}` : ""}${hash}`;
}
