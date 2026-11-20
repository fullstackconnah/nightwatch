export interface PortRow { host: string; container: string; protocol: "tcp" | "udp" }
export interface EnvRow { key: string; value: string }
export interface VolRow { host: string; container: string; readonly: boolean }

type Checked =
  | { error: string }
  | { ports: { host: number; container: number; protocol: "tcp" | "udp" }[]; env: EnvRow[]; volumes: VolRow[] };

const blank = (s: string) => !s.trim();

/** Validates the create form's rows: an all-blank row is dropped, a half-filled one refuses the submit (first problem only). */
export function checkRows(ports: PortRow[], env: EnvRow[], vols: VolRow[]): Checked {
  const outPorts: { host: number; container: number; protocol: "tcp" | "udp" }[] = [];
  for (const [i, p] of ports.entries()) {
    if (blank(p.host) && blank(p.container)) continue;
    if (blank(p.host) || blank(p.container)) return { error: `Port row ${i + 1} needs both a host and a container port.` };
    outPorts.push({ host: Number(p.host), container: Number(p.container), protocol: p.protocol });
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
    outVols.push(v);
  }
  return { ports: outPorts, env: outEnv, volumes: outVols };
}
