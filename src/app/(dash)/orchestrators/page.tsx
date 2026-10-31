"use client";

/* THESIS: one glance answers "are my orchestrators alive, is anything stuck, and on what".
   Service band first (is the PC answering), then one card per orchestrator in registry order;
   a stalled agent is the only thing that earns warn colour. OWN-WORLD: nightwatch console,
   same skeleton as /hermes: hairline .panel, mono figures, microlabels, no new tokens. */

import { ApiError } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import { pageKind } from "@/lib/orchestra-view";
import { useOrchestraStatus } from "@/lib/use-orchestra";
import { OrchestraBand } from "@/components/integrations/orchestra-band";
import { OrchestraCard } from "@/components/integrations/orchestra-card";
import { OrchestraLoadError, OrchestraSkeleton, OrchestraUnconfigured } from "@/components/integrations/orchestra-status";

export default function OrchestratorsPage() {
  const { data, lastOk, error, isLoading } = useOrchestraStatus();
  const kind = pageKind({ isLoading, hasData: Boolean(data), hasError: Boolean(error), status: data?.status });
  // Unreachable with a snapshot from earlier in this tab: show it, marked stale.
  const stale = data?.status === "unreachable" && lastOk !== null;
  const cards = data?.status === "ok" ? data.orchestrators : stale ? (lastOk?.orchestrators ?? []) : [];

  return (
    <div className="space-y-5 pb-2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Orchestra</h1>
          <p className="mt-0.5 text-xs text-ink-dim">Claude Code orchestrators on the PC: state, agents in flight</p>
        </div>
        {data?.status === "ok" && (
          <div className="flex items-center gap-2">
            <span className="dot dot-running" aria-hidden />
            <span className="microlabel">connected</span>
          </div>
        )}
      </header>

      {kind === "loading" && <OrchestraSkeleton />}
      {kind === "load-error" && <OrchestraLoadError status={error instanceof ApiError ? error.status : undefined} />}
      {kind === "unconfigured" && <OrchestraUnconfigured />}

      {kind === "band" && data && (
        <>
          <OrchestraBand snap={data} lastAge={stale ? relativeTime(lastOk?.fetchedAt ?? "") : undefined} />
          {/* board strip: PR after the proxy exposes snapshot.board */}
          {data.status === "ok" && cards.length === 0 && (
            <div className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-dim">
              Add an entry to orchestrators.json on the PC. The service reloads the file when it changes.
            </div>
          )}
          {cards.length > 0 && (
            <section className="space-y-3">
              <h2 className="microlabel">Orchestrators</h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {cards.map((o) => (
                  <OrchestraCard key={o.name} o={o} stale={stale} />
                ))}
              </div>
            </section>
          )}
          {/* bus feed: sibling section after the grid, later PR */}
        </>
      )}
    </div>
  );
}
