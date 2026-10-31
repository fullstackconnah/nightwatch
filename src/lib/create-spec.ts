// Policy for the create-container feature. The socket proxy can't narrow
// container writes, so anything a created container may mount or join is
// decided here: returns the refusal message, or null when the spec is allowed.
// validateCreateSpec is pure; the async checks below touch the host rootfs and
// Docker through injected deps, so node --test can load this file.

import { lstat } from "node:fs/promises";
import { join } from "node:path";

interface Checkable {
  volumes: { host: string; container: string }[];
  network?: string;
}

const PROTECTED = ["/etc", "/root", "/proc", "/sys", "/dev", "/boot", "/var/lib/docker", "/run", "/var/run", "/var/run/docker.sock", "/run/docker.sock"];

// Resolves `.`/`..`, repeated and trailing slashes. Callers pass absolute paths.
function normalise(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return "/" + out.join("/");
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

// Allowed host roots for bind mounts. `/` and protected dirs are never roots.
// /mnt/docker/stacks is deliberately not a default: it holds every stack's compose file and .env.
export function bindRoots(): string[] {
  const raw = process.env.CREATE_BIND_ROOTS || "/mnt/media";
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/"))
    .map(normalise)
    .filter((r) => r !== "/" && !PROTECTED.some((d) => inside(r, d)));
}

// Networks a created container may join; blank means bridge.
export function createNetworks(): string[] {
  const raw = process.env.CREATE_NETWORKS || "bridge";
  // Never joinable even if listed: shared host/none stacks, another container's stack, internal-only networks.
  return raw.split(",").map((n) => n.trim()).filter((n) => n && n !== "host" && n !== "none" && !n.startsWith("container:") && !n.endsWith("_internal"));
}

export const createNetwork = (spec: Checkable) => spec.network?.trim() || "bridge";

export function validateCreateSpec(spec: Checkable): string | null {
  const roots = bindRoots();
  // Same row filter createAndStartContainer applies when building Mounts.
  for (const v of spec.volumes.filter((v) => v.host && v.container)) {
    // ":" could smuggle extra fields into a mount string; Mounts has none, but refuse anyway.
    if (v.host.includes(":") || v.container.includes(":")) return `Paths may not contain ":" ("${v.host}" -> "${v.container}").`;
    if (!v.container.startsWith("/") || normalise(v.container) !== v.container) {
      return `Container path "${v.container}" must be absolute, without "..", "." or repeated slashes.`;
    }
    // Named Docker volume.
    if (!v.host.startsWith("/") && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v.host)) continue;
    if (!v.host.startsWith("/")) return `Host path "${v.host}" must be absolute.`;
    const path = normalise(v.host);
    // shortcut: symlinks inside an allowed root are not resolved (no realpath of host paths from the container); the owner controls those trees.
    if (
      PROTECTED.some((d) => inside(path, d)) ||
      !roots.some((r) => inside(path, r))
    ) {
      return `Mounting "${v.host}" is not allowed. Bind mounts must be under: ${roots.join(", ")}.`;
    }
  }
  const net = createNetwork(spec);
  if (!createNetworks().includes(net)) {
    return `Network "${net}" is not allowed. Allowed: ${createNetworks().join(", ")}.`;
  }
  return null;
}

// Bind mounts are always read-only (the spec's readonly flag is ignored for them) and use the same
// normalised source the guard checked. Mounts, unlike Binds, makes Docker fail on a missing source
// instead of creating it as root: wanted, so a bad path fails closed.
export function buildMounts(volumes: { host: string; container: string; readonly?: boolean }[]) {
  return volumes
    .filter((v) => v.host && v.container)
    .map((v) =>
      v.host.startsWith("/")
        ? { Type: "bind" as const, Source: normalise(v.host), Target: v.container, ReadOnly: true }
        : { Type: "volume" as const, Source: v.host, Target: v.container, ReadOnly: !!v.readonly },
    );
}

export interface CreateDeps {
  rootfs?: string;
  inspectVolume: (name: string) => Promise<unknown>;
}

const isNamed = (h: string) => !h.startsWith("/");

// Async half of the policy: refuses symlinked bind paths and reuse of existing
// named volumes. Fails closed on any unexpected error.
export async function checkCreateSpecHost(spec: Checkable, deps: CreateDeps): Promise<string | null> {
  const rows = spec.volumes.filter((v) => v.host && v.container);
  for (const v of rows.filter((v) => !isNamed(v.host))) {
    if (!deps.rootfs) return "Bind mounts are refused: the host rootfs is not available to check for symlinks.";
    try {
      await lstat(deps.rootfs);
    } catch {
      return "Bind mounts are refused: the host rootfs is not readable to check for symlinks.";
    }
    let cur = "";
    for (const seg of normalise(v.host).split("/").filter(Boolean)) {
      cur += "/" + seg;
      try {
        if ((await lstat(join(deps.rootfs, cur))).isSymbolicLink()) {
          return `Mounting "${v.host}" is not allowed: "${cur}" is a symlink.`;
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") break; // Docker creates the rest
        return `Mounting "${v.host}" is refused: cannot check "${cur}".`;
      }
    }
  }
  for (const v of rows.filter((v) => isNamed(v.host))) {
    try {
      await deps.inspectVolume(v.host);
      return `Volume "${v.host}" already exists; creating a container may not reuse it.`;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) {
        return `Volume "${v.host}" could not be checked.`;
      }
    }
  }
  return null;
}
