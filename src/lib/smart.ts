import fsp from "node:fs/promises";
import path from "node:path";
import { HOST_PROC, HOST_ROOTFS, HOST_SYS } from "@/lib/host-metrics";
import type {
  ArrayIntegrity,
  AtaAttribute,
  DriveBus,
  DriveHealth,
  FsErrorCounter,
  HealthVerdict,
  LvmGroup,
  MdArray,
  PoolState,
  SmartSnapshot,
  SmartTempSensor,
  VolumeManagerState,
} from "@/lib/smart-types";

/**
 * Drive-health collector. Server-only: node:fs must never reach
 * src/lib/client.ts, which is why the contract lives in the import-free
 * smart-types.ts (see the comment at the top of that file).
 *
 * Three independent sources feed one snapshot:
 *  A. the host collector's smart.json (smartctl -a -j per device, republished
 *     every 5 minutes) — model/serial/wear/attributes/error counters.
 *  B. hwmon (instant) — live temperatures, which win over A's stale reading.
 *  C. sysfs/procfs (instant, all unprivileged reads) — mdraid/LVM/ZFS/Btrfs/
 *     ext4 integrity, independent of whether the SMART payload is even readable.
 *
 * getSmartSnapshot() must never throw: every read is individually guarded and
 * degrades to an honest null/empty value rather than failing the whole scan.
 */

const SMART_JSON_PATH = `${HOST_ROOTFS}/var/lib/nightwatch/smart.json`;

// --- raw smartctl JSON shapes (only the fields this module reads) -----------

interface SmartFileShape {
  ts: number;
  collector: string;
  smartctlVersion?: string;
  devices: { device: string; json: SmartCtlJson }[];
}

interface RawAtaAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  flags?: { prefailure?: boolean };
  raw?: { value?: number; string?: string };
}

interface SmartCtlJson {
  model_name?: string;
  serial_number?: string;
  firmware_version?: string;
  smart_status?: { passed?: boolean };
  user_capacity?: { bytes?: number };
  nvme_total_capacity?: number;
  rotation_rate?: number;
  interface_speed?: { current?: { string?: string } };
  device?: { protocol?: string };
  smartctl?: { messages?: { string: string }[] };
  ata_smart_attributes?: { table?: RawAtaAttribute[] };
  power_on_time?: { hours?: number };
  power_cycle_count?: number;
  temperature?: { current?: number };
  nvme_smart_health_information_log?: {
    critical_warning?: number;
    available_spare?: number;
    available_spare_threshold?: number;
    percentage_used?: number;
    data_units_read?: number;
    data_units_written?: number;
    power_on_hours?: number;
    power_cycles?: number;
    unsafe_shutdowns?: number;
    media_errors?: number;
    num_err_log_entries?: number;
  };
}

// --- small shared helpers -----------------------------------------------------

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readIntFile(filePath: string): Promise<number | null> {
  const raw = await readTextFile(filePath);
  if (raw === null) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SysfsBlockIdentity {
  model: string | null;
  capacityBytes: number | null;
  rotational: boolean | null;
}

/**
 * Fallback identity for drives sysfs knows about but SMART couldn't reach at
 * all (e.g. an unrecognized USB bridge) — absence of *health* data is not
 * absence of *identity* data, so such a drive still gets a model/capacity/
 * spin-type instead of rendering as a bare device name. Only ever used to
 * fill a field SMART left null, never to override a value SMART supplied.
 */
async function readSysfsBlockIdentity(name: string): Promise<SysfsBlockIdentity> {
  const model = (await readTextFile(`${HOST_SYS}/block/${name}/device/model`))?.trim() || null;

  // sysfs "size" is always in 512-byte sectors regardless of the device's
  // actual block size — same fixed unit /proc/diskstats uses for the same reason.
  const sectors = await readIntFile(`${HOST_SYS}/block/${name}/size`);
  const capacityBytes = sectors !== null ? sectors * 512 : null;

  const rotationalRaw = await readIntFile(`${HOST_SYS}/block/${name}/queue/rotational`);
  const rotational = rotationalRaw === null ? null : rotationalRaw === 1;

  return { model, capacityBytes, rotational };
}

// --- Source A: per-drive SMART fields ----------------------------------------

function classifyBus(devicePath: string, protocol: string | undefined, messages: { string: string }[]): DriveBus {
  if (devicePath.includes("nvme")) return "nvme";
  if (protocol === "ATA" || protocol === "SCSI") return "sata";
  // Only reachable when protocol was never reported — e.g. an unrecognized USB
  // bridge that smartctl couldn't even identify enough to fill `device`.
  if (messages.some((m) => /USB/i.test(m.string))) return "usb";
  return "unknown";
}

/**
 * thresh === 0 means the drive declares no threshold at all — "distance to a
 * threshold that does not exist" is not a number, so that (and thresh >= 100,
 * which would make the denominator zero or negative) both return null rather
 * than a fabricated headroom figure.
 */
function headroomPct(value: number, thresh: number): number | null {
  if (thresh <= 0 || thresh >= 100) return null;
  return clamp(((value - thresh) / (100 - thresh)) * 100, 0, 100);
}

const CRITICAL_ATA_IDS = new Set([5, 187, 188, 197, 198]);

function buildAtaAttributes(table: RawAtaAttribute[] | undefined): AtaAttribute[] {
  if (!table) return [];
  return table.map((row) => {
    const thresh = row.thresh ?? 0;
    return {
      id: row.id,
      name: row.name,
      value: row.value,
      worst: row.worst,
      thresh,
      headroomPct: headroomPct(row.value, thresh),
      prefailure: row.flags?.prefailure ?? false,
      failingNow: thresh > 0 && row.value <= thresh,
      failedBefore: thresh > 0 && row.worst <= thresh,
      raw: row.raw?.string ?? "",
      rawValue: row.raw?.value ?? 0,
      critical: CRITICAL_ATA_IDS.has(row.id),
    };
  });
}

/**
 * Hours until wearPct reaches 100%, extrapolated from the lifetime average
 * rate. Must be null (not Infinity) when wearPct is 0 — a fresh/lightly-used
 * NVMe drive routinely reports percentage_used: 0, and powerOnHours / 0 is
 * Infinity, which JSON.stringify turns into `null` anyway but which would
 * poison any client-side arithmetic before it gets there.
 */
function projectedHoursRemaining(wearPct: number | null, powerOnHours: number | null): number | null {
  if (wearPct === null || powerOnHours === null || wearPct <= 0 || powerOnHours <= 0) return null;
  return Math.round((powerOnHours / wearPct) * (100 - wearPct));
}

async function buildDrive(
  entry: { device: string; json: SmartCtlJson },
  hwmonByController: Map<string, SmartTempSensor[]>,
): Promise<DriveHealth> {
  const json = entry.json;
  const name = entry.device.replace(/^\/dev\//, "");
  const messages = json.smartctl?.messages ?? [];
  const sysfsIdentity = await readSysfsBlockIdentity(name);

  // smartctl's exit code is a bitmask (bit 6 = "errors in the error log", the
  // exact case this feature exists to surface), never a pass/fail flag —
  // verified live: /dev/nvme1n1 exits 4 while smart_status.passed is true and
  // the full health log is present. Availability is judged by whether the JSON
  // actually contains SMART data, not by the exit status.
  const smartAvailable = !!(json.smart_status || json.ata_smart_attributes || json.nvme_smart_health_information_log);
  const unavailableReason = smartAvailable ? null : (messages[0]?.string ?? null);
  // The collector passes `-n standby` so sleeping disks are not woken just to
  // be polled; a STANDBY message means readings are absent by design, not a fault.
  const standby = messages.some((m) => /STANDBY/i.test(m.string));

  const bus = classifyBus(entry.device, json.device?.protocol, messages);
  const isNvme = bus === "nvme";
  const nvmeLog = json.nvme_smart_health_information_log;
  const ata = buildAtaAttributes(json.ata_smart_attributes?.table);

  const rpm = json.rotation_rate && json.rotation_rate > 0 ? json.rotation_rate : null;
  // rotation_rate is the only signal SMART gives for "spinning vs not": present
  // and nonzero means an HDD; NVMe is never rotational; anything else that did
  // return SMART data (ATA/SATA SSDs report no rotation_rate) is non-rotational.
  // Falls back to sysfs queue/rotational only when SMART gave no signal at all
  // (e.g. the USB bridge case where smartAvailable is false).
  const rotational = rpm !== null ? true : isNvme ? false : smartAvailable ? false : sysfsIdentity.rotational;

  const capacityBytes = json.user_capacity?.bytes ?? json.nvme_total_capacity ?? sysfsIdentity.capacityBytes;

  const wearPct = nvmeLog?.percentage_used ?? null;
  const powerOnHours = nvmeLog?.power_on_hours ?? json.power_on_time?.hours ?? null;
  const powerCycles = nvmeLog?.power_cycles ?? json.power_cycle_count ?? null;

  // The NVMe spec defines one "data unit" as 1000 x 512 bytes — NOT 512 and
  // NOT 1024 (a 4Kn-style guess here would under/over-report lifetime bytes
  // written by roughly 2x).
  const bytesWritten = nvmeLog?.data_units_written != null ? nvmeLog.data_units_written * 512000 : null;
  const bytesRead = nvmeLog?.data_units_read != null ? nvmeLog.data_units_read * 512000 : null;

  // Live hwmon temps win over smart.json's own reading, which can be up to 5
  // minutes stale (the collector's republish interval). Controller "nvme0"
  // covers every namespace under it (nvme0n1, nvme0n2, ...).
  let temps: SmartTempSensor[] = [];
  for (const [controllerId, sensors] of hwmonByController) {
    if (name.startsWith(controllerId)) {
      temps = sensors;
      break;
    }
  }
  if (temps.length === 0 && json.temperature?.current != null) {
    // ATA drives normally have no hwmon entry at all, and an NVMe drive whose
    // controller failed to register one lands here too — deliberately NOT gated
    // on bus. SMART already carries the reading, so falling back costs nothing,
    // whereas rendering no temperature for a drive whose temperature we know
    // would be the honest-data rule broken in the one direction that matters.
    // Per-sensor detail and vendor thresholds are lost; the number is not.
    temps = [{ label: "Drive", celsius: json.temperature.current, criticalC: null, maxC: null }];
  }

  const drive: DriveHealth = {
    device: entry.device,
    name,
    model: json.model_name ?? sysfsIdentity.model,
    serial: json.serial_number ?? null,
    firmware: json.firmware_version ?? null,
    bus,
    rotational,
    rpm,
    capacityBytes,
    interfaceSpeed: json.interface_speed?.current?.string ?? null,
    smartPassed: json.smart_status?.passed ?? null,
    smartAvailable,
    unavailableReason,
    standby,
    verdict: "unknown", // filled in below, once every other field is known
    reasons: [],
    temps,
    wearPct,
    availableSparePct: nvmeLog?.available_spare ?? null,
    availableSpareThresholdPct: nvmeLog?.available_spare_threshold ?? null,
    powerOnHours,
    powerCycles,
    // unsafeShutdowns (live: 430) and errorLogEntries (live: 12694) are facts
    // to display, never alarms — computeDriveVerdict deliberately never reads them.
    unsafeShutdowns: nvmeLog?.unsafe_shutdowns ?? null,
    mediaErrors: nvmeLog?.media_errors ?? null,
    errorLogEntries: nvmeLog?.num_err_log_entries ?? null,
    criticalWarning: nvmeLog?.critical_warning ?? null,
    bytesWritten,
    bytesRead,
    projectedHoursRemaining: projectedHoursRemaining(wearPct, powerOnHours),
    ata,
  };

  const { verdict, reasons } = computeDriveVerdict(drive);
  drive.verdict = verdict;
  drive.reasons = reasons;
  return drive;
}

// --- verdict rules --------------------------------------------------------
//
// Implemented exactly per the drive-health brief, kept in this one block so
// the bad/warn thresholds are all visible together instead of scattered.

function computeDriveVerdict(d: DriveHealth): { verdict: HealthVerdict; reasons: string[] } {
  if (!d.smartAvailable) return { verdict: "unknown", reasons: [] };

  const reasons: string[] = [];
  let bad = false;
  let warn = false;

  if (d.smartPassed === false) {
    bad = true;
    reasons.push("SMART overall self-assessment failed");
  }

  if (d.criticalWarning !== null && d.criticalWarning !== 0) {
    bad = true;
    reasons.push(`NVMe critical warning bitfield 0x${d.criticalWarning.toString(16)}`);
  }

  if (d.mediaErrors !== null && d.mediaErrors > 0) {
    bad = true;
    reasons.push(`${d.mediaErrors} media error${d.mediaErrors === 1 ? "" : "s"}`);
  }

  if (d.availableSparePct !== null && d.availableSpareThresholdPct !== null) {
    if (d.availableSparePct < d.availableSpareThresholdPct) {
      bad = true;
      reasons.push(`available spare ${d.availableSparePct}% below threshold ${d.availableSpareThresholdPct}%`);
    } else if (d.availableSparePct <= d.availableSpareThresholdPct + 10) {
      warn = true;
      reasons.push(`available spare ${d.availableSparePct}% approaching threshold ${d.availableSpareThresholdPct}%`);
    }
  }

  for (const attr of d.ata) {
    if (attr.failingNow && attr.prefailure) {
      bad = true;
      reasons.push(`${attr.name} failing now (pre-fail attribute at/below threshold)`);
    } else if (attr.prefailure && attr.failedBefore) {
      warn = true;
      reasons.push(`${attr.name} failed its threshold previously`);
    }
    if (attr.critical && attr.rawValue > 0) {
      warn = true;
      reasons.push(`${attr.rawValue} ${attr.name.toLowerCase().replace(/_/g, " ")}`);
    }
  }

  // Default to the non-rotational (SSD/NVMe) threshold when rotational is
  // unknown (null) — the fleet this dashboard watches is mostly flash.
  const isRotational = d.rotational === true;
  for (const t of d.temps) {
    const criticalC = t.criticalC ?? (isRotational ? 60 : 75);
    const warnC = t.criticalC !== null ? t.criticalC - 15 : isRotational ? 50 : 65;
    if (t.celsius >= criticalC) {
      bad = true;
      reasons.push(`${t.label} at ${t.celsius.toFixed(0)} °C, at/above critical`);
    } else if (t.celsius >= warnC) {
      warn = true;
      reasons.push(`${t.label} ${t.celsius.toFixed(0)} °C, ${(criticalC - t.celsius).toFixed(0)} °C from critical`);
    }
  }

  if (d.wearPct !== null && d.wearPct >= 80) {
    warn = true;
    reasons.push(`wear at ${d.wearPct}%`);
  }

  return { verdict: bad ? "bad" : warn ? "warn" : "ok", reasons };
}

function computeIntegrityVerdict(
  filesystems: FsErrorCounter[],
  mdArrays: MdArray[],
  zfs: VolumeManagerState,
  btrfs: VolumeManagerState,
): { verdict: HealthVerdict; reasons: string[] } {
  const reasons: string[] = [];
  let bad = false;

  for (const f of filesystems) {
    if (f.errors > 0) {
      bad = true;
      reasons.push(`${f.displayName}: ${f.errors} filesystem error${f.errors === 1 ? "" : "s"}`);
    }
  }
  for (const arr of mdArrays) {
    if (arr.degraded) {
      bad = true;
      reasons.push(`RAID array ${arr.name} degraded (${arr.activeDisks ?? "?"}/${arr.totalDisks ?? "?"})`);
    }
  }
  for (const pool of [...zfs.pools, ...btrfs.pools]) {
    if (pool.degraded) {
      bad = true;
      reasons.push(`pool ${pool.name} ${pool.state}`);
    }
  }

  // No arrays and no pools is a genuinely healthy "ok", not "unknown" — this
  // host has neither and that is not a degraded state.
  return { verdict: bad ? "bad" : "ok", reasons };
}

const VERDICT_RANK: Record<HealthVerdict, number> = { ok: 0, unknown: 1, warn: 2, bad: 3 };

function worstVerdict(verdicts: HealthVerdict[]): HealthVerdict {
  let worst: HealthVerdict = "ok";
  for (const v of verdicts) {
    if (VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
  }
  return worst;
}

// --- Source B: hwmon live temperatures ---------------------------------------

/**
 * Scans /sys/class/hwmon/hwmon* for NVMe controllers and returns their temp
 * sensors keyed by controller id (e.g. "nvme0"), so buildDrive can match any
 * drive name that starts with that id (nvme0n1, nvme0n2, ...).
 */
async function readHwmonNvmeTemps(): Promise<Map<string, SmartTempSensor[]>> {
  const result = new Map<string, SmartTempSensor[]>();
  let hwmonDirs: string[];
  try {
    hwmonDirs = await fsp.readdir(`${HOST_SYS}/class/hwmon`);
  } catch {
    return result;
  }

  for (const hwmon of hwmonDirs) {
    const base = `${HOST_SYS}/class/hwmon/${hwmon}`;
    const name = (await readTextFile(`${base}/name`))?.trim();
    if (name !== "nvme") continue;

    let controllerId: string;
    try {
      const real = await fsp.realpath(`${base}/device`);
      controllerId = path.basename(real); // e.g. "nvme0"
    } catch {
      continue;
    }

    let files: string[];
    try {
      files = await fsp.readdir(base);
    } catch {
      continue;
    }

    const sensors: SmartTempSensor[] = [];
    for (const file of files) {
      const m = file.match(/^temp(\d+)_input$/);
      if (!m) continue;
      const idx = m[1];

      const rawInput = await readIntFile(`${base}/${file}`);
      if (rawInput === null) continue;
      const celsius = rawInput / 1000;
      // Sanity gate on the reading itself, same reasoning as the threshold
      // gate below: an unset/garbage input should be dropped, not rendered as
      // a wildly implausible temperature.
      if (celsius < -50 || celsius > 150) continue;

      const label = (await readTextFile(`${base}/temp${idx}_label`))?.trim() || `Sensor ${idx}`;

      // Unset hwmon thresholds surface as sentinel values, e.g. temp3_max
      // reads 65261850 m°C (65261.85 °C) on this host's NVMe drives — a gauge
      // scaled to that renders a 40 °C drive as 0.06% full. Discard anything
      // outside a plausible 20-120 °C range rather than trust the raw number.
      const gateThreshold = async (thresholdFile: string): Promise<number | null> => {
        const raw = await readIntFile(thresholdFile);
        if (raw === null) return null;
        const c = raw / 1000;
        return c >= 20 && c <= 120 ? c : null;
      };
      const criticalC = await gateThreshold(`${base}/temp${idx}_crit`);
      const maxC = await gateThreshold(`${base}/temp${idx}_max`);

      sensors.push({ label, celsius, criticalC, maxC });
    }

    if (sensors.length > 0) result.set(controllerId, sensors);
  }

  return result;
}

// --- Source C: array integrity ------------------------------------------------

/**
 * Parses /proc/mdstat. Array blocks look like:
 *   md0 : active raid1 sdb1[1] sda1[0]
 *         10485504 blocks super 1.2 [2/2] [UU]
 * followed by a blank line before the next array (or "unused devices: ...").
 */
function parseMdstat(content: string): { raidPersonalities: string[]; mdArrays: MdArray[] } {
  const lines = content.split("\n");
  let raidPersonalities: string[] = [];
  const mdArrays: MdArray[] = [];
  let i = 0;

  if (lines[0]?.startsWith("Personalities")) {
    raidPersonalities = [...lines[0].matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
    i = 1;
  }

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^(\S+)\s*:\s*(active|inactive)\s+(\S+)\s+(.+)$/);
    if (!headerMatch) {
      i++;
      continue;
    }
    const [, name, state, level, memberStr] = headerMatch;
    const members = memberStr
      .trim()
      .split(/\s+/)
      .map((m) => m.replace(/\[\d+\]$/, ""));

    let activeDisks: number | null = null;
    let totalDisks: number | null = null;
    let degraded = false;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "") {
      const countMatch = lines[j].match(/\[(\d+)\/(\d+)\]/);
      const uMatch = lines[j].match(/\[([U_]+)\]/);
      if (countMatch) {
        activeDisks = Number(countMatch[1]);
        totalDisks = Number(countMatch[2]);
      }
      if (uMatch?.[1].includes("_")) degraded = true;
      j++;
    }
    if (activeDisks !== null && totalDisks !== null && activeDisks < totalDisks) degraded = true;

    mdArrays.push({ name, level, state, activeDisks, totalDisks, degraded, members });
    i = j;
  }

  return { raidPersonalities, mdArrays };
}

async function readMdstat(): Promise<{ raidPersonalities: string[]; mdArrays: MdArray[] }> {
  const content = await readTextFile(`${HOST_PROC}/mdstat`);
  return content === null ? { raidPersonalities: [], mdArrays: [] } : parseMdstat(content);
}

/**
 * Maps a bare block-device name (as ext4's sysfs dir names it, e.g. "sda1",
 * "dm-0") to its mountpoint, by parsing the HOST's mount table and, for
 * /dev/mapper/* entries, resolving the mapper name back to its dm-N node via
 * dm/name — the same join ext4's own sysfs uses to expose dm devices by
 * number, not by name.
 *
 * Deliberately reads PID 1's mounts, not the top-level HOST_PROC/mounts:
 * /proc/mounts is a symlink to /proc/self/mounts, and "self" resolves in the
 * READER's mount namespace — so even through the /host/proc bind mount, the
 * top-level path still returns THIS CONTAINER's own mount table (its bind
 * mounts, /etc/hosts, driver injections, ...), not the host's. Verified live:
 * that bug pointed nvme0n1p2 at "/boot" through the container's own bind
 * mount of the host's /boot rather than the host's real "/boot" mountpoint,
 * and pointed dm-0 at a stray nvidia .so bind-mounted into this container.
 * PID 1 is the host's init, so its /1/mounts is the host's real table.
 */
async function buildDeviceToMountMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let content = await readTextFile(`${HOST_PROC}/1/mounts`);
  if (content === null) content = await readTextFile(`${HOST_PROC}/mounts`); // pid 1 unreadable — best effort
  if (content === null) return map;

  const dmNameToDevice = new Map<string, string>();
  try {
    const dmDirs = (await fsp.readdir(`${HOST_SYS}/block`)).filter((d) => d.startsWith("dm-"));
    for (const dm of dmDirs) {
      const name = (await readTextFile(`${HOST_SYS}/block/${dm}/dm/name`))?.trim();
      if (name) dmNameToDevice.set(name, dm);
    }
  } catch {
    // No dm devices at all — dmNameToDevice stays empty, mapper entries below are skipped.
  }

  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || !parts[0].startsWith("/dev/")) continue;
    const mapperMatch = parts[0].match(/^\/dev\/mapper\/(.+)$/);
    const devName = mapperMatch ? dmNameToDevice.get(mapperMatch[1]) : parts[0].replace(/^\/dev\//, "");
    // A device mounted more than once (e.g. bind mounts) keeps its FIRST
    // (primary) mountpoint rather than the last one seen.
    if (devName && !map.has(devName)) map.set(devName, parts[1]);
  }
  return map;
}

async function readExt4Errors(): Promise<FsErrorCounter[]> {
  let dirs: string[];
  try {
    dirs = await fsp.readdir(`${HOST_SYS}/fs/ext4`);
  } catch {
    return [];
  }

  const mounts = await buildDeviceToMountMap();
  const out: FsErrorCounter[] = [];
  for (const dir of dirs) {
    if (dir === "features") continue;
    const base = `${HOST_SYS}/fs/ext4/${dir}`;
    const errors = (await readIntFile(`${base}/errors_count`)) ?? 0;
    const firstRaw = await readIntFile(`${base}/first_error_time`);
    const lastRaw = await readIntFile(`${base}/last_error_time`);

    let displayName = dir;
    if (dir.startsWith("dm-")) {
      const dmName = (await readTextFile(`${HOST_SYS}/block/${dir}/dm/name`))?.trim();
      if (dmName) displayName = dmName;
    }

    out.push({
      device: dir,
      mount: mounts.get(dir) ?? null,
      displayName,
      errors,
      firstErrorAt: firstRaw && firstRaw > 0 ? firstRaw : null,
      lastErrorAt: lastRaw && lastRaw > 0 ? lastRaw : null,
    });
  }
  return out;
}

/**
 * systemd/device-mapper doubles literal hyphens in dm names, so
 * "ubuntu--vg-ubuntu--lv" decodes as VG "ubuntu-vg" + LV "ubuntu-lv": split on
 * the single '-' that is NOT part of a '--' pair, then un-double the rest.
 */
function splitDmName(dmName: string): { vg: string; lv: string } | null {
  const undouble = (s: string) => s.replace(/--/g, "-");
  // Walk to the first '-' that is not half of a '--' pair. Done without a
  // placeholder sentinel on purpose: the obvious implementation substitutes a
  // control character, which makes this file binary to git and grep.
  for (let i = 0; i < dmName.length; i++) {
    if (dmName[i] !== "-") continue;
    if (dmName[i + 1] === "-") {
      i++; // skip the escaped pair whole
      continue;
    }
    return { vg: undouble(dmName.slice(0, i)), lv: undouble(dmName.slice(i + 1)) };
  }
  return null;
}

async function readLvmGroups(): Promise<LvmGroup[]> {
  let dmDirs: string[];
  try {
    dmDirs = (await fsp.readdir(`${HOST_SYS}/block`)).filter((d) => d.startsWith("dm-"));
  } catch {
    return [];
  }

  const out: LvmGroup[] = [];
  for (const dm of dmDirs) {
    const name = (await readTextFile(`${HOST_SYS}/block/${dm}/dm/name`))?.trim();
    if (!name) continue;
    const split = splitDmName(name);
    if (!split) continue; // not an LVM-style "vg-lv" name — not our concern here

    let pvs: string[] = [];
    try {
      pvs = await fsp.readdir(`${HOST_SYS}/block/${dm}/slaves`);
    } catch {
      pvs = [];
    }
    out.push({ name: split.vg, lv: split.lv, dm, pvs });
  }
  return out;
}

async function readZfs(): Promise<VolumeManagerState> {
  const present = await pathExists(`${HOST_SYS}/module/zfs`);
  if (!present) return { kind: "zfs", present: false, pools: [], note: null };

  let poolDirs: string[];
  try {
    poolDirs = await fsp.readdir(`${HOST_PROC}/spl/kstat/zfs`);
  } catch {
    return { kind: "zfs", present: true, pools: [], note: "zfs module loaded, no pools imported" };
  }

  const pools: PoolState[] = [];
  for (const poolName of poolDirs) {
    const state = (await readTextFile(`${HOST_PROC}/spl/kstat/zfs/${poolName}/state`))?.trim();
    if (!state) continue;
    pools.push({ name: poolName, state, degraded: state !== "ONLINE", deviceErrors: [] });
  }

  return pools.length > 0
    ? { kind: "zfs", present: true, pools, note: null }
    : { kind: "zfs", present: true, pools: [], note: "zfs module loaded, no pools imported" };
}

async function readBtrfsErrorTotal(errorStatsPath: string): Promise<number> {
  const content = await readTextFile(errorStatsPath);
  if (!content) return 0;
  let total = 0;
  for (const line of content.split("\n")) {
    const m = line.trim().match(/^(write_errs|read_errs|flush_errs|corruption_errs|generation_errs)\s+(\d+)/);
    if (m) total += Number(m[2]);
  }
  return total;
}

async function readBtrfs(): Promise<VolumeManagerState> {
  let entries: string[];
  try {
    entries = await fsp.readdir(`${HOST_SYS}/fs/btrfs`);
  } catch {
    return { kind: "btrfs", present: false, pools: [], note: null };
  }
  const uuidDirs = entries.filter((e) => e !== "features");
  if (uuidDirs.length === 0) return { kind: "btrfs", present: false, pools: [], note: null };

  const pools: PoolState[] = [];
  for (const uuid of uuidDirs) {
    const base = `${HOST_SYS}/fs/btrfs/${uuid}`;
    const label = (await readTextFile(`${base}/label`))?.trim();
    const name = label && label.length > 0 ? label : uuid;

    let deviceDirs: string[] = [];
    try {
      deviceDirs = await fsp.readdir(`${base}/devices`);
    } catch {
      deviceDirs = [];
    }
    const deviceErrors: { device: string; errors: number }[] = [];
    for (const dev of deviceDirs) {
      deviceErrors.push({ device: dev, errors: await readBtrfsErrorTotal(`${base}/devices/${dev}/error_stats`) });
    }

    // sysfs exposes per-device error counters but not an "expected device
    // count" for the pool, so degraded here is only ever driven by nonzero
    // error counters — a missing-device scenario with zero errors on the
    // remaining devices would not be caught by this alone.
    const degraded = deviceErrors.some((d) => d.errors > 0);
    pools.push({ name, state: degraded ? "DEGRADED" : "ONLINE", degraded, deviceErrors });
  }

  return { kind: "btrfs", present: true, pools, note: null };
}

// --- main ----------------------------------------------------------------

function emptySnapshot(ts: number, integrity: ArrayIntegrity, error: string | null): SmartSnapshot {
  return {
    ts,
    collectorTs: null,
    collectorAgeMs: null,
    smartctlVersion: null,
    drives: [],
    integrity,
    overall: integrity.verdict,
    error,
  };
}

export async function getSmartSnapshot(): Promise<SmartSnapshot> {
  const ts = Date.now();

  try {
    // Source C (integrity) and B (hwmon) never depend on the SMART payload
    // being readable, so they run unconditionally and are never lost just
    // because smart.json is missing or corrupt.
    const [mdstat, lvm, zfs, btrfs, filesystems, hwmonByController] = await Promise.all([
      readMdstat(),
      readLvmGroups(),
      readZfs(),
      readBtrfs(),
      readExt4Errors(),
      readHwmonNvmeTemps(),
    ]);

    const integrityVerdict = computeIntegrityVerdict(filesystems, mdstat.mdArrays, zfs, btrfs);
    const integrity: ArrayIntegrity = {
      raidPersonalities: mdstat.raidPersonalities,
      mdArrays: mdstat.mdArrays,
      lvm,
      zfs,
      btrfs,
      filesystems,
      verdict: integrityVerdict.verdict,
      reasons: integrityVerdict.reasons,
    };

    let raw: SmartFileShape | null = null;
    let readError: string | null = null;
    try {
      const content = await fsp.readFile(SMART_JSON_PATH, "utf8");
      raw = JSON.parse(content) as SmartFileShape;
    } catch (err) {
      readError = err instanceof Error ? err.message : "failed to read smart.json";
    }

    if (!raw) return emptySnapshot(ts, integrity, readError);

    const drives = await Promise.all((raw.devices ?? []).map((entry) => buildDrive(entry, hwmonByController)));
    const overall = worstVerdict([...drives.map((d) => d.verdict), integrity.verdict]);

    return {
      ts,
      collectorTs: raw.ts ?? null,
      collectorAgeMs: raw.ts != null ? Date.now() - raw.ts : null,
      smartctlVersion: raw.smartctlVersion ?? null,
      drives,
      integrity,
      overall,
      error: null,
    };
  } catch (err) {
    // Belt-and-braces: getSmartSnapshot must never throw. Anything that
    // reaches here is a bug in a source above, not an expected failure mode.
    const emptyIntegrity: ArrayIntegrity = {
      raidPersonalities: [],
      mdArrays: [],
      lvm: [],
      zfs: { kind: "zfs", present: false, pools: [], note: null },
      btrfs: { kind: "btrfs", present: false, pools: [], note: null },
      filesystems: [],
      verdict: "unknown",
      reasons: [],
    };
    return emptySnapshot(ts, emptyIntegrity, err instanceof Error ? err.message : "smart snapshot failed");
  }
}
