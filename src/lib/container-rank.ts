/**
 * Client-safe container ranking/link helpers.
 *
 * These live OUTSIDE lib/tiles.ts on purpose: tiles.ts imports lib/config.ts
 * (node:fs) and is server-only, but these two functions are pure and are
 * imported by "use client" pages (overview sort, /containers columns,
 * detail-page links). Importing them via tiles.ts drags node:fs into the
 * client bundle and breaks `next build` with an UnhandledSchemeError.
 */

/** Attention-first ordering for STATE sorts: unhealthy before dead before
 *  restarting before paused/stopped, healthy running last. */
export function stateSeverity(c: { state: string; health: string | null }): number {
  if (c.health === "unhealthy") return 0;
  switch (c.state) {
    case "dead":
      return 1;
    case "restarting":
      return 2;
    case "paused":
      return 3;
    case "running":
      return 5;
    default:
      // exited, created, removing
      return 4;
  }
}

/** Deep link into the resources ALL/processes view, filtered to one container's
 *  name (the `q` param prefills the filter there). */
export function processesHref(name: string): string {
  return `/resources?metric=all&q=${encodeURIComponent(name)}`;
}
