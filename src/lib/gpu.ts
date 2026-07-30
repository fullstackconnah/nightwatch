import { execFile as execFileCb } from "node:child_process";
import fsp from "node:fs/promises";
import { promisify } from "node:util";
import { listContainers, type ContainerSummary } from "@/lib/docker";
import { HOST_PROC } from "@/lib/host-metrics";
import type { GpuDevice, GpuProcess, GpuSnapshot, GpuUnavailable, GpuUnavailableReason } from "@/lib/gpu-types";

/**
 * nvidia-smi collector. Server-only: child_process + dockerode must never reach
 * src/lib/client.ts (see the import-free-leaf comment in gpu-types.ts).
 */

const execFile = promisify(execFileCb);

// --format=csv,noheader,nounits is appended at the call site.
//
// nvidia-smi rejects the WHOLE --query-gpu request if a single field name is
// unsupported by the installed driver ("Field "x" is not a valid field to
// query."). This used to carry an extended/core tier fallback built around
// temperature.gpu.tmax, but measured on the real host (driver 580.173.02,
// GTX 980 / Maxwell): temperature.gpu.tmax is not a valid field on this driver
// at all - querying it fails every time, so the "extended" tier could never
// succeed and the fallback was pure overhead. temperature.gpu.tlimit was
// tried as a replacement and rejected too: it IS a recognized field name here,
// but reports [N/A] on this card, so it's equally useless. Don't re-add
// either - the real thermal ceiling comes from `nvidia-smi -q -d TEMPERATURE`
// instead (see getTempMaxC below), which is the only place this driver
// reports it.
const DEVICE_FIELDS = [
  "index",
  "name",
  "uuid",
  "utilization.gpu",
  "utilization.memory",
  "memory.used",
  "memory.total",
  "temperature.gpu",
  "fan.speed",
  "power.draw",
  "power.limit",
  "clocks.current.sm",
  "encoder.stats.sessionCount",
  "encoder.stats.averageFps",
  "encoder.stats.averageLatency",
  "driver_version",
] as const;

const DEVICE_QUERY = DEVICE_FIELDS.join(",");

const PROCESS_QUERY = "pid,process_name,used_memory";

// nvidia-smi reports memory in MiB (nounits strips the "MiB" suffix but not the scale).
const MIB_TO_BYTES = 1024 * 1024;

const NVIDIA_SMI_TIMEOUT_MS = 3000;

// --- availability backoff ---------------------------------------------------

interface UnavailableCacheEntry {
  reason: GpuUnavailableReason;
  detail: string;
  ts: number;
}

// Mirrors docker.ts's globalForDocker pattern: state on globalThis survives Next
// dev HMR reloads of this module.
//
// __gpuTempMaxC caches the one-time `nvidia-smi -q -d TEMPERATURE` lookup (see
// getTempMaxC) - a hardware/driver constant that cannot change while the
// process lives, so it's paid at most once rather than on every 1Hz tick.
// undefined means "not looked up yet"; null means "looked up, this card/driver
// has no usable threshold" - a plain `number | null` can't tell those two
// states apart, so "not yet looked up" is left as the absent/undefined case
// rather than adding a separate boolean flag.
const globalForGpu = globalThis as unknown as {
  __gpuUnavailableCache?: UnavailableCacheEntry;
  __gpuTempMaxC?: number | null;
};

// The telemetry loop ticks every second. When the host is in a driver-mismatch
// or no-binary state, every one of those ticks would otherwise spawn a doomed
// nvidia-smi process — 60 wasted spawns a minute. Cache the unavailable verdict
// for a minute instead. A SUCCESSFUL snapshot is deliberately never cached here;
// it must be fresh every tick.
const UNAVAILABLE_BACKOFF_MS = 60_000;

function cacheUnavailable(result: { reason: GpuUnavailableReason; detail: string }): GpuUnavailable {
  globalForGpu.__gpuUnavailableCache = { ...result, ts: Date.now() };
  return { ok: false, ...result };
}

// --- csv cell parsing --------------------------------------------------------

/**
 * Single helper for nvidia-smi's "no value" sentinels ([N/A], [Not Supported],
 * [Unknown Error]) and empty cells, so the check isn't repeated at every field.
 */
function cell(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t || t === "[N/A]" || t === "[Not Supported]" || t === "[Unknown Error]") return null;
  return t;
}

function cellNumber(raw: string | undefined): number | null {
  const v = cell(raw);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * utilizationPct/memUtilizationPct/memUsedBytes/memTotalBytes are typed as plain
 * `number` (not nullable) in GpuDevice — those four back a bar/gauge that has no
 * sensible way to render null, unlike the rest of the device fields which are
 * genuinely optional readouts. 0 is the least-wrong fallback when nvidia-smi
 * can't report them.
 */
function cellNumberOrZero(raw: string | undefined): number {
  return cellNumber(raw) ?? 0;
}

function mibToBytes(mib: number): number {
  return mib * MIB_TO_BYTES;
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

function splitNonEmptyLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// --- failure classification --------------------------------------------------

interface ExecFileError extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/** First non-empty trimmed line of stderr, falling back to the error message,
 * truncated to 200 chars. Rendered verbatim to the user — no editorializing. */
function extractDetail(stderr: string, fallbackMessage: string): string {
  const line = firstNonEmptyLine(stderr) || fallbackMessage.trim();
  return line.length > 200 ? line.slice(0, 200) : line;
}

function classifyFailure(err: unknown): { reason: GpuUnavailableReason; detail: string } {
  const e = err as ExecFileError;
  const stderr = e?.stderr ?? "";
  const stdout = e?.stdout ?? "";
  const message = e?.message ?? "";
  const combined = `${stderr}\n${stdout}`;
  const detail = extractDetail(stderr, message);

  if (e?.code === "ENOENT" || /is not recognized|command not found|no such file or directory/i.test(message)) {
    return { reason: "no-binary", detail };
  }
  if (combined.includes("Driver/library version mismatch")) {
    return { reason: "driver-mismatch", detail };
  }
  if (combined.includes("No devices were found") || combined.includes("NVIDIA-SMI has failed")) {
    return { reason: "no-device", detail };
  }
  if (isUnsupportedFieldError(err)) {
    // A field in DEVICE_FIELDS regressed on this driver. There's no fallback
    // tier to recover into (see DEVICE_FIELDS comment) - this branch exists
    // purely so `detail` carries nvidia-smi's own message (already pulled
    // from stderr by extractDetail above), which names the offending field,
    // instead of silently falling into the generic catch-all below.
    return { reason: "error", detail };
  }
  // Timeout, unparseable output, or anything else uncategorized.
  return { reason: "error", detail };
}

/**
 * True when nvidia-smi rejected the whole --query-gpu request because ONE
 * field name in DEVICE_FIELDS isn't recognized by this driver version. There
 * is no fallback tier to recover into anymore (see DEVICE_FIELDS comment) -
 * this now exists purely so classifyFailure can surface nvidia-smi's own
 * message, which names the offending field, instead of a generic "error".
 */
function isUnsupportedFieldError(err: unknown): boolean {
  const e = err as ExecFileError;
  const combined = `${e?.stderr ?? ""}\n${e?.stdout ?? ""}\n${e?.message ?? ""}`;
  return /is not a valid field to query|invalid field/i.test(combined);
}

// --- device rows ---------------------------------------------------------------

interface ParsedDeviceRow {
  device: GpuDevice;
  driverVersion: string;
}

/**
 * Maps field name -> CSV column index. Keyed by name rather than position so
 * that reordering or resizing DEVICE_FIELDS can never silently misalign a
 * column - the failure mode a fixed positional parser would have.
 */
function buildFieldIndex(fields: readonly string[]): Map<string, number> {
  return new Map(fields.map((name, i) => [name, i]));
}

/** Row cell for a named field, or undefined if `name` isn't in the index at
 * all. Callers feed that straight into cell()/cellNumber(), which already
 * treat undefined as "no value" - kept general in case a future field list
 * doesn't carry every name. */
function fieldCell(row: string[], index: Map<string, number>, name: string): string | undefined {
  const i = index.get(name);
  return i === undefined ? undefined : row[i];
}

function parseDeviceRows(stdout: string): ParsedDeviceRow[] {
  const index = buildFieldIndex(DEVICE_FIELDS);
  const get = (row: string[], name: string) => fieldCell(row, index, name);
  const rows: ParsedDeviceRow[] = [];
  for (const line of splitNonEmptyLines(stdout)) {
    const c = parseCsvLine(line);
    if (c.length < DEVICE_FIELDS.length) continue; // malformed row - skip rather than throw
    const device: GpuDevice = {
      index: cellNumberOrZero(get(c, "index")),
      name: cell(get(c, "name")) ?? "Unknown GPU",
      uuid: cell(get(c, "uuid")) ?? "",
      utilizationPct: cellNumberOrZero(get(c, "utilization.gpu")),
      memUtilizationPct: cellNumberOrZero(get(c, "utilization.memory")),
      memUsedBytes: mibToBytes(cellNumberOrZero(get(c, "memory.used"))),
      memTotalBytes: mibToBytes(cellNumberOrZero(get(c, "memory.total"))),
      tempC: cellNumber(get(c, "temperature.gpu")),
      // Not in DEVICE_FIELDS at all - this driver has no usable "max temp"
      // --query-gpu field (see DEVICE_FIELDS comment). getGpuSnapshot fills
      // this in afterwards from the separate `-q -d TEMPERATURE` lookup.
      tempMaxC: null,
      fanPct: cellNumber(get(c, "fan.speed")),
      powerWatts: cellNumber(get(c, "power.draw")),
      powerLimitWatts: cellNumber(get(c, "power.limit")),
      smClockMhz: cellNumber(get(c, "clocks.current.sm")),
      encoderSessions: cellNumber(get(c, "encoder.stats.sessionCount")),
      encoderAvgFps: cellNumber(get(c, "encoder.stats.averageFps")),
      encoderAvgLatencyUs: cellNumber(get(c, "encoder.stats.averageLatency")),
      processes: [], // filled in by getGpuSnapshot after the compute-apps query
    };
    rows.push({ device, driverVersion: cell(get(c, "driver_version")) ?? "" });
  }
  return rows;
}

// --- pid -> container attribution --------------------------------------------

// Matches both cgroup layouts docker can produce for a container's cgroup path:
//  - cgroup v2, systemd-managed: "0::/system.slice/docker-<64hex>.scope"
//  - cgroupfs (v1, or v2 without systemd): ".../docker/<64hex>[/...]"
const CONTAINER_ID_RE = /docker-([0-9a-f]{64})\.scope|\/docker\/([0-9a-f]{64})(?:[/\n]|$)/;

function extractContainerId(cgroupContent: string): string | null {
  const m = cgroupContent.match(CONTAINER_ID_RE);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

async function readContainerIdForPid(pid: number): Promise<string | null> {
  try {
    const content = await fsp.readFile(`${HOST_PROC}/${pid}/cgroup`, "utf8");
    return extractContainerId(content);
  } catch {
    // Process exited between the compute-apps call and this read, or it's a
    // host process with no docker cgroup at all - both are normal, not errors.
    return null;
  }
}

async function resolveContainerNames(containerIds: (string | null)[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(containerIds.filter((id): id is string => id !== null))];
  if (uniqueIds.length === 0) return new Map();

  let containers: ContainerSummary[];
  try {
    containers = await listContainers();
  } catch {
    return new Map();
  }

  // listContainers() already strips the leading "/" Docker puts on names.
  const map = new Map<string, string>();
  for (const id of uniqueIds) {
    const match = containers.find((c) => c.id === id || c.id.startsWith(id));
    if (match) map.set(id, match.name);
  }
  return map;
}

async function buildProcesses(rows: string[][]): Promise<GpuProcess[]> {
  const parsed = rows
    .map((r) => ({ pid: cellNumber(r[0]), name: cell(r[1]) ?? "", memMiB: cellNumber(r[2]) }))
    .filter((p): p is { pid: number; name: string; memMiB: number | null } => p.pid !== null);

  // Concurrent, not sequential - each is an independent /proc read.
  const containerIds = await Promise.all(parsed.map((p) => readContainerIdForPid(p.pid)));
  const nameMap = await resolveContainerNames(containerIds);

  return parsed.map((p, i) => {
    const containerId = containerIds[i];
    return {
      pid: p.pid,
      name: p.name,
      memBytes: p.memMiB !== null ? mibToBytes(p.memMiB) : 0,
      containerId,
      containerName: containerId !== null ? (nameMap.get(containerId) ?? null) : null,
    };
  });
}

// --- thermal threshold (tempMaxC) --------------------------------------------

/**
 * Pulls "GPU Slowdown Temp" (or, failing that, "GPU Shutdown Temp") out of
 * `nvidia-smi -q -d TEMPERATURE` output. That's the only place this driver
 * exposes a usable thermal ceiling - see the DEVICE_FIELDS comment for why the
 * --query-gpu CSV route (temperature.gpu.tmax / .tlimit) doesn't work here.
 *
 * Falls back to Shutdown only when Slowdown itself is unsupported. GpuDevice
 * has just the one tempMaxC field (see its comment in gpu-types.ts), so
 * taking this fallback means the gauge's ceiling silently becomes the
 * shutdown point rather than the slowdown point for that card.
 */
function parseTempMaxC(report: string): number | null {
  return parseThresholdLine(report, "GPU Slowdown Temp") ?? parseThresholdLine(report, "GPU Shutdown Temp");
}

/**
 * Finds the line whose label (everything before the LAST ":") trims to
 * exactly `label`, and parses the value after it. These report lines only
 * ever use ":" as the label/value separator, but splitting on the last one
 * rather than the first is cheap insurance if a label ever grows a colon.
 */
function parseThresholdLine(report: string, label: string): number | null {
  for (const line of report.split("\n")) {
    const sep = line.lastIndexOf(":");
    if (sep === -1 || line.slice(0, sep).trim() !== label) continue;
    const value = line.slice(sep + 1).trim();
    if (value === "N/A") return null;
    const n = Number(value.replace(/\s*C$/i, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function queryTempMaxC(): Promise<number | null> {
  try {
    const result = await execFile("nvidia-smi", ["-q", "-d", "TEMPERATURE"], {
      timeout: NVIDIA_SMI_TIMEOUT_MS,
      windowsHide: true,
    });
    return parseTempMaxC(result.stdout);
  } catch {
    // Non-fatal by design: the device query in getGpuSnapshot has already
    // succeeded by the time this runs, so a failed/timed-out threshold lookup
    // must not turn a working GPU into an unavailable one - tempMaxC just
    // stays null for this process.
    return null;
  }
}

/** Runs queryTempMaxC() at most once per process - see the __gpuTempMaxC
 * comment on globalForGpu for why undefined vs null carries meaning here. */
async function getTempMaxC(): Promise<number | null> {
  if (globalForGpu.__gpuTempMaxC !== undefined) return globalForGpu.__gpuTempMaxC;
  const value = await queryTempMaxC();
  globalForGpu.__gpuTempMaxC = value;
  return value;
}

// --- main ---------------------------------------------------------------------

export async function getGpuSnapshot(): Promise<GpuSnapshot> {
  const cached = globalForGpu.__gpuUnavailableCache;
  if (cached && Date.now() - cached.ts < UNAVAILABLE_BACKOFF_MS) {
    return { ok: false, reason: cached.reason, detail: cached.detail };
  }

  let deviceStdout: string;
  try {
    const result = await execFile(
      "nvidia-smi",
      [`--query-gpu=${DEVICE_QUERY}`, "--format=csv,noheader,nounits"],
      { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true },
    );
    deviceStdout = result.stdout;
  } catch (err) {
    return cacheUnavailable(classifyFailure(err));
  }

  const rows = parseDeviceRows(deviceStdout);
  if (rows.length === 0) {
    return cacheUnavailable({ reason: "no-device", detail: "nvidia-smi returned no parseable GPU rows" });
  }

  // Kicked off here rather than awaited immediately: it's a real nvidia-smi
  // call only on the first tick this process (see getTempMaxC), and there's
  // no reason to serialize it behind the compute-apps query below.
  const tempMaxCPromise = getTempMaxC();

  // Best-effort: a failed/timed-out compute-apps query must not invalidate the
  // device data that already succeeded - it just means no process attribution
  // this tick.
  let processRows: string[][] = [];
  try {
    const result = await execFile(
      "nvidia-smi",
      [`--query-compute-apps=${PROCESS_QUERY}`, "--format=csv,noheader,nounits"],
      { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true },
    );
    processRows = splitNonEmptyLines(result.stdout).map(parseCsvLine);
  } catch {
    processRows = [];
  }

  const processes = await buildProcesses(processRows);
  // PROCESS_QUERY deliberately has no per-GPU identifier (no gpu_uuid column),
  // so compute-app processes can't be attributed to a specific device - attach
  // the full list to device 0, which is correct for the common single-GPU host.
  // A multi-GPU host would need gpu_uuid added to PROCESS_QUERY to split this.
  rows[0].device.processes = processes;

  const tempMaxC = await tempMaxCPromise;
  for (const row of rows) row.device.tempMaxC = tempMaxC;

  return { ok: true, driverVersion: rows[0].driverVersion, devices: rows.map((r) => r.device) };
}
