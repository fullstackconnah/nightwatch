import fs from "node:fs";
import si from "systeminformation";

/**
 * Host vitals. Inside the container /proc/stat, /proc/meminfo and /proc/uptime
 * already reflect the HOST (they are not namespaced), so systeminformation's
 * CPU/mem numbers are host numbers. The exceptions:
 *  - network: /proc/net/dev IS namespaced → read the host's via the
 *    /host/proc bind mount when present;
 *  - disk: the container only sees its own rootfs → statfs the /host/rootfs
 *    bind mount when present;
 *  - hostname: read /host/proc/sys/kernel/hostname when present.
 */
const HOST_PROC = process.env.HOST_PROC || "/host/proc";
const HOST_ROOTFS = process.env.HOST_ROOTFS || "/host/rootfs";

export interface HostVitals {
  hostname: string;
  os: string;
  uptimeSeconds: number;
  cpu: { percent: number; cores: number; model: string; loadAvg: number[] };
  memory: { total: number; used: number; available: number; percent: number };
  disk: { mount: string; total: number; used: number; percent: number }[];
  network: { rxPerSec: number; txPerSec: number };
  tempC: number | null;
  ts: number;
}

// --- host /proc parsers -----------------------------------------------------

function hostProcAvailable(): boolean {
  try {
    return fs.existsSync(`${HOST_PROC}/net/dev`);
  } catch {
    return false;
  }
}

let lastNet: { rx: number; tx: number; ts: number } | null = null;

function readHostNetDev(): { rxPerSec: number; txPerSec: number } | null {
  try {
    const lines = fs.readFileSync(`${HOST_PROC}/net/dev`, "utf8").split("\n").slice(2);
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const [ifacePart, rest] = line.split(":");
      if (!rest) continue;
      const iface = ifacePart.trim();
      if (iface === "lo" || iface.startsWith("veth") || iface.startsWith("br-") || iface === "docker0")
        continue;
      const cols = rest.trim().split(/\s+/);
      rx += Number(cols[0]) || 0;
      tx += Number(cols[8]) || 0;
    }
    const now = Date.now();
    const prev = lastNet;
    lastNet = { rx, tx, ts: now };
    if (!prev || now <= prev.ts) return { rxPerSec: 0, txPerSec: 0 };
    const dt = (now - prev.ts) / 1000;
    return {
      rxPerSec: Math.max(0, (rx - prev.rx) / dt),
      txPerSec: Math.max(0, (tx - prev.tx) / dt),
    };
  } catch {
    return null;
  }
}

function readHostname(): string | null {
  try {
    return fs.readFileSync(`${HOST_PROC}/sys/kernel/hostname`, "utf8").trim();
  } catch {
    return null;
  }
}

function readTemp(): number | null {
  // Thermal zones in the container's /sys are the host's (sysfs is not namespaced).
  const roots = ["/sys/class/thermal", "/host/sys/class/thermal"];
  for (const root of roots) {
    try {
      const zones = fs.readdirSync(root).filter((z) => z.startsWith("thermal_zone"));
      const temps: number[] = [];
      for (const z of zones) {
        const raw = Number(fs.readFileSync(`${root}/${z}/temp`, "utf8").trim());
        if (raw > 1000) temps.push(raw / 1000);
      }
      if (temps.length) return Math.max(...temps);
    } catch {
      // try next root
    }
  }
  return null;
}

function statfsDisk(target: string, label: string) {
  try {
    const s = fs.statfsSync(target);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - free;
    return { mount: label, total, used, percent: total > 0 ? (used / total) * 100 : 0 };
  } catch {
    return null;
  }
}

// Octal-escaped whitespace/backslash in /proc/mounts fields, e.g. "\040" for a space.
function decodeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

export interface HostMountEntry {
  device: string;
  mountpoint: string;
  fstype: string;
}

function parseMountLines(content: string): HostMountEntry[] {
  const out: HostMountEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const device = parts[0];
    const mountpoint = decodeMountField(parts[1]);
    const fstype = parts[2];
    if (!device.startsWith("/dev/")) continue;
    if (device.startsWith("/dev/loop")) continue;
    if (fstype === "squashfs") continue;
    out.push({ device, mountpoint, fstype });
  }
  return out;
}

function dedupeByDeviceShortest(entries: HostMountEntry[]): HostMountEntry[] {
  const byDevice = new Map<string, HostMountEntry>();
  for (const e of entries) {
    const existing = byDevice.get(e.device);
    if (!existing || e.mountpoint.length < existing.mountpoint.length) {
      byDevice.set(e.device, e);
    }
  }
  return Array.from(byDevice.values());
}

/**
 * Parse a /proc/<pid>/mounts-style file (already in the HOST's mount namespace —
 * e.g. host PID 1's mounts, read through the /host/proc bind mount) into real
 * block-device mounts: /dev/* devices, excluding loop devices and squashfs
 * (snap/overlay noise). Deduped by device, keeping the shortest mountpoint
 * (the "primary" mount of that device).
 */
export function parseHostMounts(content: string): HostMountEntry[] {
  return dedupeByDeviceShortest(parseMountLines(content));
}

/**
 * Fallback for when host PID 1's mounts can't be read directly: parse the
 * CONTAINER's own /proc/mounts instead. Because the host rootfs is bind-mounted
 * into the container at `hostRootfsPrefix`, the host's real mounts show up in
 * this table too, nested under that prefix (e.g. `/host/rootfs/mnt/docker`) —
 * everything else (the container's own binds, like `/app/data`) is noise and
 * is dropped. Entries are prefix-stripped back to host-relative paths
 * (`/host/rootfs` itself becomes `/`), and any mount nested under
 * `/mnt/docker/docker-data/` is dropped too — that's the docker overlay
 * storage's own backing directories leaking through as bind mounts, not a
 * real host filesystem.
 */
export function parseContainerMountsFallback(content: string, hostRootfsPrefix: string): HostMountEntry[] {
  const entries = parseMountLines(content)
    .filter((e) => e.mountpoint === hostRootfsPrefix || e.mountpoint.startsWith(`${hostRootfsPrefix}/`))
    .map((e) => ({
      ...e,
      mountpoint: e.mountpoint === hostRootfsPrefix ? "/" : e.mountpoint.slice(hostRootfsPrefix.length),
    }))
    .filter((e) => !e.mountpoint.startsWith("/mnt/docker/docker-data/"));
  return dedupeByDeviceShortest(entries);
}

// --- static info cache ------------------------------------------------------

let staticInfo: { os: string; cpuModel: string; cores: number } | null = null;

async function getStaticInfo() {
  if (staticInfo) return staticInfo;
  const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()]);
  staticInfo = {
    os: `${osInfo.distro} ${osInfo.release}`.trim(),
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cores: cpu.cores,
  };
  return staticInfo;
}

// --- main -------------------------------------------------------------------

export async function getHostVitals(): Promise<HostVitals> {
  const inContainer = hostProcAvailable();
  const [load, mem, time, statics] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    Promise.resolve(si.time()),
    getStaticInfo(),
  ]);

  // Disk: enumerate all real block-device mounts from host PID 1's mount
  // namespace (read through the /host/proc bind mount — /host/proc/mounts
  // itself resolves via "self" to the CONTAINER's own namespace, not the
  // host's, so it can't be used here), statfs-ing each through the
  // /host/rootfs bind mount. If PID 1's mounts can't be read, fall back to
  // parsing the container's own /proc/mounts and picking out the host's
  // mounts nested under the /host/rootfs bind. Dev mode falls back to
  // systeminformation's view of the local machine's filesystems.
  let disks: HostVitals["disk"] = [];
  if (inContainer) {
    let hostMounts: HostMountEntry[] | null = null;
    try {
      const content = fs.readFileSync(`${HOST_PROC}/1/mounts`, "utf8");
      hostMounts = parseHostMounts(content);
    } catch {
      try {
        const content = fs.readFileSync("/proc/mounts", "utf8");
        hostMounts = parseContainerMountsFallback(content, HOST_ROOTFS);
      } catch {
        hostMounts = null;
      }
    }

    if (hostMounts) {
      const seenFingerprints: { device: string; total: number; used: number }[] = [];
      for (const m of hostMounts) {
        const target = m.mountpoint === "/" ? HOST_ROOTFS : `${HOST_ROOTFS}${m.mountpoint}`;
        const d = statfsDisk(target, m.mountpoint);
        if (!d) continue;
        // Guard against the same device somehow surfacing twice (e.g. bind mounts);
        // different devices with coincidentally equal sizes must both be kept.
        const isDuplicate = seenFingerprints.some(
          (f) => f.device === m.device && f.total === d.total && f.used === d.used,
        );
        if (isDuplicate) continue;
        seenFingerprints.push({ device: m.device, total: d.total, used: d.used });
        disks.push(d);
      }
      disks.sort((a, b) => {
        if (a.mount === "/") return -1;
        if (b.mount === "/") return 1;
        return a.mount.localeCompare(b.mount);
      });
    }

    if (disks.length === 0) {
      // Mounts unreadable for some reason; at least report root.
      const hostRoot = statfsDisk(HOST_ROOTFS, "/");
      if (hostRoot) disks = [hostRoot];
    }
  } else {
    const fsSizes = await si.fsSize();
    disks = fsSizes
      .filter((f) => f.size > 5 * 1024 ** 3)
      .slice(0, 4)
      .map((f) => ({ mount: f.mount, total: f.size, used: f.used, percent: f.use }));
  }

  // Network: host's /proc when available, else systeminformation.
  let network = inContainer ? readHostNetDev() : null;
  if (!network) {
    try {
      const nets = await si.networkStats();
      network = {
        rxPerSec: nets.reduce((a, n) => a + (n.rx_sec ?? 0), 0),
        txPerSec: nets.reduce((a, n) => a + (n.tx_sec ?? 0), 0),
      };
    } catch {
      network = { rxPerSec: 0, txPerSec: 0 };
    }
  }

  let tempC = readTemp();
  if (tempC == null) {
    try {
      const t = await si.cpuTemperature();
      tempC = t.main > 0 ? t.main : null;
    } catch {
      tempC = null;
    }
  }

  return {
    // HOST_NAME wins: /proc/sys/kernel/hostname resolves to the READER's UTS
    // namespace even through a /host/proc bind mount, so in-container it
    // reports the container ID, not the host.
    hostname: process.env.HOST_NAME || (inContainer ? readHostname() : null) || "homelab",
    os: statics.os,
    uptimeSeconds: time.uptime,
    cpu: {
      percent: load.currentLoad,
      cores: statics.cores,
      model: statics.cpuModel,
      loadAvg: [load.avgLoad],
    },
    memory: {
      total: mem.total,
      used: mem.active,
      available: mem.available,
      percent: mem.total > 0 ? (mem.active / mem.total) * 100 : 0,
    },
    disk: disks,
    network,
    tempC,
    ts: Date.now(),
  };
}
