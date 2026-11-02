/**
 * Pure logic for the "mount is unreadable / drive disconnected" attention probe.
 * Import-free so node:test can load it. Only the errors a dead or hung mount
 * produces count; ENOENT/EACCES etc. say nothing about drive health and stay
 * silent. EROFS is not listed: a mount that ext4 remounted read-only after
 * errors still answers a readdir, so it cannot be seen here.
 */
export const MOUNT_DEAD_CODES = ["EIO", "ENOTCONN", "ESTALE", "ENODEV", "ENXIO", "TIMEOUT"] as const;

export type MountVerdict = { headline: string; detail: string };

export function classifyMountError(mount: string, code: string | undefined): MountVerdict | null {
  if (!code || !(MOUNT_DEAD_CODES as readonly string[]).includes(code)) return null;
  return {
    headline: `Drive unreadable: ${mount}`,
    detail:
      code === "TIMEOUT"
        ? "It is not answering (timed out). It may have dropped off."
        : `Reads from it are failing (${code}). It may have dropped off and need a remount or a restart.`,
  };
}

/**
 * The sysfs name of a mount source, or null when it has no plain
 * /sys/class/block/<name> entry: mapper paths and /dev/root are aliases.
 * shortcut: device-mapper mounts are not checked, add a dm-name lookup if one ever holds data.
 */
export function blockDeviceName(device: string | undefined): string | null {
  const name = device?.startsWith("/dev/") ? device.slice(5) : "";
  return name && !name.includes("/") && name !== "root" ? name : null;
}

/** SCSI/SATA disks report "running", NVMe controllers "live"; anything else is offline or going away. */
const HEALTHY_DEVICE_STATES = ["running", "live"];

/**
 * The 2026-10-09 failure: the drive left the bus and came back under a new
 * name, while the mount stayed on the old device. `exists` = its
 * /sys/class/block entry is still there; `state` = the parent disk's
 * device/state, or null when there is no such file.
 */
export function classifyDeviceGone(
  mount: string,
  name: string,
  exists: boolean,
  state: string | null,
): MountVerdict | null {
  if (exists && (state === null || HEALTHY_DEVICE_STATES.includes(state.trim()))) return null;
  return {
    headline: `Drive disconnected: ${mount}`,
    detail: `Its drive (${name}) has dropped off, but the mount still points at it. It needs a remount or a restart.`,
  };
}

const pending = new Map<string, Promise<unknown>>();

/**
 * Runs `read` with a `ms` cap and returns its error code, "TIMEOUT", or
 * undefined when it succeeded. A hung fs call cannot be cancelled and holds a
 * libuv thread until the kernel gives up, so while one is still pending for
 * `key` no new one starts and the answer stays TIMEOUT.
 */
export async function probeOne(key: string, read: () => Promise<unknown>, ms: number): Promise<string | undefined> {
  if (pending.has(key)) return "TIMEOUT";
  const result = Promise.resolve()
    .then(read)
    .then(
      () => undefined,
      (e: { code?: string } | undefined) => e?.code,
    );
  pending.set(key, result);
  void result.then(() => pending.delete(key));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const code = await Promise.race([
    result,
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), ms);
    }),
  ]);
  clearTimeout(timer);
  return code;
}
