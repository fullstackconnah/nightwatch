/* THESIS: the top band answers "is Hermes alive, what is it running, and is
   it actually wired to Discord" in one glance — the same subject-first
   ordering /smarthome and /proxy use. Loop dots follow DESIGN.md's Threshold
   Rule literally: a loop that has never run is "stopped" (unlit, no verdict
   yet), not "error" — only lastOk===false earns the red dot. OWN-WORLD:
   nightwatch console — hairline .panel, mono figures, microlabels, dot
   vocabulary; state colour only where the daemon reports a real threshold. */

import { relativeTime } from "@/lib/format";
import type { HermesStatusOk } from "@/lib/hermes-types";
import { cn } from "@/lib/utils";

function loopDotClass(lastOk: boolean | null): string {
  if (lastOk === true) return "dot-running";
  if (lastOk === false) return "dot-dead";
  return "dot-stopped";
}

function loopVerdictLabel(lastOk: boolean | null): string {
  if (lastOk === true) return "ok";
  if (lastOk === false) return "error";
  return "never run";
}

/** Future-facing sibling of relativeTime() — nextRunAt is the one field on
 *  this whole page that points forward instead of back, so relativeTime's
 *  "diff = now - then" (which reads a future timestamp as "just now") would
 *  be wrong here rather than merely imprecise. Kept local: the only caller
 *  on the whole surface. */
function relativeFuture(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 30_000) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function WiringDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("dot", on ? "dot-running" : "dot-stopped")} aria-hidden />
      <span className="microlabel">{label}</span>
    </span>
  );
}

function LoopFigure({
  label,
  lastRunAt,
  lastOk,
  lastError,
  trailing,
}: {
  label: string;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  /** Digest-only: its next scheduled run, printed after the last-run figure. */
  trailing?: { label: string; value: string };
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1.5">
        <span className={cn("dot", loopDotClass(lastOk))} aria-hidden title={loopVerdictLabel(lastOk)} />
        <span className="microlabel truncate">{label}</span>
      </div>
      <div className="font-mono text-xs text-ink">{lastRunAt ? relativeTime(lastRunAt) : "never run"}</div>
      {lastOk === false && lastError && (
        <div className="text-[0.65rem] text-bad/90 break-words" title={lastError}>
          {lastError}
        </div>
      )}
      {trailing && (
        <div className="pt-0.5">
          <div className="microlabel">{trailing.label}</div>
          <div className="font-mono text-xs text-ink">{trailing.value}</div>
        </div>
      )}
    </div>
  );
}

export function HermesStatusBand({ status }: { status: HermesStatusOk }) {
  const { tier, dryRun, loops, discord, counts, startedAt } = status;

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="dot dot-running" aria-hidden />
            <span className="font-mono text-sm text-ink truncate">{tier.model}</span>
            {dryRun && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-mono font-medium border border-warn/30 text-warn bg-warn/5">
                dry run
              </span>
            )}
          </div>
          <div className="microlabel">
            {tier.tier} · via {tier.source}
            {startedAt && <> · up {relativeTime(startedAt)}</>}
          </div>
          {dryRun && (
            <p className="text-[0.7rem] text-warn/80 max-w-prose">
              Dry run is on — reports print to logs, not Discord.
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <WiringDot on={discord.webhookConfigured} label="webhook" />
          <WiringDot on={discord.commandsEnabled} label="commands" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-3 pt-3 border-t border-line/60">
        <LoopFigure label="collect" lastRunAt={loops.collect.lastRunAt} lastOk={loops.collect.lastOk} lastError={loops.collect.lastError} />
        <LoopFigure
          label="digest"
          lastRunAt={loops.digest.lastRunAt}
          lastOk={loops.digest.lastOk}
          lastError={loops.digest.lastError}
          trailing={{ label: "next digest", value: relativeFuture(loops.digest.nextRunAt) }}
        />
        <div className="min-w-0 space-y-1">
          <div className="microlabel">alert</div>
          <div className="font-mono text-xs text-ink">
            {loops.alert.lastTriggeredAt ? relativeTime(loops.alert.lastTriggeredAt) : "never triggered"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="microlabel">snapshots · 24h</div>
          <div className="font-mono text-sm text-ink mt-0.5">{counts.snapshots24h.toLocaleString()}</div>
        </div>
        <div className="min-w-0">
          <div className="microlabel">alerts · 24h</div>
          <div className="font-mono text-sm text-ink mt-0.5">{counts.alerts24h.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
