"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  ESTABLISHED_WARN_THRESHOLD,
  type ConnectionLocalEndpoint,
  type EstablishedConnectionGroup,
  type SocketOwner,
} from "@/lib/network-types";
import { cn } from "@/lib/utils";

/**
 * What is this box talking to *right now* — the live traffic the container
 * footprint above only counts in aggregate. Grouped by remote address, same
 * "who, not how many ports" question the footprint asks of containers. Two
 * signals are worth a mark here and nothing else is (Threshold Rule): a
 * remote outside every private/local range, and a remote holding more
 * concurrent connections than a home LAN normally produces. No geolocation,
 * no reputation, no "problematic" verdicts — every mark traces to a real
 * computed fact about the address or the count.
 */

function ownerLabel(owner: SocketOwner | null): string {
  if (!owner) return "unattributed";
  return owner.kind === "container" ? owner.container : (owner.user ?? `uid ${owner.uid}`);
}

/** A local port this remote touched, with its attribution — condensed to fit
 *  several per row, same three-way owner vocabulary as ListeningPorts'
 *  OwnerCell (container in accent, host user in ink-dim, unattributed in
 *  italic ink-faint) so a reader doesn't learn a second colour language for
 *  the same fact. */
function LocalPortChip({ endpoint }: { endpoint: ConnectionLocalEndpoint }) {
  const { port, owner } = endpoint;
  if (!owner) {
    return (
      <span className="inline-flex items-baseline gap-1 rounded border border-line px-1.5 py-0.5">
        <span className="font-mono text-[0.65rem] tabular-nums text-ink-dim">{port}</span>
        <span className="text-[0.65rem] text-ink-faint italic">unattributed</span>
      </span>
    );
  }
  if (owner.kind === "container") {
    return (
      <span
        className="inline-flex items-baseline gap-1 rounded border border-line px-1.5 py-0.5"
        title={`local port ${port} → ${owner.container}:${owner.containerPort}`}
      >
        <span className="font-mono text-[0.65rem] tabular-nums text-ink-dim">{port}</span>
        <span className="font-mono text-[0.65rem] text-accent">{owner.container}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded border border-line px-1.5 py-0.5"
      title={`local port ${port} · uid ${owner.uid}`}
    >
      <span className="font-mono text-[0.65rem] tabular-nums text-ink-dim">{port}</span>
      <span className="font-mono text-[0.65rem] text-ink-dim">{owner.user ?? `uid ${owner.uid}`}</span>
    </span>
  );
}

/**
 * The "public" mark: detail-size mono inside a 1px inset line-bright ring —
 * the same device DESIGN.md's stderr channel marker uses, deliberately not a
 * coloured badge. A hairline reads as "different channel"; a coloured fill
 * would read as an alarm this fact does not support.
 */
function PublicMark() {
  return (
    <span
      className="font-mono text-[0.65rem] text-ink-dim px-1.5 py-0.5 rounded"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-line-bright)" }}
      title="Outside RFC1918/RFC4193, link-local and loopback — a real fact about this address, not a threat verdict"
    >
      public
    </span>
  );
}

function CountReadout({ count }: { count: number }) {
  const hot = count > ESTABLISHED_WARN_THRESHOLD;
  return (
    <span
      className={cn("font-mono text-sm tabular-nums", hot ? "text-warn" : "text-ink")}
      title={
        hot
          ? `${count} concurrent connections from this remote — more than ${ESTABLISHED_WARN_THRESHOLD}, which is unusual for this host`
          : undefined
      }
    >
      {count}
    </span>
  );
}

function ConnectionRow({ g }: { g: EstablishedConnectionGroup }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 border-b border-line/50 last:border-0">
      <div className="flex items-center gap-2 min-w-0 basis-full sm:basis-auto sm:flex-1">
        <span className="font-mono text-sm truncate" title={g.remoteAddress}>
          {g.remoteAddress}
        </span>
        {g.isPublic && <PublicMark />}
        <span className="microlabel shrink-0">{g.family}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {g.localPorts.map((ep) => (
          <LocalPortChip key={ep.port} endpoint={ep} />
        ))}
      </div>
      <div className="ml-auto flex items-baseline gap-1.5 shrink-0">
        <CountReadout count={g.count} />
        <span className="text-[0.65rem] text-ink-faint">{g.count === 1 ? "conn" : "conns"}</span>
      </div>
    </div>
  );
}

function HatchedUnavailable({ reason }: { reason: string }) {
  return (
    <div
      className="panel p-4 flex items-center gap-3"
      style={{
        backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-line-bright) 5px 6px)",
        backgroundBlendMode: "overlay",
      }}
    >
      <div
        className="h-8 w-8 shrink-0 rounded border border-line"
        style={{
          backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, var(--color-line-bright) 4px 5px)",
        }}
        aria-hidden
      />
      <p className="text-sm text-ink-dim">{reason}</p>
    </div>
  );
}

export function NetConnections({
  connections,
  available,
}: {
  connections: EstablishedConnectionGroup[];
  /** False when neither host socket table could be read — must render as a
   *  named refusal, never as the (also legitimate) "nothing established"
   *  empty state. */
  available: boolean;
}) {
  const [showLoopback, setShowLoopback] = useState(false);

  if (!available) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Established connections</h2>
        <HatchedUnavailable reason="Established connections unavailable — the host's tcp connection tables could not be read." />
      </section>
    );
  }

  const remote = connections.filter((g) => !g.isLoopback);
  const loopback = connections.filter((g) => g.isLoopback);
  const totalConns = connections.reduce((a, g) => a + g.count, 0);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Established connections</h2>
          <p className="text-[0.7rem] text-ink-dim mt-0.5">
            live traffic the footprint above only counts in aggregate · busiest remote first
          </p>
        </div>
        {totalConns > 0 && (
          <span className="font-mono text-xs text-ink-dim tabular-nums">
            {totalConns} across {connections.length} {connections.length === 1 ? "remote" : "remotes"}
          </span>
        )}
      </div>

      {remote.length === 0 && loopback.length === 0 && (
        <div className="panel p-4 text-sm text-ink-dim">
          Nothing established right now — quiet is normal.
        </div>
      )}

      {remote.length > 0 && (
        <div className="panel overflow-hidden">
          {remote.map((g) => (
            <ConnectionRow key={`${g.family}-${g.remoteAddress}`} g={g} />
          ))}
        </div>
      )}

      {loopback.length > 0 && !showLoopback && (
        <button
          type="button"
          onClick={() => setShowLoopback(true)}
          className="w-full panel panel-hover h-11 text-xs text-ink-dim hover:text-ink cursor-pointer"
        >
          Show {loopback.length} loopback {loopback.length === 1 ? "peer" : "peers"}
          <span className="text-ink-faint"> — this box talking to itself</span>
        </button>
      )}
      {showLoopback && loopback.length > 0 && (
        <div className="panel overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLoopback(false)}
            aria-expanded={showLoopback}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-panel-2/60 cursor-pointer min-h-11 border-b border-line"
          >
            <ChevronDown size={14} className="text-ink-faint rotate-180 shrink-0" />
            <span className="text-xs text-ink-dim flex-1">
              {loopback.length} loopback {loopback.length === 1 ? "peer" : "peers"}
            </span>
          </button>
          {loopback.map((g) => (
            <ConnectionRow key={`${g.family}-${g.remoteAddress}`} g={g} />
          ))}
        </div>
      )}
    </section>
  );
}
