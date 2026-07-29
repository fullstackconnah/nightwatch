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

  // Disk: host rootfs when mounted, else visible filesystems (dev mode).
  let disks: HostVitals["disk"] = [];
  const hostRoot = statfsDisk(HOST_ROOTFS, "/");
  if (inContainer && hostRoot) {
    disks = [hostRoot];
    // Extra data mounts commonly present on the homelab.
    for (const extra of ["/host/rootfs/mnt/docker", "/host/rootfs/mnt/media"]) {
      const d = statfsDisk(extra, extra.replace("/host/rootfs", ""));
      // statfs of a bind-mounted subdir of the same fs duplicates root; only add if it differs.
      if (d && hostRoot && (d.total !== hostRoot.total || d.used !== hostRoot.used)) disks.push(d);
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
    hostname: (inContainer ? readHostname() : null) || process.env.HOST_NAME || "homelab",
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
