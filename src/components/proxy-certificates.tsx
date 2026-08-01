"use client";

import { certVariant } from "@/components/proxy-routes";
import type { ProxyCertificate } from "@/lib/npm-types";
import { cn } from "@/lib/utils";

/**
 * Certificates panel: expiry-sorted (soonest first, server-side — see npm.ts),
 * one row per NPM certificate. A mono day count with a microlabel underneath is
 * the Threshold Rule's own idiom — the figure is the reading, the label says
 * what it means, and colour only appears once a real threshold is crossed.
 */

function DaysFigure({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) {
    return (
      <div className="text-right shrink-0">
        <div className="font-mono text-sm text-ink-faint tabular-nums">—</div>
        <div className="microlabel">no expiry</div>
      </div>
    );
  }
  const variant = certVariant(daysLeft);
  const colorClass = variant === "bad" ? "text-bad" : variant === "warn" ? "text-warn" : "text-ink";
  const expired = daysLeft < 0;
  return (
    <div className="text-right shrink-0">
      <div className={cn("font-mono text-sm tabular-nums", colorClass)}>
        {expired ? Math.abs(daysLeft) : daysLeft}
      </div>
      <div className="microlabel">{expired ? "days expired" : "days left"}</div>
    </div>
  );
}

export function CertificatesPanel({ certificates }: { certificates: ProxyCertificate[] }) {
  if (certificates.length === 0) {
    return (
      <section className="panel p-4">
        <h2 className="text-sm font-semibold tracking-tight">Certificates</h2>
        <p className="text-sm text-ink-dim mt-2">No certificates issued in NPM yet.</p>
      </section>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <div className="px-3 pt-3 pb-2 border-b border-line">
        <h2 className="text-sm font-semibold tracking-tight">Certificates</h2>
        <p className="text-[0.7rem] text-ink-faint mt-0.5">
          {certificates.length} {certificates.length === 1 ? "certificate" : "certificates"} ·
          soonest expiry first
        </p>
      </div>
      <ul>
        {certificates.map((c) => (
          <li
            key={c.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 border-b border-line/50 last:border-0",
              certVariant(c.daysLeft) === "bad" && "bg-bad/5",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs text-ink truncate" title={c.domains.join(", ")}>
                {c.domains.join(", ") || "—"}
              </div>
              <div className="microlabel mt-0.5">{c.provider}</div>
            </div>
            <DaysFigure daysLeft={c.daysLeft} />
          </li>
        ))}
      </ul>
    </section>
  );
}
