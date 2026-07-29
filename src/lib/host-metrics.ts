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
export const HOST_PROC = process.env.HOST_PROC || "/host/proc";
export const HOST_ROOTFS = process.env.HOST_ROOTFS || "/host/rootfs";
const HOST_SYS = process.env.HOST_SYS || "/host/sys";

export interface HostVitals {
  hostname: string;
  os: string;
  uptimeSeconds: number;
  cpu: { percent: number; cores: number; model: string; loadAvg: number[] };
  memory: { total: number; used: number; available: number; percent: number };
  /** One entry per PHYSICAL disk (partitions on the same disk are grouped together). */
  disk: { mount: string; total: number; used: number; percent: number; mounts?: string[] }[];
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

interface NetDevCounters {
  rxBytes: number;
  txBytes: number;
  interfaceCount: number;
}

/**
 * Pure parser: sums rx/tx byte counters from a /proc/net/dev-style table,
 * applying the same "host network" interface filter readHostNetDev has always
 * used (skip loopback, veth, bridge, and the docker0 bridge) — shared here so
 * readHostNetDev and getHostNetCounters can never disagree about what counts
 * as host traffic. `interfaceCount` lets a caller distinguish "zero interfaces
 * matched" from "matched interfaces reported zero bytes".
 */
function parseNetDevCounters(content: string): NetDevCounters {
  const lines = content.split("\n").slice(2);
  let rx = 0;
  let tx = 0;
  let interfaceCount = 0;
  for (const line of lines) {
    const [ifacePart, rest] = line.split(":");
    if (!rest) continue;
    const iface = ifacePart.trim();
    if (iface === "lo" || iface.startsWith("veth") || iface.startsWith("br-") || iface === "docker0")
      continue;
    const cols = rest.trim().split(/\s+/);
    rx += Number(cols[0]) || 0;
    tx += Number(cols[8]) || 0;
    interfaceCount++;
  }
  return { rxBytes: rx, txBytes: tx, interfaceCount };
}

function readHostNetDev(): { rxPerSec: number; txPerSec: number } | null {
  try {
    const content = fs.readFileSync(`${HOST_PROC}/net/dev`, "utf8");
    const { rxBytes: rx, txBytes: tx } = parseNetDevCounters(content);
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

export interface HostNetCounters {
  rxBytes: number; // cumulative since boot
  txBytes: number; // cumulative since boot
}

/**
 * Raw cumulative network counters. Unlike HostVitals.network.rxPerSec this
 * does NOT compute a rate and keeps no module state, so a caller polling at
 * its own cadence can derive delta/elapsed without fighting other callers
 * (readHostNetDev, other pollers) over shared previous-sample state. Returns
 * null when unreadable, or when the file yields no usable interfaces — zeros
 * would otherwise read as "measured no traffic".
 */
export async function getHostNetCounters(): Promise<HostNetCounters | null> {
  try {
    const content = fs.readFileSync(`${HOST_PROC}/net/dev`, "utf8");
    const { rxBytes, txBytes, interfaceCount } = parseNetDevCounters(content);
    if (interfaceCount === 0) return null;
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) return null;
    return { rxBytes, txBytes };
  } catch {
    return null;
  }
}

// --- host /proc/diskstats (I/O counters) ------------------------------------

export interface HostDiskIoCounters {
  device: string; // physical device name, e.g. "sda", "nvme0n1"
  readBytes: number; // cumulative since boot
  writeBytes: number; // cumulative since boot
}

const VIRTUAL_DEVICE_PREFIXES = ["loop", "ram", "zram", "sr", "fd", "dm-", "md"];

// /proc/diskstats always reports in 512-byte sectors, regardless of the
// device's actual block size (e.g. 4Kn drives) — it's a fixed unit of this
// file's format, not a property of the underlying hardware.
const DISKSTATS_SECTOR_BYTES = 512;

/** Pure parser — split out so it is testable without a real /proc. */
export function parseDiskStats(content: string): HostDiskIoCounters[] {
  const raw: { name: string; readSectors: number; writeSectors: number }[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length < 10) continue; // trailing fields vary by kernel version; only the first 10 are needed
    raw.push({
      name: fields[2],
      readSectors: Number(fields[5]),
      writeSectors: Number(fields[9]),
    });
  }

  // Partition detection is two-pass: a name ending in digits is a partition
  // only if some OTHER device in the file is a proper prefix of it. A bare
  // /\d+$/ test would wrongly reject whole disks like "nvme0n1" (ends in a
  // digit but "nvme0n" is not itself a device).
  const allNames = raw.map((r) => r.name);
  const isPartition = (name: string): boolean =>
    /\d$/.test(name) && allNames.some((other) => other !== name && name.startsWith(other));

  const out: HostDiskIoCounters[] = [];
  for (const r of raw) {
    if (VIRTUAL_DEVICE_PREFIXES.some((p) => r.name.startsWith(p))) continue; // dm-*/md* are mapper/RAID layers over the same physical devices - counting them would double-count
    if (isPartition(r.name)) continue; // partitions would double-count against their parent disk
    const readBytes = r.readSectors * DISKSTATS_SECTOR_BYTES;
    const writeBytes = r.writeSectors * DISKSTATS_SECTOR_BYTES;
    if (!Number.isFinite(readBytes) || !Number.isFinite(writeBytes)) continue;
    out.push({ device: r.name, readBytes, writeBytes });
  }
  return out;
}

/**
 * Reads HOST_PROC/diskstats. Returns null when unreadable (missing mount,
 * permissions) so callers can degrade honestly instead of reporting zeros as
 * measured. These are cumulative counters since boot — this does NOT compute
 * rates; the caller derives delta/elapsed by diffing two calls itself.
 */
export async function getHostDiskIoCounters(): Promise<HostDiskIoCounters[] | null> {
  try {
    const content = fs.readFileSync(`${HOST_PROC}/diskstats`, "utf8");
    return parseDiskStats(content);
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
  const roots = ["/sys/class/thermal", `${HOST_SYS}/class/thermal`];
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
 * Every mountpoint path in a /proc/<pid>/mounts-style table, UNFILTERED —
 * unlike parseHostMounts/parseMountLines this keeps pseudo-filesystems (proc,
 * sysfs, tmpfs, devtmpfs, overlay, cgroup, squashfs, bind mounts, ...). A du
 * scan needs the full set: `du -x` only prunes descent BELOW an argument, so
 * a directory that happens to be a mountpoint of a different filesystem must
 * be excluded from the child list before du ever sees it, or du walks the
 * whole thing (e.g. treating /proc as a real 128TiB directory).
 */
export function parseAllMountpoints(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    out.push(decodeMountField(parts[1]));
  }
  return out;
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

// --- physical-disk grouping --------------------------------------------------

const PARTITION_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/dev\/nvme(\d+)n(\d+)p\d+$/, (m) => `nvme${m[1]}n${m[2]}`],
  [/^\/dev\/mmcblk(\d+)p\d+$/, (m) => `mmcblk${m[1]}`],
  [/^\/dev\/(sd[a-z]+)\d+$/, (m) => m[1]],
  [/^\/dev\/(vd[a-z]+)\d+$/, (m) => m[1]],
  [/^\/dev\/(xvd[a-z]+)\d+$/, (m) => m[1]],
];

/** Non-mapper devices only: partition device path -> the physical disk it lives on. */
function simpleParentDisk(device: string): string {
  for (const [re, fn] of PARTITION_PATTERNS) {
    const m = device.match(re);
    if (m) return fn(m);
  }
  // Already a whole-disk device, or an unrecognized scheme: group by its own name.
  return device.replace(/^\/dev\//, "");
}

/**
 * Resolve a device to the physical disk it lives on, so every partition of the
 * same disk groups together. `dmResolve` maps a device-mapper name (e.g. an LVM
 * logical volume like "ubuntu--vg-ubuntu--lv") to one underlying partition
 * device to recurse into, or null if it can't be resolved to a single disk
 * (falls back to grouping under the mapper name itself).
 */
export function parentDiskOf(device: string, dmResolve: (mapperName: string) => string | null): string {
  const mapperMatch = device.match(/^\/dev\/mapper\/(.+)$/);
  const dmMatch = device.match(/^\/dev\/(dm-\d+)$/);
  if (mapperMatch || dmMatch) {
    const mapperName = mapperMatch ? mapperMatch[1] : dmMatch![1];
    const resolved = dmResolve(mapperName);
    if (resolved) return parentDiskOf(resolved, dmResolve);
    return mapperName;
  }
  return simpleParentDisk(device);
}

/**
 * Builds a device-mapper resolver by scanning `${hostSys}/class/block/dm-*` —
 * finds the dm-N node whose `dm/name` matches the mapper name, then reads its
 * `slaves/` entries (the underlying partitions backing that mapper device).
 * A single slave resolves cleanly. Multiple slaves only resolve if they all
 * sit on the same physical disk (e.g. a mirrored/striped LV would otherwise
 * misattribute capacity to one disk) — otherwise returns null so the caller
 * groups the mapper device under its own name instead of guessing.
 */
export function makeDmResolver(hostSys: string): (mapperName: string) => string | null {
  return (mapperName: string): string | null => {
    let dmNodes: string[];
    try {
      dmNodes = fs.readdirSync(`${hostSys}/class/block`).filter((e) => e.startsWith("dm-"));
    } catch {
      return null;
    }
    for (const dm of dmNodes) {
      let name: string;
      try {
        name = fs.readFileSync(`${hostSys}/class/block/${dm}/dm/name`, "utf8").trim();
      } catch {
        continue;
      }
      if (name !== mapperName) continue;
      try {
        const slaves = fs.readdirSync(`${hostSys}/class/block/${dm}/slaves`);
        if (slaves.length === 0) return null;
        if (slaves.length === 1) return `/dev/${slaves[0]}`;
        const parents = new Set(slaves.map((s) => simpleParentDisk(`/dev/${s}`)));
        return parents.size === 1 ? `/dev/${slaves[0]}` : null;
      } catch {
        return null;
      }
    }
    return null;
  };
}

export interface PerMountDisk {
  device: string;
  mount: string;
  total: number;
  used: number;
}

/**
 * Groups per-mount statfs results by the physical disk each mount's device
 * lives on, so a disk with several partitions (/, /boot, /boot/efi, ...)
 * reports as a single row instead of one row per partition. Group label is
 * the physical disk's short name (e.g. "nvme0n1"); total/used are summed
 * across the disk's mounted partitions. Sorted with the group containing "/"
 * first, then alphabetically by label.
 */
export function groupDisksByPhysicalDisk(
  perMount: PerMountDisk[],
  dmResolve: (mapperName: string) => string | null,
): HostVitals["disk"] {
  const groups = new Map<string, { mounts: string[]; total: number; used: number }>();
  for (const pd of perMount) {
    const label = parentDiskOf(pd.device, dmResolve);
    const g = groups.get(label) ?? { mounts: [], total: 0, used: 0 };
    g.mounts.push(pd.mount);
    g.total += pd.total;
    g.used += pd.used;
    groups.set(label, g);
  }
  const grouped = Array.from(groups.entries()).map(([label, g]) => ({
    mount: label,
    mounts: g.mounts,
    total: g.total,
    used: g.used,
    percent: g.total > 0 ? (g.used / g.total) * 100 : 0,
  }));
  grouped.sort((a, b) => {
    const aRoot = a.mounts.includes("/");
    const bRoot = b.mounts.includes("/");
    if (aRoot && !bRoot) return -1;
    if (bRoot && !aRoot) return 1;
    return a.mount.localeCompare(b.mount);
  });
  return grouped;
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
      const perMountDisks: PerMountDisk[] = [];
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
        perMountDisks.push({ device: m.device, mount: d.mount, total: d.total, used: d.used });
      }
      disks = groupDisksByPhysicalDisk(perMountDisks, makeDmResolver(HOST_SYS));
    }

    if (disks.length === 0) {
      // Mounts unreadable for some reason; at least report root.
      const hostRoot = statfsDisk(HOST_ROOTFS, "/");
      if (hostRoot) disks = [{ ...hostRoot, mounts: ["/"] }];
    }
  } else {
    const fsSizes = await si.fsSize();
    disks = fsSizes
      .filter((f) => f.size > 5 * 1024 ** 3)
      .slice(0, 4)
      .map((f) => ({ mount: f.mount, total: f.size, used: f.used, percent: f.use, mounts: [f.mount] }));
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
