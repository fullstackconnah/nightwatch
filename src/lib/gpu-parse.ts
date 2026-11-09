// Pure nvidia-smi parsing helpers, split out of gpu.ts so node:test can load them.

/** A failed (timed-out or thrown) temperature-ceiling lookup is retried after this long. */
export const TEMP_MAX_RETRY_MS = 60_000;

export function tempMaxRetryDue(failedAt: number, now: number): boolean {
  return now - failedAt >= TEMP_MAX_RETRY_MS;
}

/**
 * Pulls "GPU Slowdown Temp" (or, failing that, "GPU Shutdown Temp") out of
 * `nvidia-smi -q -d TEMPERATURE` output. That's the only place this driver
 * exposes a usable thermal ceiling - see the DEVICE_FIELDS comment in gpu.ts.
 *
 * Falls back to Shutdown only when Slowdown itself is unsupported or blank.
 */
export function parseTempMaxC(report: string): number | null {
  return parseThresholdLine(report, "GPU Slowdown Temp") ?? parseThresholdLine(report, "GPU Shutdown Temp");
}

/**
 * Finds the line whose label (everything before the LAST ":") trims to
 * exactly `label`, and parses the value after it.
 */
function parseThresholdLine(report: string, label: string): number | null {
  for (const line of report.split("\n")) {
    const sep = line.lastIndexOf(":");
    if (sep === -1 || line.slice(0, sep).trim() !== label) continue;
    const value = line.slice(sep + 1).trim();
    // Blank must return before Number(): Number("") is 0, which would skip the Shutdown fallback.
    if (value === "" || value === "N/A") return null;
    const n = Number(value.replace(/\s*C$/i, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compute-apps rows are pid, process_name, used_memory. A process name may hold
 * commas, so everything between the first and last column is the name.
 */
export function rejoinProcessRow(cols: string[]): string[] {
  if (cols.length <= 3) return cols;
  return [cols[0], cols.slice(1, -1).join(","), cols[cols.length - 1]];
}
