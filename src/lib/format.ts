export function formatBytes(n: number | undefined | null, digits = 1): string {
  if (n == null || isNaN(n)) return "—";
  // Rounded, not raw: every other branch is fixed to `digits`, and callers now
  // include derived per-second rates, which are floats. Without this a sub-KiB
  // rate renders as "937.9528663389771 B/s".
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let i = -1;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatRate(bytesPerSec: number | undefined | null): string {
  if (bytesPerSec == null || isNaN(bytesPerSec)) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Media bitrate, in decimal Mbps/kbps — the unit video actually gets quoted in.
 * Deliberately NOT formatRate(bits/8): that renders binary bytes ("1.2 MiB/s"),
 * which is a correct number in the wrong idiom for a stream's bitrate.
 */
export function formatBitrate(bitsPerSec: number | undefined | null): string {
  if (bitsPerSec == null || isNaN(bitsPerSec)) return "—";
  if (bitsPerSec >= 1_000_000) return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  if (bitsPerSec >= 1000) return `${Math.round(bitsPerSec / 1000)} kbps`;
  return `${Math.round(bitsPerSec)} bps`;
}

/**
 * Two significant units, largest first. Sub-minute spans report seconds rather
 * than the "0m" this used to render — the one span where that matters most is a
 * container that has just been restarted, which is exactly when someone is
 * watching the counter.
 */
export function formatUptime(seconds: number | undefined | null): string {
  if (seconds == null || isNaN(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

export function formatPercent(v: number | undefined | null, digits = 0): string {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function formatNumber(v: number | undefined | null): string {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString("en-AU");
}

export function relativeTime(iso: string | number | Date): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
