/* THESIS: two ghost-button triggers over one shared job slot — the daemon
   itself only runs one job at a time (POST /run 409s otherwise), so a
   digest and a test alert sharing one progress/result area is honest about
   that, not a simplification. Test alert gets the app's one inline two-step
   confirm idiom (image-delete-action.tsx / reclaim-shared.tsx) because it's
   the one button on this page that exercises a real, external side channel.
   OWN-WORLD: nightwatch console — ghost buttons, .logbox-style result panel,
   mono elapsed timer, honest 409 copy passed straight through. */
"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHermesRun } from "@/lib/use-hermes";
import { useNow } from "@/lib/use-now";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const now = useNow(true);
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(startMs) || now === 0) return null;
  return <span className="font-mono tabular-nums text-ink-dim text-xs">{formatElapsed(now - startMs)}</span>;
}

type ConfirmStep = "idle" | "confirm";

export function HermesActionsRow() {
  const run = useHermesRun();
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>("idle");

  const job = run.job;
  const running = run.starting || (job?.ok && job.job.state === "running");
  const busy = running || confirmStep === "confirm";

  async function startDigest() {
    setConfirmStep("idle");
    await run.start("digest");
  }

  async function startAlertTest() {
    setConfirmStep("idle");
    await run.start("alert-test");
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="microlabel">actions</span>
        {job?.ok && job.job.state === "running" && (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none text-ink-faint" aria-hidden />
            <ElapsedTimer startedAt={job.job.startedAt} />
          </span>
        )}
      </div>

      <p className="text-[0.7rem] text-ink-dim">
        API-triggered runs show their result here — they don&apos;t post to Discord.
      </p>

      {confirmStep === "confirm" ? (
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle size={13} className="text-warn shrink-0" aria-hidden />
          <span className="text-[0.7rem] text-ink-dim">
            This sends a real test alert down the configured Discord webhook. Send it now?
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmStep("idle")}>
              Cancel
            </Button>
            <Button size="sm" variant="warn" onClick={() => void startAlertTest()}>
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void startDigest()}>
            <PlayCircle size={13} /> Run digest now
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmStep("confirm")}>
            <AlertTriangle size={13} /> Send test alert
          </Button>
        </div>
      )}

      {run.startError && (
        <div role="alert" className="microlabel !text-warn/80">{run.startError}</div>
      )}

      {job?.ok && job.job.state === "error" && (
        <div role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2.5">
          <div className="microlabel !text-bad mb-1">run failed</div>
          <p className="font-mono text-xs text-bad/90 whitespace-pre-wrap break-words">
            {job.job.error ?? "Hermes reported an error with no further detail."}
          </p>
        </div>
      )}

      {/* role="status" directly on the result panel, not a separate sr-only
          mirror: unlike log-track's scrollback this content renders once per
          run and then sits static (polling stops once the job settles), so
          there is no risk of re-announcing on every tick — the panel's own
          appearance IS the one meaningful event. */}
      {job?.ok && job.job.state === "done" && job.job.result && (
        <div role="status" aria-live="polite" className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5 space-y-1">
          <div className="text-xs font-medium text-ink">{job.job.result.title || "(no title)"}</div>
          <div className="text-ink-dim whitespace-pre-wrap break-words">{job.job.result.body || "(empty)"}</div>
        </div>
      )}

      {job && !job.ok && <div role="alert" className="microlabel !text-bad">{job.detail}</div>}
    </div>
  );
}
