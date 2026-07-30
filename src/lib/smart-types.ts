/**
 * Drive-health contract shared by the server collector and the client card.
 *
 * This module imports NOTHING on purpose. `process-types.ts` exists for the same
 * reason: a "use client" component that value-imports a server module drags
 * node:fs and friends into the browser bundle. `tsc --noEmit` stays happy and
 * only `next build` fails, which is a slow way to find out.
 *
 * Honest-data rule, inherited from the resources surface brief: `null` means
 * "not measured", and the UI renders it as an em dash. It never renders as 0.
 * A drive with no wear indicator is not a drive with 0% wear.
 */

export type HealthVerdict = "ok" | "warn" | "bad" | "unknown";

/** Physical transport, which decides which fields a drive can even have. */
export type DriveBus = "nvme" | "sata" | "usb" | "unknown";

export interface SmartTempSensor {
  /** hwmon label ("Composite", "Sensor 2") or "Drive" for ATA drives. */
  label: string;
  celsius: number;
  /**
   * Manufacturer thresholds. Null when absent OR implausible: hwmon reports
   * unset limits as sentinels like 65261850 m°C (65261 °C), and a gauge scaled
   * to that renders a hot drive as 0.06% full.
   */
  criticalC: number | null;
  maxC: number | null;
}

/** One row of the ATA SMART attribute table. NVMe drives have none of these. */
export interface AtaAttribute {
  id: number;
  /** Vendor name as smartctl reports it, e.g. "Reallocated_Sector_Ct". */
  name: string;
  /** Normalised current value. Higher is healthier; the drive fails at thresh. */
  value: number;
  /** Worst normalised value ever recorded. */
  worst: number;
  /** Failure threshold. 0 means the drive declares no threshold at all. */
  thresh: number;
  /**
   * How much of the value→thresh headroom is left, 0–100. Null when thresh is
   * 0, because "distance to a threshold that does not exist" is not a number.
   */
  headroomPct: number | null;
  /** Pre-fail attributes predict failure; old-age ones only describe usage. */
  prefailure: boolean;
  /** value <= thresh right now. */
  failingNow: boolean;
  /** worst <= thresh at some point in the past, even if healthy now. */
  failedBefore: boolean;
  /** Vendor-specific raw reading, verbatim from smartctl (e.g. "34 (Min/Max 24/38)"). */
  raw: string;
  rawValue: number;
  /**
   * One of the attributes with real predictive power for imminent failure
   * (reallocated, pending, offline-uncorrectable, reported-uncorrect, command
   * timeout). These get surfaced in the collapsed row; the rest do not.
   */
  critical: boolean;
}

export interface DriveHealth {
  /** Device path as the collector saw it, e.g. "/dev/nvme0n1". */
  device: string;
  /** Bare kernel name, e.g. "nvme0n1" — the join key to sysfs and diskstats. */
  name: string;
  model: string | null;
  serial: string | null;
  firmware: string | null;
  bus: DriveBus;
  rotational: boolean | null;
  rpm: number | null;
  capacityBytes: number | null;
  /** e.g. "6.0 Gb/s". Null for NVMe and anything that does not report it. */
  interfaceSpeed: string | null;

  /** The drive's own overall assessment. Null when it exposes none. */
  smartPassed: boolean | null;
  /** False when smartctl could not talk to the drive at all (USB bridges). */
  smartAvailable: boolean;
  /** Verbatim smartctl message explaining why, when smartAvailable is false. */
  unavailableReason: string | null;
  /** Drive was asleep and deliberately not woken, so readings are absent. */
  standby: boolean;

  verdict: HealthVerdict;
  /** Why the verdict is not "ok", in plain language. Empty when it is. */
  reasons: string[];

  temps: SmartTempSensor[];

  /**
   * NVMe percentage_used: the drive's own wear estimate, where 100 means the
   * rated endurance is spent. Null for anything without a wear indicator —
   * spinning disks have none, and inventing one from power-on hours would be
   * fabrication.
   */
  wearPct: number | null;
  availableSparePct: number | null;
  availableSpareThresholdPct: number | null;

  powerOnHours: number | null;
  powerCycles: number | null;
  unsafeShutdowns: number | null;
  /** Unrecoverable media errors. Any nonzero value is serious. */
  mediaErrors: number | null;
  /** Entries in the NVMe error log. Routinely nonzero and benign — a fact, not an alarm. */
  errorLogEntries: number | null;
  /** NVMe critical warning bitfield. Nonzero means the drive is asking for help. */
  criticalWarning: number | null;

  bytesWritten: number | null;
  bytesRead: number | null;

  /**
   * Hours until wear reaches 100%, extrapolated from the lifetime average rate
   * (powerOnHours / wearPct × remaining). Null when wearPct is 0 or absent,
   * because no rate can be derived from zero wear — that case must render as
   * "not yet measurable", never as infinity.
   *
   * This is a lifetime average, so it is a floor-level sanity figure, not a
   * forecast: a drive that idled for a year and is now hammered will outrun it.
   */
  projectedHoursRemaining: number | null;

  ata: AtaAttribute[];
}

/** A kernel-maintained filesystem error counter. The cheapest corruption alarm there is. */
export interface FsErrorCounter {
  /** Block device name as ext4 exposes it, e.g. "sda1", "dm-0". */
  device: string;
  /** Resolved mountpoint, when we could match one. */
  mount: string | null;
  /** Friendly name for dm devices, e.g. "ubuntu--vg-ubuntu--lv". */
  displayName: string;
  errors: number;
  /** Unix seconds, or null when never. */
  firstErrorAt: number | null;
  lastErrorAt: number | null;
}

export interface LvmGroup {
  /** Volume group name, e.g. "ubuntu-vg". */
  name: string;
  /** Logical volume name, e.g. "ubuntu-lv". */
  lv: string;
  /** dm device backing it, e.g. "dm-0". */
  dm: string;
  /** Physical volumes underneath, e.g. ["nvme0n1p3"]. */
  pvs: string[];
}

export interface MdArray {
  name: string;
  level: string | null;
  state: string | null;
  /** e.g. "[UU]" → 2 of 2 present. */
  activeDisks: number | null;
  totalDisks: number | null;
  degraded: boolean;
  members: string[];
}

export interface PoolState {
  name: string;
  /** ONLINE / DEGRADED / FAULTED / etc., verbatim from the kernel. */
  state: string;
  degraded: boolean;
  /** Per-device error tallies where the filesystem exposes them (Btrfs). */
  deviceErrors: { device: string; errors: number }[];
}

/**
 * A volume manager that may or may not exist on this host. `present: false` is a
 * first-class, non-alarming state — it means "you do not use this", not "it broke".
 */
export interface VolumeManagerState {
  kind: "zfs" | "btrfs";
  present: boolean;
  pools: PoolState[];
  /** Set when present but not enumerable, e.g. module loaded with no pools imported. */
  note: string | null;
}

export interface ArrayIntegrity {
  /** RAID personalities the kernel supports, from /proc/mdstat's first line. */
  raidPersonalities: string[];
  mdArrays: MdArray[];
  lvm: LvmGroup[];
  zfs: VolumeManagerState;
  btrfs: VolumeManagerState;
  filesystems: FsErrorCounter[];
  verdict: HealthVerdict;
  reasons: string[];
}

export interface SmartSnapshot {
  /** When this response was assembled. */
  ts: number;
  /** When the host collector last published, from inside the file. */
  collectorTs: number | null;
  /** Age of that publish. Null when the file is missing entirely. */
  collectorAgeMs: number | null;
  smartctlVersion: string | null;
  drives: DriveHealth[];
  integrity: ArrayIntegrity;
  /** Worst verdict across every drive and the integrity block. */
  overall: HealthVerdict;
  /** Set when the snapshot could not be built at all. Drives will be empty. */
  error: string | null;
}
