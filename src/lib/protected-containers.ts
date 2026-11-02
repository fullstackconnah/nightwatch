// Pure, import-free: decides which containers nightwatch must never stop, so
// the dashboard (and the MCP client that polls it) cannot cut off its own control.
export interface ProtectCandidate {
  id: string;
  name: string;
  image: string;
  composeProject: string | null;
  composeService: string | null;
}

// Container names from docker-compose.yml and docker-compose.test.yml.
const OWN_NAME = /^homelab-dashboard(-test)?(-proxy)?$/;

/**
 * selfHostname is os.hostname(): inside a container it is the 12-char id prefix.
 * shortcut: any image containing "docker-socket-proxy" counts as protected, so
 * other stacks' proxies are covered too; narrow it if that ever gets in the way.
 */
export function isProtectedContainer(c: ProtectCandidate, selfHostname?: string): boolean {
  if (selfHostname && selfHostname.length >= 12 && c.id.startsWith(selfHostname)) return true;
  if (OWN_NAME.test(c.name)) return true;
  const image = c.image.toLowerCase();
  if (image.includes("docker-socket-proxy")) return true;
  return [c.name, image, c.composeProject, c.composeService].some((v) => /dockge/i.test(v ?? ""));
}

/** Actions the UI route refuses on a protected container (restart stays allowed). */
export const UI_BLOCKED_ACTIONS: readonly string[] = ["stop", "pause"];

export const PROTECTED_MESSAGE =
  "This container runs the dashboard itself (nightwatch, its Docker socket proxy or Dockge), so it can't be stopped from here.";
