// Pure: decides whether a container may be removed and words every outcome.
// Import-free except protected-containers so node:test can load it.
import { isProtectedContainer, type ProtectCandidate } from "./protected-containers.ts";

/** `dead` is left out on purpose: removing it often needs force (OPEN-D3). */
export const REMOVABLE_STATES: readonly string[] = ["created", "exited"];

/** Never force, never drop volumes: a running container or app data is not ours to destroy from here. */
export const REMOVE_OPTIONS = { force: false, v: false } as const;

export const PROTECTED_REMOVE_MESSAGE =
  "This container runs the dashboard itself (nightwatch, its Docker socket proxy or Dockge), so it can't be removed from here.";
export const REMOVE_LOOKUP_FAILED = "Couldn't check whether this container is safe to remove. Try again.";

type Removable = ProtectCandidate & { state: string };
export type RemoveDecision<T extends Removable> = { ok: true; target: T } | { status: 403 | 404 | 409 | 503; message: string };

/** Order matters: protection wins over state. */
export function removeDecision<T extends Removable>(list: T[] | null, id: string, selfHostname: string): RemoveDecision<T> {
  if (!list) return { status: 503, message: REMOVE_LOOKUP_FAILED };
  // Exact name, else exactly one id-prefix hit: a delete must never guess between two ids.
  const prefixHits = list.filter((c) => c.id.startsWith(id));
  const target = list.find((c) => c.name === id) ?? (prefixHits.length === 1 ? prefixHits[0] : undefined);
  if (!target) return { status: 404, message: "That container no longer exists." };
  if (isProtectedContainer(target, selfHostname)) return { status: 403, message: PROTECTED_REMOVE_MESSAGE };
  if (!REMOVABLE_STATES.includes(target.state)) {
    return { status: 409, message: `${target.name} isn't stopped (${target.state}), so it wasn't removed. Stop it in Resources first.` };
  }
  return { ok: true, target };
}

export const removeConfirmText = (name: string) => `Remove ${name}? Its image can then be deleted. Can't be undone.`;

/** Docker or proxy failure after the guard passed. */
export function removeErrorCopy(status: number | "ECONN", name: string): string {
  if (status === "ECONN") return "Can't reach the Docker socket proxy — check that the sidecar container is up.";
  if (status === 403) return "The socket proxy refused the removal: it needs POST=1 and CONTAINERS=1.";
  if (status === 404) return "That container no longer exists.";
  if (status === 409) return `${name} is running again, so it wasn't removed. Stop it in Resources first.`;
  return "Docker failed to remove it.";
}
