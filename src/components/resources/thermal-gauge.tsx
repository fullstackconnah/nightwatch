"use client";

import { useEffect, useState } from "react";

/**
 * Hand-rolled 270° arc gauge for GPU core temperature. This is the surface's ONE
 * authored motion moment (src/app/(dash)/gpu/page.tsx) — no other element on that
 * page animates on mount.
 */
export function ThermalGauge({
  tempC,
  maxC,
  size = 140,
  className,
}: {
  tempC: number | null;
  maxC: number | null;
  size?: number;
  className?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;

  // 270deg sweep with the gap at the bottom. SVG's y axis points DOWN, so angles run
  // clockwise from 0deg = right: 45 = lower-right, 135 = lower-left, 225 = upper-left,
  // 270 = top, 315 = upper-right. Starting at 135 and ending at 405 (= 45 + 360) sweeps
  // clockwise through left, top and right, leaving the bottom 90deg open.
  //
  // END must stay 405 rather than the equivalent 45: the arc length, the largeArc flag
  // and the dash maths are all derived from (END - START), and a start and end that
  // reduce to the same point make the SVG arc degenerate — it renders nothing at all.
  const START_ANGLE = 135;
  const END_ANGLE = 405;

  function polar(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function arcPath(startAngle: number, endAngle: number, radius: number): string {
    const start = polar(startAngle, radius);
    const end = polar(endAngle, radius);
    const sweep = endAngle - startAngle;
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  // Domain: 20degC -> maxC (or 95 fallback). Guard non-positive/inverted domains so
  // the path/dash math can never produce NaN.
  const domainMin = 20;
  const domainMaxRaw = maxC ?? 95;
  const domainMax = domainMaxRaw > domainMin ? domainMaxRaw : domainMin + 1;
  const domainSpan = domainMax - domainMin;

  const trackPath = arcPath(START_ANGLE, END_ANGLE, r);
  const totalAngle = END_ANGLE - START_ANGLE; // 270

  // Approximate arc length via the circle circumference fraction — used for
  // stroke-dasharray/dashoffset animation.
  const arcLength = (Math.abs(totalAngle) / 360) * 2 * Math.PI * r;

  const hasReading = tempC !== null;
  const clamped = hasReading ? Math.min(domainMax, Math.max(domainMin, tempC as number)) : domainMin;
  const frac = hasReading ? (clamped - domainMin) / domainSpan : 0;
  const valueLength = arcLength * frac;

  // Threshold colours against the real domain: <75% -> accent, 75-90% -> warn, >90% -> bad.
  // When maxC is null, fall back to absolute 75/85 degC cutoffs (noted here per spec).
  let color = "var(--color-accent)";
  if (hasReading) {
    if (maxC != null) {
      if (frac >= 0.9) color = "var(--color-bad)";
      else if (frac >= 0.75) color = "var(--color-warn)";
    } else {
      const t = tempC as number;
      if (t >= 85) color = "var(--color-bad)";
      else if (t >= 75) color = "var(--color-warn)";
    }
  }

  const label = hasReading
    ? `core temperature ${Math.round(tempC as number)}°C of ${Math.round(domainMax)}°C maximum`
    : "core temperature unavailable";

  const endLabelPos = polar(END_ANGLE, r + 10);
  const startLabelPos = polar(START_ANGLE, r + 10);

  // The arc sweeps up from empty on first paint instead of appearing already filled.
  // Rendering the empty state first also keeps the server and client markup identical,
  // so this cannot cause a hydration mismatch. Subsequent 1Hz updates ease from the
  // previous value through the same transition.
  const [swept, setSwept] = useState(false);
  useEffect(() => setSwept(true), []);

  return (
    <div
      className={className ? `relative ${className}` : "relative"}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <path d={trackPath} fill="none" stroke="var(--color-line)" strokeWidth={8} strokeLinecap="round" />
        {hasReading && (
          <path
            d={trackPath}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={swept ? arcLength - valueLength : arcLength}
            style={{
              transition:
                "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1), stroke 600ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="motion-reduce:transition-none"
          />
        )}
        <text
          x={startLabelPos.x}
          y={startLabelPos.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink-faint"
          style={{ fontSize: "0.5rem", letterSpacing: "0.08em" }}
        >
          {Math.round(domainMin)}
        </text>
        <text
          x={endLabelPos.x}
          y={endLabelPos.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink-faint"
          style={{ fontSize: "0.5rem", letterSpacing: "0.08em" }}
        >
          {Math.round(domainMax)}
        </text>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-ink leading-none">
          {hasReading ? Math.round(tempC as number) : "—"}
          {hasReading && <span className="text-sm text-ink-dim">°C</span>}
        </span>
        <span className="microlabel mt-1">{hasReading ? "CORE" : "NO READING"}</span>
      </div>
    </div>
  );
}
