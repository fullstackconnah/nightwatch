"use client";

import { cn } from "@/lib/utils";

/** Filled sparkline/area chart, no axes — for live stat history. */
export function Sparkline({
  data,
  max,
  className,
  stroke = "var(--color-accent)",
  height = 48,
}: {
  data: number[];
  max?: number;
  className?: string;
  stroke?: string;
  height?: number;
}) {
  const W = 240;
  const H = height;
  if (data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-ink-faint text-xs", className)}
        style={{ height: H }}
      >
        collecting…
      </div>
    );
  }
  const peak = max ?? Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - 3 - (Math.min(v, peak) / peak) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height: H }}
    >
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

/** Horizontal meter bar with threshold colouring.
 *  `label` is optional so existing call sites (kiosk-vitals, vitals-strip,
 *  resources/page) keep compiling untouched — it only adds an accessible
 *  name when a caller opts in. */
export function Meter({
  percent,
  className,
  warnAt = 80,
  badAt = 92,
  label,
}: {
  percent: number;
  className?: string;
  warnAt?: number;
  badAt?: number;
  label?: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const color =
    p >= badAt ? "var(--color-bad)" : p >= warnAt ? "var(--color-warn)" : "var(--color-accent)";
  return (
    <div
      className={cn("h-1.5 w-full rounded-full bg-line/60 overflow-hidden", className)}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {/* Same value as the bar width, as real text — mirrors how Gauge
          overlays its {Math.round(p)}% instead of relying on pixel width
          alone. Visually hidden: the bar itself is the intended visual. */}
      <span className="sr-only">{Math.round(p)}%</span>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${p}%`,
          background: color,
          // color-mix, not a hex-alpha suffix: `color` is a var() reference,
          // so `${color}55` used to concatenate into the literal string
          // "var(--color-bad)55" — invalid CSS, silently dropped, meaning
          // this glow has never once rendered. 33% matches the "same trick"
          // DESIGN.md documents for meter fills (color-mix is the same
          // mechanism .dot-live and .voice-mic-recording already use here).
          boxShadow: `0 0 6px color-mix(in srgb, ${color} 33%, transparent)`,
        }}
      />
    </div>
  );
}

/** Ring gauge for the CPU headline number. */
export function Gauge({
  percent,
  size = 72,
  label,
}: {
  percent: number;
  size?: number;
  label: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color =
    p >= 92 ? "var(--color-bad)" : p >= 80 ? "var(--color-warn)" : "var(--color-accent)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (p / 100) * c}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-sm font-semibold">{Math.round(p)}%</span>
        <span className="microlabel !text-[0.5rem]">{label}</span>
      </div>
    </div>
  );
}
