import Docker from "dockerode";
import { getHostVitals } from "@/lib/host-metrics";

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

interface StatsCacheEntry {
  data: Record<string, { cpuPct: number; memBytes: number; memLimit: number }>;
  ts: number;
}
interface DfCacheEntry {
  data: DfSnapshot;
  ts: number;
}
interface DockerRootCacheEntry {
  data: string | null;
  ts: number;
}
const globalForDocker = globalThis as unknown as {
  __docker?: Docker;
  __statsCache?: StatsCacheEntry;
  __dfCache?: DfCacheEntry;
  __dockerRootCache?: DockerRootCacheEntry;
};
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

const STATS_TTL_MS = 5_000;

/** Fan out one-shot stats to every running container; skip any that fail (mid-restart, etc). */
export async function allContainerStats(): Promise<
  Record<string, { cpuPct: number; memBytes: number; memLimit: number }>
> {
  const now = Date.now();
  if (globalForDocker.__statsCache && now - globalForDocker.__statsCache.ts < STATS_TTL_MS) {
    return globalForDocker.__statsCache.data;
  }
  const running = await docker.listContainers({ all: false });
  const settled = await Promise.allSettled(
    running.map(async (c) => {
      const s = await containerStats(c.Id);
      return [c.Id, { cpuPct: s.cpuPercent, memBytes: s.memUsage, memLimit: s.memLimit }] as const;
    }),
  );
  const data: Record<string, { cpuPct: number; memBytes: number; memLimit: number }> = {};
  for (const r of settled) {
    if (r.status === "fulfilled") data[r.value[0]] = r.value[1];
  }
  globalForDocker.__statsCache = { data, ts: now };
  return data;
}

export interface DfSnapshot {
  containers: { id: string; name: string; sizeRw: number | null; sizeRootFs: number | null }[];
  volumes: { name: string; sizeBytes: number | null; refCount: number }[];
  layersSize: number | null;
  buildCacheBytes: number | null;
}

const DF_TTL_MS = 60_000;

/** GET /system/df — expensive on the daemon, cached for a full minute. */
export async function systemDf(): Promise<DfSnapshot> {
  const now = Date.now();
  if (globalForDocker.__dfCache && now - globalForDocker.__dfCache.ts < DF_TTL_MS) {
    return globalForDocker.__dfCache.data;
  }
  const raw = (await docker.df()) as {
    LayersSize?: number;
    BuildCacheUsage?: number;
    BuildCache?: { Size?: number }[];
    Containers?: { Id: string; Names?: string[]; SizeRw?: number; SizeRootFs?: number }[];
    Volumes?: { Name: string; UsageData?: { Size: number; RefCount: number } | null }[];
  };
  const containers = (raw.Containers || []).map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ""),
    sizeRw: c.SizeRw ?? null,
    sizeRootFs: c.SizeRootFs ?? null,
  }));
  const volumes = (raw.Volumes || []).map((v) => ({
    name: v.Name,
    sizeBytes: v.UsageData && v.UsageData.Size >= 0 ? v.UsageData.Size : null,
    refCount: v.UsageData?.RefCount ?? 0,
  }));
  const layersSize = typeof raw.LayersSize === "number" ? raw.LayersSize : null;
  let buildCacheBytes: number | null;
  if (typeof raw.BuildCacheUsage === "number") {
    buildCacheBytes = raw.BuildCacheUsage;
  } else if (Array.isArray(raw.BuildCache)) {
    buildCacheBytes = raw.BuildCache.reduce(
      (a, b) => a + (b.Size != null && b.Size >= 0 ? b.Size : 0),
      0,
    );
  } else {
    buildCacheBytes = null;
  }
  const data: DfSnapshot = { containers, volumes, layersSize, buildCacheBytes };
  globalForDocker.__dfCache = { data, ts: now };
  return data;
}

const DOCKER_ROOT_TTL_MS = 60 * 60 * 1000; // never changes without a daemon restart

/** GET /info, just for DockerRootDir — cached for an hour since it's effectively static. */
async function getDockerRootDir(): Promise<string | null> {
  const now = Date.now();
  if (globalForDocker.__dockerRootCache && now - globalForDocker.__dockerRootCache.ts < DOCKER_ROOT_TTL_MS) {
    return globalForDocker.__dockerRootCache.data;
  }
  const data = await docker
    .info()
    .then((info: { DockerRootDir?: string }) => info.DockerRootDir ?? null)
    .catch(() => null);
  globalForDocker.__dockerRootCache = { data, ts: now };
  return data;
}

export interface ResourceContainer {
  id: string;
  name: string;
  state: string;
  image: string;
  cpuPct: number;
  memBytes: number;
  memLimit: number;
  sizeRw: number | null;
  sizeRootFs: number | null;
}

export interface ResourceSnapshot {
  updatedAt: number;
  containers: ResourceContainer[];
  volumes: { name: string; sizeBytes: number | null; refCount: number }[] | null;
  hostDisks: { mount: string; total: number; used: number; percent: number; mounts?: string[] }[] | null;
  dockerRootDir: string | null;
  totals: {
    cpuPct: number;
    memBytes: number;
    memTotal: number;
    containerDisk: number;
    volumeDisk: number;
    layersSize: number;
    buildCacheBytes: number;
  };
}

/**
 * Joined view for the Resources page: running-container stats + df (disk usage) +
 * the full container list, so stopped containers still show up with real disk sizes.
 * df is allowed to fail independently (proxy may not have SYSTEM=1 yet) — the rest
 * of the snapshot still renders, just without disk numbers.
 */
export async function getResourceSnapshot(): Promise<ResourceSnapshot> {
  const [list, stats, df, host, dockerRootDir] = await Promise.all([
    listContainers(),
    allContainerStats(),
    systemDf().catch(() => null),
    getHostVitals().catch(() => null),
    getDockerRootDir(),
  ]);

  const dfById = new Map((df?.containers ?? []).map((c) => [c.id, c]));
  const dfByName = new Map((df?.containers ?? []).map((c) => [c.name, c]));

  const containers: ResourceContainer[] = list.map((c) => {
    const stat = stats[c.id];
    const dfEntry = dfById.get(c.id) ?? dfByName.get(c.name);
    return {
      id: c.id,
      name: c.name,
      state: c.state,
      image: c.image,
      cpuPct: stat?.cpuPct ?? 0,
      memBytes: stat?.memBytes ?? 0,
      memLimit: stat?.memLimit ?? 0,
      sizeRw: dfEntry?.sizeRw ?? null,
      sizeRootFs: dfEntry?.sizeRootFs ?? null,
    };
  });

  return {
    updatedAt: Date.now(),
    containers,
    volumes: df?.volumes ?? null,
    hostDisks: host?.disk ?? null,
    dockerRootDir,
    totals: {
      cpuPct: containers.reduce((a, c) => a + c.cpuPct, 0),
      memBytes: containers.reduce((a, c) => a + c.memBytes, 0),
      memTotal: host?.memory.total ?? 0,
      containerDisk: containers.reduce((a, c) => a + (c.sizeRootFs ?? 0), 0),
      volumeDisk: (df?.volumes ?? []).reduce((a, v) => a + (v.sizeBytes ?? 0), 0),
      layersSize: df?.layersSize ?? 0,
      buildCacheBytes: df?.buildCacheBytes ?? 0,
    },
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
