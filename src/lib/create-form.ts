export interface PortRow { host: string; container: string; protocol: "tcp" | "udp" }
export interface EnvRow { key: string; value: string }
export interface VolRow { host: string; container: string; readonly: boolean }

type Checked =
  | { error: string }
  | { ports: { host: number; container: number; protocol: "tcp" | "udp" }[]; env: EnvRow[]; volumes: VolRow[] };

const blank = (s: string) => !s.trim();

/** The dialog's error line after a failed create: no answer (or a proxy cut) may still have made the container. */
export function createFailedCopy(message: string | undefined, status: number | undefined, offline: boolean): string {
  if (status === undefined && offline) return "You're offline, so nothing was sent. Reconnect and try again.";
  if (status === undefined || status === 502 || status === 504) {
    return "No answer came back, so the container may already exist. Close this and check the list before trying again.";
  }
  return message || "create failed";
}

/** Validates the create form's rows: an all-blank row is dropped, a half-filled one refuses the submit (first problem only). */
export function checkRows(ports: PortRow[], env: EnvRow[], vols: VolRow[]): Checked {
  const outPorts: { host: number; container: number; protocol: "tcp" | "udp" }[] = [];
  for (const [i, p] of ports.entries()) {
    if (blank(p.host) && blank(p.container)) continue;
    if (blank(p.host) || blank(p.container)) return { error: `Port row ${i + 1} needs both a host and a container port.` };
    for (const [half, text] of [["host", p.host], ["container", p.container]] as const) {
      const t = text.trim();
      if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 65535) {
        return { error: `Port row ${i + 1}: the ${half} port must be a whole number from 1 to 65535.` };
      }
    }
    const host = Number(p.host);
    const dup = ports.findIndex((q, j) => j < i && q.protocol === p.protocol && !blank(q.host) && !blank(q.container) && Number(q.host) === host);
    if (dup >= 0) return { error: `Port rows ${dup + 1} and ${i + 1} use the same host port.` };
    outPorts.push({ host, container: Number(p.container), protocol: p.protocol });
  }
  const outEnv: EnvRow[] = [];
  for (const [i, e] of env.entries()) {
    if (blank(e.key) && blank(e.value)) continue;
    const key = e.key.trim();
    if (!key) return { error: `Variable row ${i + 1} needs a name.` };
    if (/[=\s]/.test(key)) return { error: `Variable row ${i + 1}: the name cannot contain spaces or "=".` };
    outEnv.push({ key, value: e.value });
  }
  const outVols: VolRow[] = [];
  for (const [i, v] of vols.entries()) {
    if (blank(v.host) && blank(v.container)) continue;
    if (blank(v.host) || blank(v.container)) return { error: `Volume row ${i + 1} needs both a host path and a container path.` };
    outVols.push({ ...v, host: v.host.trim(), container: v.container.trim() });
  }
  return { ports: outPorts, env: outEnv, volumes: outVols };
}
