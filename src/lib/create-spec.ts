// Policy for the create-container feature. The socket proxy can't narrow
// container writes, so anything a created container may mount or join is
// decided here: returns the refusal message, or null when the spec is allowed.
// Pure and import-free so node --test can load it.

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
export function bindRoots(): string[] {
  const raw = process.env.CREATE_BIND_ROOTS || "/mnt/docker/stacks,/mnt/media";
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/"))
    .map(normalise)
    .filter((r) => r !== "/" && !PROTECTED.some((d) => inside(r, d)));
}

export function validateCreateSpec(spec: Checkable): string | null {
  const roots = bindRoots();
  // Same row filter createAndStartContainer applies when building Binds.
  for (const v of spec.volumes.filter((v) => v.host && v.container)) {
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
  const net = spec.network?.trim();
  if (net === "host" || net?.startsWith("container:")) {
    return `Network "${net}" is not allowed.`;
  }
  return null;
}
