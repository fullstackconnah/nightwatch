"use client";

import { Badge } from "@/components/ui/badge";
import { certVariant } from "@/lib/proxy/page-model";
import type { ProxyRoute, RouteCertRef, RouteHealth } from "@/lib/types/npm";
import { cn } from "@/lib/utils";

/**
 * The Routes strip's detail: one row per NPM proxy or redirection host. Health and enabled state lead every row — a
 * disabled route or a route whose upstream is down is the thing worth noticing, not the domain name. The count and
 * up/down summary moved to the strip's state line (R18).
 */

/** The cert tone rule lives with the model (node-testable); kept exported here for the callers that imported it. */
export { certVariant };

export function CertBadge({ cert }: { cert: RouteCertRef | null }) {
  if (!cert) {
    return <Badge variant="neutral">no ssl</Badge>;
  }
  const variant = certVariant(cert.daysLeft);
  const label =
    cert.daysLeft === null
      ? "no expiry"
      : cert.daysLeft < 0
        ? `expired ${Math.abs(cert.daysLeft)}d ago`
        : `${cert.daysLeft}d`;
  return <Badge variant={variant}>{label}</Badge>;
}

/** Steady green for up, steady red for down — the existing dot vocabulary. Unknown
 *  (disabled route, or a redirection target that is never probed) gets the same
 *  hatched treatment DESIGN.md's Hatch-Not-Empty Rule uses for an absent
 *  measurement, drawn at dot scale instead of a blank or a third solid colour. */
function HealthDot({ health }: { health: RouteHealth }) {
  if (health === "up") return <span className="dot dot-running" aria-hidden />;
  if (health === "down") return <span className="dot dot-dead" aria-hidden />;
  return (
    <span
      className="dot"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 2px, var(--color-line-bright) 2px 3px)",
        boxShadow: "inset 0 0 0 1px var(--color-line-bright)",
      }}
      aria-hidden
    />
  );
}

const HEALTH_LABEL: Record<RouteHealth, string> = {
  up: "upstream answered",
  down: "upstream unreachable",
  unknown: "not probed",
};

function DomainCell({ route }: { route: ProxyRoute }) {
  const domains = route.domains.length > 0 ? route.domains : ["—"];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-mono text-sm text-ink truncate" title={domains.join(", ")}>
          {domains[0]}
        </span>
        {domains.length > 1 && (
          <span className="font-mono text-[0.65rem] text-ink-faint">+{domains.length - 1}</span>
        )}
        {route.kind === "redirection" && <Badge variant="neutral">redirect</Badge>}
      </div>
      {!route.enabled && <span className="microlabel !text-ink-faint">disabled</span>}
    </div>
  );
}

function RouteRow({ route }: { route: ProxyRoute }) {
  return (
    <tr
      className={cn(
        "border-b border-line/50 last:border-0 hover:bg-panel-2/60",
        !route.enabled && "opacity-50",
      )}
    >
      <td className="px-3 py-2.5 w-px">
        <HealthDot health={route.health} />
      </td>
      <td className="px-3 py-2.5 min-w-0">
        <DomainCell route={route} />
      </td>
      <td className="px-3 py-2.5 min-w-0">
        <span className="font-mono text-xs text-ink-dim truncate block" title={route.target}>
          {route.target}
        </span>
      </td>
      <td className="px-3 py-2.5 w-px whitespace-nowrap">
        <CertBadge cert={route.cert} />
      </td>
    </tr>
  );
}

function RouteCard({ route }: { route: ProxyRoute }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-3 border-b border-line/50 last:border-0",
        !route.enabled && "opacity-50",
      )}
    >
      <div className="pt-1">
        <HealthDot health={route.health} />
      </div>
      <div className="min-w-0 flex-1">
        <DomainCell route={route} />
        <div className="font-mono text-[0.65rem] text-ink-faint truncate mt-0.5">{route.target}</div>
      </div>
      <div className="shrink-0">
        <CertBadge cert={route.cert} />
      </div>
    </div>
  );
}

export function RouteTable({ routes }: { routes: ProxyRoute[] }) {
  return (
    <div>
      <table className="w-full text-sm hidden md:table">
        <thead>
          <tr className="border-b border-line">
            {/* Health-dot column has no name to give a screen reader — its
                state is already read from each row's dot title/aria-hidden
                pairing, so scope="col" alone would associate cells with an
                empty header and add noise, not information. */}
            <th className="w-px" />
            <th scope="col" className="px-3 py-2 text-left microlabel font-normal">domain</th>
            <th scope="col" className="px-3 py-2 text-left microlabel font-normal">forward target</th>
            <th scope="col" className="px-3 py-2 text-left microlabel font-normal">ssl</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <RouteRow key={`${r.kind}-${r.id}`} route={r} />
          ))}
        </tbody>
      </table>

      <div className="md:hidden">
        {routes.map((r) => (
          <RouteCard key={`${r.kind}-${r.id}`} route={r} />
        ))}
      </div>

      {/* Legend for the hatched "unknown" dot — the one health state without an
          obvious meaning at a glance. */}
      <div className="px-3 py-2 border-t border-line/60 flex items-center gap-1.5">
        <HealthDot health="unknown" />
        <span className="text-[0.65rem] text-ink-faint">{HEALTH_LABEL.unknown} — disabled route, or a redirect to an external target</span>
      </div>
    </div>
  );
}
