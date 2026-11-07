/** Pure view decisions for the Hermes failed-run panel, the disk scan jobs and the disk growth panel (hunt 12). */
import { redactLogText } from "./redact.ts";
import { SERIES_SLOTS } from "./chart-series.ts";

export const SCAN_STATUS_LOST = "Scan status lost. Run the scan again.";

/** Hermes error text is shown raw otherwise: it can carry a credential from a failing command. */
export function failedRunText(error: string | null | undefined): string {
  return (error ? redactLogText(error) : "") || "Hermes reported an error with no further detail.";
}

interface JobLike {
  state: "running" | "done" | "error";
  root: string;
}

/** Fast poll only while the latest state is running and the GET is not failing. */
export function scanPollInterval(latest: JobLike | undefined, error: unknown): number {
  return !error && latest && latest.state === "running" ? 800 : 0;
}

export function scanView(job: JobLike | null, error: unknown, scanRoot: string) {
  const statusLost = !!error;
  const running = !statusLost && job?.state === "running" && job.root === scanRoot;
  const showResults = !!job && job.root === scanRoot && job.state !== "running";
  return { running, statusLost, showResults };
}

export function cappedMounts(mounts: string[]): { shown: string[]; dropped: number } {
  const shown = mounts.slice(0, SERIES_SLOTS.length);
  return { shown, dropped: mounts.length - shown.length };
}

export function moreMountsNote(n: number): string {
  return `+${n} more mount${n === 1 ? "" : "s"} not shown`;
}

interface Bucket {
  t: number;
  usedBytes: number | null;
}

/** First-vs-last real sample per mount; a mount that is not growing never wins. */
export function fastestGrowing(mounts: Record<string, Bucket[]>) {
  let fastest: { mount: string; deltaBytes: number; deltaPerDay: number } | null = null;
  for (const [mount, points] of Object.entries(mounts)) {
    const real = points.filter((p): p is { t: number; usedBytes: number } => p.usedBytes != null);
    if (real.length < 2) continue;
    const first = real[0];
    const last = real[real.length - 1];
    const deltaBytes = last.usedBytes - first.usedBytes;
    const deltaDays = Math.max(1 / 24, (last.t - first.t) / 86_400_000);
    const deltaPerDay = deltaBytes / deltaDays;
    if (deltaPerDay <= 0) continue;
    if (!fastest || deltaPerDay > fastest.deltaPerDay) fastest = { mount, deltaBytes, deltaPerDay };
  }
  return fastest;
}
