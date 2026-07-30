"use client";

import { useState } from "react";
import type { ListeningSocket, SocketOwner, SocketScope } from "@/lib/network-types";

/**
 * What is listening on this box, and who owns it. The interesting question is not
 * "how many ports" but "how many are reachable from the LAN" — so scope drives the
 * whole layout: exposed ports lead, host-only ports are collapsed behind a toggle.
 * Sorting by port number and letting the reader spot the 0.0.0.0 would bury the
 * one thing worth checking.
 */

const SCOPE_ORDER: SocketScope[] = ["all-interfaces", "specific", "loopback"];

const SCOPE_HEADING: Record<SocketScope, string> = {
  "all-interfaces": "Reachable from the network",
  specific: "Bound to one address",
  loopback: "Host only",
};

const SCOPE_NOTE: Record<SocketScope, string> = {
  "all-interfaces": "listening on every interface — anything that can route here can reach these",
  specific: "listening on a single address, usually a docker bridge gateway",
  loopback: "listening on 127.0.0.1 — unreachable from outside this machine",
};

function ownerName(owner: SocketOwner | null): string {
  if (!owner) return "unattributed";
  return owner.kind === "container" ? owner.container : (owner.user ?? `uid ${owner.uid}`);
}

function OwnerCell({ owner }: { owner: SocketOwner | null }) {
  if (!owner) {
    // Never guessed from a well-known-ports table: the host's socket tables give a
    // uid and an inode, and mapping inode → process needs /proc/<pid>/fd, which the
    // dashboard cannot read. "Unattributed" is the true answer.
    return <span className="text-xs text-ink-faint italic">unattributed</span>;
  }
  if (owner.kind === "container") {
    return (
      <span className="inline-flex items-baseline gap-1.5 min-w-0">
        <span className="font-mono text-xs text-accent truncate">{owner.container}</span>
        <span className="font-mono text-[0.65rem] text-ink-faint whitespace-nowrap">
          →&nbsp;{owner.containerPort}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-xs text-ink-dim">{owner.user ?? "unknown user"}</span>
      <span className="font-mono text-[0.65rem] text-ink-faint">uid&nbsp;{owner.uid}</span>
    </span>
  );
}

function PortRow({ s }: { s: ListeningSocket }) {
  return (
    <tr className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
      <td className="px-3 py-2 font-mono text-sm tabular-nums w-px whitespace-nowrap">{s.port}</td>
      <td className="px-3 py-2 w-px">
        <span className="microlabel !text-ink-dim">{s.protocol}</span>
        {s.families.length === 2 && <span className="microlabel ml-1.5">v4+v6</span>}
        {s.families.length === 1 && <span className="microlabel ml-1.5">{s.families[0]}</span>}
      </td>
      {/* Fixed narrow column with its own truncation: a socket bound to three
          addresses (a v4, a ::, and a global v6) produces a string long enough to
          push the owner off the row, and the owner is the column that answers the
          question. Full list stays available on hover. */}
      <td className="px-3 py-2 w-[11rem] max-w-[11rem]">
        <span
          className="font-mono text-xs text-ink-faint truncate block"
          title={s.addresses.join("  ")}
        >
          {s.addresses.join("  ")}
        </span>
      </td>
      <td className="px-3 py-2 min-w-0">
        <OwnerCell owner={s.owner} />
      </td>
    </tr>
  );
}

function PortCard({ s }: { s: ListeningSocket }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line/50 last:border-0">
      <div className="font-mono text-sm tabular-nums w-14 shrink-0">{s.port}</div>
      <div className="min-w-0 flex-1">
        <OwnerCell owner={s.owner} />
        <div className="font-mono text-[0.65rem] text-ink-faint truncate mt-0.5">
          {s.protocol} · {s.addresses.join("  ")}
        </div>
      </div>
    </div>
  );
}

function ScopeGroup({ scope, sockets }: { scope: SocketScope; sockets: ListeningSocket[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="px-3 pt-3 pb-2 border-b border-line">
        <h3 className="text-sm font-semibold tracking-tight">
          {SCOPE_HEADING[scope]}
          <span className="ml-2 font-mono text-xs text-ink-faint tabular-nums">{sockets.length}</span>
        </h3>
        <p className="text-[0.7rem] text-ink-faint mt-0.5">{SCOPE_NOTE[scope]}</p>
      </div>

      <table className="w-full text-sm hidden md:table">
        <tbody>
          {sockets.map((s) => (
            <PortRow key={`${s.protocol}-${s.port}`} s={s} />
          ))}
        </tbody>
      </table>

      <div className="md:hidden">
        {sockets.map((s) => (
          <PortCard key={`${s.protocol}-${s.port}`} s={s} />
        ))}
      </div>
    </section>
  );
}

export function ListeningPorts({
  sockets,
  unavailable,
}: {
  sockets: ListeningSocket[];
  /** True when the collector could not read the host's socket tables — an empty
   *  list then means "we could not look", which must not render as "nothing is
   *  listening". Something is always listening on a box running 26 containers. */
  unavailable?: boolean;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  const [query, setQuery] = useState("");

  if (unavailable) {
    return (
      <div className="panel p-4 text-sm text-ink-dim">
        Listening ports unavailable — the host&apos;s socket tables could not be read.
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const matched = needle
    ? sockets.filter(
        (s) =>
          String(s.port).includes(needle) ||
          ownerName(s.owner).toLowerCase().includes(needle) ||
          s.protocol.includes(needle),
      )
    : sockets;

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    sockets: matched.filter((s) => s.scope === scope),
  })).filter((g) => g.sockets.length > 0);

  const quiet = groups.filter((g) => g.scope === "loopback");
  const loud = groups.filter((g) => g.scope !== "loopback");
  const quietCount = quiet.reduce((a, g) => a + g.sockets.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Listening ports</h2>
          <p className="text-[0.7rem] text-ink-faint mt-0.5">
            {sockets.length} sockets bound on the host · ports published by docker name their
            container
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="port or owner"
          aria-label="Filter listening ports"
          className="h-9 w-full sm:w-48 rounded-md bg-panel-2 border border-line px-2.5 font-mono text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent/50"
        />
      </div>

      {matched.length === 0 && (
        <div className="panel p-4 text-sm text-ink-dim">
          No listening port matches <span className="font-mono text-ink">{query}</span>.
        </div>
      )}

      {loud.map((g) => (
        <ScopeGroup key={g.scope} scope={g.scope} sockets={g.sockets} />
      ))}

      {quietCount > 0 && !showQuiet && (
        <button
          type="button"
          onClick={() => setShowQuiet(true)}
          className="w-full panel panel-hover h-11 text-xs text-ink-dim hover:text-ink cursor-pointer"
        >
          Show {quietCount} host-only {quietCount === 1 ? "port" : "ports"}
        </button>
      )}
      {showQuiet &&
        quiet.map((g) => <ScopeGroup key={g.scope} scope={g.scope} sockets={g.sockets} />)}
    </div>
  );
}
