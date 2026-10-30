// Policy for the create-container feature. The socket proxy can't narrow
// container writes, so anything a created container may mount or join is
// decided here: returns the refusal message, or null when the spec is allowed.
// Pure and import-free so node --test can load it.

interface Checkable {
  volumes: { host: string; container: string }[];
  network?: string;
}

const PROTECTED = ["/etc", "/root", "/proc", "/sys", "/dev", "/boot", "/var/lib/docker", "/run", "/var/run"];

// Resolves `.`/`..`, repeated and trailing slashes. Callers pass absolute paths.
function normalise(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return "/" + out.join("/");
}

export function validateCreateSpec(spec: Checkable): string | null {
  // Same row filter createAndStartContainer applies when building Binds.
  for (const v of spec.volumes.filter((v) => v.host && v.container)) {
    if (!v.host.startsWith("/")) return `Host path "${v.host}" must be absolute.`;
    const path = normalise(v.host);
    if (path === "/" || PROTECTED.some((d) => path === d || path.startsWith(d + "/"))) {
      return `Mounting "${v.host}" is not allowed.`;
    }
  }
  const net = spec.network?.trim();
  if (net === "host" || net?.startsWith("container:")) {
    return `Network "${net}" is not allowed.`;
  }
  return null;
}
