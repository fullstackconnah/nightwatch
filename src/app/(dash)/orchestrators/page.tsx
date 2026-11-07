"use client";

/* THESIS: one glance answers "are my AI lanes alive, is anything stuck, and on what".
   One sentence and a tally first, the service band only when it has something to say, then one strip per
   lane in the service's order; only a real stall or a waiting tool call earns warn colour, under a mark.
   OWN-WORLD: nightwatch console, same skeleton as /hermes: hairline .panel, mono figures, microlabels,
   no new tokens. The route stays /orchestrators; Home owns "what needs me across everything". */

import { ApiError } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import { laneSentence, laneTally, pageFreshness, pageKind, tallySegments } from "@/lib/orchestra-view";
import { useOrchestraStatus } from "@/lib/use-orchestra";
import { LaneStrip } from "@/components/integrations/lane-strip";
import { OrchestraBand } from "@/components/integrations/orchestra-band";
import { OrchestraLoadError, OrchestraSkeleton, OrchestraUnconfigured } from "@/components/integrations/orchestra-status";

export default function OrchestratorsPage() {
  const { data, lastOk, error, isLoading } = useOrchestraStatus();
  const kind = pageKind({ isLoading, hasData: Boolean(data), hasError: Boolean(error), status: data?.status });
  // Unreachable, or a failed poll, with a snapshot from earlier in this tab: show it, marked stale.
  const { stale, connected } = pageFreshness({ status: data?.status, hasError: Boolean(error), hasLastOk: lastOk !== null });
  const lanes = data?.status === "ok" ? data.orchestrators : stale ? (lastOk?.orchestrators ?? []) : [];
  const sentence = kind === "band" && data?.status === "ok" ? laneSentence(lanes, { stale }) : null;
  const segments = connected ? tallySegments(laneTally(lanes)) : [];

  return (
    <div className="ol-page pb-2">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">AI lanes</h1>
        {connected && (
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
          {sentence && (
            <p className="or-sentence" aria-live="polite">
              {sentence}
            </p>
          )}
          <div className="mb-4 empty:hidden">
            <OrchestraBand snap={data} lastAge={stale ? relativeTime(lastOk?.fetchedAt ?? "") : undefined} />
          </div>
          {segments.length > 0 && (
            <p className="ol-tally">
              {segments.map((s) => (
                <span key={s.label}>
                  <b>{s.n}</b> {s.label}
                </span>
              ))}
            </p>
          )}
          {data.status === "ok" && lanes.length === 0 && (
            <div className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-dim">
              Add an entry to orchestrators.json on the PC. The service reloads the file when it changes.
            </div>
          )}
          {lanes.length > 0 && (
            <ul className="ol-board">
              {lanes.map((o) => (
                <LaneStrip key={o.name} o={o} stale={stale} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
