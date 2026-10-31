"use client";

/* One orchestrator: state, four figures, home, and a Details disclosure whose body is fetched
   only while open. Stale mode (service unreachable, showing the last snapshot) drops the
   disclosure: no live detail exists to show. */

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import { cardBadge, checkpointView, formatQuiet, inFlightRows } from "@/lib/orchestra-view";
import { useOrchestraDetail } from "@/lib/use-orchestra";
import type { OrchestraDetailResponse, OrchestratorSummary } from "@/lib/types/orchestra";
import { SkeletonBar } from "@/components/integrations/orchestra-status";

const WATCHER_TONE: Record<string, string> = { online: "text-ok", busy: "text-blue", offline: "text-ink-dim" };

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="microlabel">{label}</div>
      <div className="font-mono text-xs text-ink [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="microlabel">{label}</div>
      {items.length === 0 ? (
        <div className="font-mono text-[0.65rem] text-ink-dim">none</div>
      ) : (
        items.map((i) => (
          <div key={i} className="font-mono text-[0.65rem] text-ink-dim [overflow-wrap:anywhere]">
            {i}
          </div>
        ))
      )}
    </div>
  );
}

function DetailBody({ data, error, loading, onRetry }: {
  data: OrchestraDetailResponse | undefined;
  error: unknown;
  loading: boolean;
  onRetry: () => void;
}) {
  const detail = data?.status === "ok" ? data.orchestrator : null;
  if (detail) {
    const cp = checkpointView(detail.checkpoint);
    const rows = inFlightRows(detail.inFlight);
    return (
      <>
        <div className="space-y-1">
          <div className="microlabel">checkpoint</div>
          <p data-checkpoint="" className={`whitespace-pre-line text-xs [overflow-wrap:anywhere] ${cp.empty ? "text-ink-dim" : "text-ink"}`}>{cp.text}</p>
          {cp.cut && <p className="text-[0.65rem] text-ink-faint">The service keeps the first 300 characters.</p>}
        </div>
        <div className="space-y-1">
          <div className="microlabel">in flight</div>
          {rows.length === 0 ? (
            <p className="text-xs text-ink-dim">Idle: nothing in flight.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.name} className="flex min-h-8 items-center justify-between gap-2">
                  <span className="min-w-0 font-mono text-xs text-ink [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {r.stalled && <Badge variant="warn">stalled</Badge>}
                    <span className={`font-mono text-xs ${r.stalled ? "text-warn" : "text-ink-dim"}`}>{formatQuiet(r.quietMin)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {detail.sessionId && (
          <div className="space-y-1">
            <div className="microlabel">session</div>
            <div title={detail.sessionId} className="block truncate font-mono text-[0.7rem] text-ink-dim">{detail.sessionId}</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <List label="extra dirs" items={detail.addDirs} />
          <List label="plugins" items={detail.plugins} />
        </div>
      </>
    );
  }
  if (loading && !error && !data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <SkeletonBar delayMs={0} className="w-2/3" />
        <SkeletonBar delayMs={60} className="w-full" />
      </div>
    );
  }
  const gone = (error instanceof ApiError && error.status === 404) || (data?.status === "ok" && !data.orchestrator);
  const why = gone
    ? "This orchestrator is no longer in the registry."
    : data && data.status !== "ok"
      ? data.detail
      : error instanceof Error
        ? error.message
        : "";
  return (
    <div className="space-y-2">
      <p className="text-xs text-bad">Could not load details.</p>
      {why && <p className="text-[0.7rem] text-ink-dim">{why}</p>}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function OrchestraCard({ o, stale }: { o: OrchestratorSummary; stale: boolean }) {
  const uid = useId();
  const badge = cardBadge(o.state, stale);
  // A stalled card starts open so the anomaly shows which agents without a tap; the owner's own choice then holds.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = !stale && (chosen ?? o.state === "stalled");
  const { data, error, isLoading, mutate } = useOrchestraDetail(o.name, open);
  const detailId = `${uid}-detail`;

  return (
    <article aria-labelledby={`${uid}-name`} className="panel min-w-0 space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${uid}-name`} className="flex items-center gap-2 font-mono text-sm text-ink">
            <span className={`dot ${badge.dot}`} aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{o.name}</span>
          </h3>
          {o.title && (
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-dim [overflow-wrap:anywhere]" title={o.title}>
              {o.title}
            </p>
          )}
        </div>
        <Badge variant={badge.variant} data-state-badge="" className="shrink-0">
          {badge.text}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-line/60 pt-3">
        <Figure label="last activity">{o.lastActivityAt ? relativeTime(o.lastActivityAt) : "none yet"}</Figure>
        <Figure label="in flight">
          {o.inFlightCount === 0
            ? "idle"
            : `${o.inFlightCount} agent${o.inFlightCount === 1 ? "" : "s"}${stale ? " at last check" : ""}`}
          {o.stalledCount > 0 && <span className="text-warn"> · {o.stalledCount} stalled</span>}
        </Figure>
        <Figure label="model">{o.model ?? "—"}</Figure>
        <Figure label="watcher">
          {o.watcher && !stale ? <span className={WATCHER_TONE[o.watcher] ?? "text-ink-dim"}>{o.watcher}</span> : "—"}
        </Figure>
      </div>

      {o.home && (
        <div className="space-y-1">
          <div className="microlabel">home</div>
          <div className="font-mono text-[0.7rem] text-ink-dim [overflow-wrap:anywhere]">{o.home}</div>
        </div>
      )}

      {/* Left side is the slot for Start/Stop/Restart in the control PR. */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div />
        {!stale && (
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={detailId} onClick={() => setChosen(!open)}>
            {open ? "Hide details" : "Details"}
            <ChevronDown size={14} className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </Button>
        )}
      </div>

      {open && (
        <div id={detailId} className="space-y-3 border-t border-line/60 pt-3">
          <DetailBody data={data} error={error} loading={isLoading} onRetry={() => void mutate()} />
          {data && <div className="microlabel">details checked {relativeTime(data.fetchedAt)}</div>}
        </div>
      )}
    </article>
  );
}
