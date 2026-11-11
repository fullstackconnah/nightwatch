/* `/kiosk?door=1` — the desk widget's deep link to the front-door picture.
   Pure decisions only; page.tsx owns the effect (relative imports, so node:test loads it). */

/** Exactly `door=1`; any other value, or a repeated key, is ignored. */
export function hasDoorParam(search: string): boolean {
  const all = new URLSearchParams(search).getAll("door");
  return all.length === 1 && all[0] === "1";
}

/** "wait" until the camera list has loaded; then "open" only for door=1 with a camera. */
export function doorLinkDecision(search: string, snapshotLoaded: boolean, hasCamera: boolean): "wait" | "ignore" | "open" {
  if (!snapshotLoaded) return "wait";
  return hasCamera && hasDoorParam(search) ? "open" : "ignore";
}

/** The URL without `door`, every other param and the hash kept. */
export function withoutDoorParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete("door");
  const q = params.toString();
  return `${pathname}${q ? `?${q}` : ""}${hash}`;
}
