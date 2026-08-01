"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CertificatesPanel } from "@/components/proxy-certificates";
import { RouteTable } from "@/components/proxy-routes";
import { ProxyError, ProxyLoading, ProxyUnconfigured } from "@/components/proxy-status";
import { useProxyManager } from "@/lib/use-npm";
import { cn } from "@/lib/utils";

/**
 * /proxy — the Nginx Proxy Manager route map: which domain forwards to which
 * upstream, whether that upstream answered its last health probe, and how long
 * until the certificate covering it expires. Read-only by design (per the
 * expansion spec's §5) — NPM's own admin UI does the editing; this page's job is
 * the glance-first "is anything about to expire or fall over" answer.
 */
export default function ProxyPage() {
  const { data: snapshot, error, isLoading } = useProxyManager();

  const dotClass =
    !snapshot || isLoading
      ? "dot-restarting"
      : snapshot.status === "ok"
        ? "dot-running"
        : snapshot.status === "unconfigured"
          ? "dot-stopped"
          : "dot-dead";

  const statusLabel = !snapshot
    ? "connecting"
    : snapshot.status === "ok"
      ? `${snapshot.routes.length} ${snapshot.routes.length === 1 ? "route" : "routes"}`
      : snapshot.status;

  return (
    <div className="space-y-5 pb-2">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Proxy</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            Nginx Proxy Manager — domain → forward target, upstream health, certificate expiry
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className={cn("dot", dotClass)} aria-hidden />
            <span className="microlabel">{statusLabel}</span>
          </span>
          {snapshot?.npmUrl && (
            <a href={snapshot.npmUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <ExternalLink size={13} /> Open NPM admin
              </Button>
            </a>
          )}
        </div>
      </header>

      {error && (
        <ProxyError status="unreachable" detail={error.message ?? "Could not reach /api/proxy-manager."} />
      )}

      {!error && !snapshot && <ProxyLoading />}

      {!error && snapshot?.status === "unconfigured" && <ProxyUnconfigured />}

      {!error && snapshot && (snapshot.status === "unreachable" || snapshot.status === "unauthorized") && (
        <ProxyError status={snapshot.status} detail={snapshot.detail} />
      )}

      {!error && snapshot?.status === "ok" && (
        <>
          <RouteTable routes={snapshot.routes} />
          <CertificatesPanel certificates={snapshot.certificates} />
        </>
      )}
    </div>
  );
}
