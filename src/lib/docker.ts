import Docker from "dockerode";

/**
 * Docker Engine access. In production this points at the tecnativa
 * docker-socket-proxy sidecar (DOCKER_HOST=tcp://socket-proxy:2375) so the app
 * never touches the raw socket. In dev, point DOCKER_HOST at an SSH tunnel to
 * the homelab's socket, or leave unset for the local engine.
 */
function createClient(): Docker {
  const host = process.env.DOCKER_HOST;
  if (!host || host.startsWith("unix://") || host.startsWith("npipe://")) {
    return new Docker();
  }
  const url = new URL(host.replace(/^tcp:\/\//, "http://"));
  return new Docker({
    host: url.hostname,
    port: Number(url.port || 2375),
    protocol: "http",
  });
}

const globalForDocker = globalThis as unknown as { __docker?: Docker };
export const docker: Docker = globalForDocker.__docker ?? createClient();
globalForDocker.__docker = docker;

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string; // running | exited | created | restarting | paused | dead
  status: string; // human string, includes (healthy)/(unhealthy)
  health: "healthy" | "unhealthy" | "starting" | null;
  composeProject: string | null;
  composeService: string | null;
  ports: { private: number; public: number | null; type: string }[];
  labels: Record<string, string>;
  created: number;
  networkMode?: string;
}

export async function listContainers(): Promise<ContainerSummary[]> {
  const raw = await docker.listContainers({ all: true });
  return raw.map((c) => {
    const status = c.Status || "";
    const health = status.includes("(healthy)")
      ? "healthy"
      : status.includes("(unhealthy)")
        ? "unhealthy"
        : status.includes("(health: starting)")
          ? "starting"
          : null;
    const seen = new Set<string>();
    const ports = (c.Ports || [])
      .map((p) => ({
        private: p.PrivatePort,
        public: p.PublicPort ?? null,
        type: p.Type,
      }))
      .filter((p) => {
        const k = `${p.private}/${p.type}/${p.public}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (a.public ?? 99999) - (b.public ?? 99999));
    return {
      id: c.Id,
      name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status,
      health,
      composeProject: c.Labels?.["com.docker.compose.project"] ?? null,
      composeService: c.Labels?.["com.docker.compose.service"] ?? null,
      ports,
      labels: c.Labels || {},
      created: c.Created,
      networkMode: (c.HostConfig as { NetworkMode?: string })?.NetworkMode,
    };
  });
}

export interface ContainerStatsSnapshot {
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  rxBytes: number;
  txBytes: number;
  pids: number;
  ts: number;
}

/** One-shot stats sample. Docker waits ~1s internally to fill precpu. */
export async function containerStats(id: string): Promise<ContainerStatsSnapshot> {
  const container = docker.getContainer(id);
  const s = (await container.stats({ stream: false })) as unknown as {
    cpu_stats: {
      cpu_usage: { total_usage: number };
      system_cpu_usage?: number;
      online_cpus?: number;
    };
    precpu_stats: {
      cpu_usage: { total_usage: number };
      system_cpu_usage?: number;
    };
    memory_stats: {
      usage?: number;
      limit?: number;
      stats?: { inactive_file?: number; cache?: number };
    };
    networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
    pids_stats?: { current?: number };
  };

  const cpuDelta =
    s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sysDelta =
    (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const cores = s.cpu_stats.online_cpus || 1;
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cores * 100 : 0;

  const rawUsage = s.memory_stats?.usage ?? 0;
  const cache =
    s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
  const memUsage = Math.max(0, rawUsage - cache);
  const memLimit = s.memory_stats?.limit ?? 0;

  let rx = 0;
  let tx = 0;
  for (const net of Object.values(s.networks || {})) {
    rx += net.rx_bytes;
    tx += net.tx_bytes;
  }

  return {
    cpuPercent,
    memUsage,
    memLimit,
    memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : 0,
    rxBytes: rx,
    txBytes: tx,
    pids: s.pids_stats?.current ?? 0,
    ts: Date.now(),
  };
}

/** Docker multiplexes stdout/stderr into 8-byte-framed chunks unless the container has a TTY. */
function demuxLogs(buf: Buffer): string {
  let out = "";
  let i = 0;
  while (i + 8 <= buf.length) {
    const type = buf[i];
    if (type > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) {
      // Not a framed stream (TTY container) — return raw.
      return buf.toString("utf8");
    }
    const len = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + len).toString("utf8");
    i += 8 + len;
  }
  return out || buf.toString("utf8");
}

export async function containerLogs(id: string, tail = 200): Promise<string> {
  const container = docker.getContainer(id);
  const buf = (await container.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
    follow: false,
  })) as unknown as Buffer;
  // Strip ANSI escape codes for clean display.
  // eslint-disable-next-line no-control-regex
  return demuxLogs(buf).replace(/\x1b\[[0-9;]*m/g, "");
}

export type ContainerAction = "start" | "stop" | "restart";

export async function containerAction(id: string, action: ContainerAction): Promise<void> {
  const container = docker.getContainer(id);
  if (action === "start") await container.start();
  else if (action === "stop") await container.stop({ t: 15 });
  else await container.restart({ t: 15 });
}

export interface CreateContainerSpec {
  name?: string;
  image: string;
  ports: { host: number; container: number; protocol?: "tcp" | "udp" }[];
  env: { key: string; value: string }[];
  volumes: { host: string; container: string; readonly?: boolean }[];
  network?: string;
  restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
}

export async function createAndStartContainer(spec: CreateContainerSpec): Promise<string> {
  // Pull the image first (no-op if present). Requires IMAGES=1 + POST=1 on the proxy.
  await new Promise<void>((resolve, reject) => {
    docker.pull(spec.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (doneErr: Error | null) =>
        doneErr ? reject(doneErr) : resolve(),
      );
    });
  });

  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, { HostPort: string }[]> = {};
  for (const p of spec.ports) {
    const key = `${p.container}/${p.protocol || "tcp"}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(p.host) }];
  }

  const container = await docker.createContainer({
    name: spec.name || undefined,
    Image: spec.image,
    Env: spec.env.filter((e) => e.key).map((e) => `${e.key}=${e.value}`),
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      Binds: spec.volumes
        .filter((v) => v.host && v.container)
        .map((v) => `${v.host}:${v.container}${v.readonly ? ":ro" : ""}`),
      RestartPolicy: { Name: spec.restartPolicy || "unless-stopped" },
      NetworkMode: spec.network || undefined,
    },
  });
  await container.start();
  return container.id;
}
