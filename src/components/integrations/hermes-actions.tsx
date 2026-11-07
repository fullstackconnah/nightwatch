/* THESIS: the Runs strip's two writes over the page's one Hermes job slot (the daemon runs one job at a time, so the
   page owns the slot and passes `run` down). Run digest sits in the strip head; Send test alert is the one that
   exercises a real external channel, so it asks once on the strips' WriteAction and its Yes is the primary button.
   The result and failed-run panels are filtered by job kind (jobFor). OWN-WORLD: nightwatch console. */
"use client";

import { AlertTriangle, PlayCircle } from "lucide-react";
import { WriteAction } from "@/components/strips/write-action";
import { jobFor } from "@/lib/hermes/page-model";
import { failedRunText } from "@/lib/resource-ui-view";
import type { UseHermesRunResult } from "@/lib/use-hermes";

const TAP = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";
/** The page renders this id once, as the reason a disabled write is off. */
export const WHY_ID = "hermes-why";

const starter = (run: UseHermesRunResult, kind: "digest" | "alert-test") => async () => {
  const failure = await run.start(kind);
  if (failure) throw new Error(failure);
};

export function RunDigest({ run, enabled }: { run: UseHermesRunResult; enabled: boolean }) {
  return (
    <WriteAction
      label="Run digest"
      icon={<PlayCircle size={13} />}
      confirm={false}
      flight="Starting…"
      failure="Couldn’t start the digest"
      disabled={!enabled}
      describedBy={WHY_ID}
      triggerClassName={TAP}
      run={starter(run, "digest")}
    />
  );
}

export function RunsDetail({ run, enabled, reason }: { run: UseHermesRunResult; enabled: boolean; reason: string | null }) {
  const { job, problem } = jobFor("runs", run);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WriteAction
          label="Send test alert"
          icon={<AlertTriangle size={13} />}
          say="Sends a real test alert down the Discord webhook."
          yes="Yes, send"
          flight="Sending…"
          failure="Couldn’t send the test alert"
          disabled={!enabled}
          describedBy={WHY_ID}
          triggerClassName={TAP}
          run={starter(run, "alert-test")}
        />
      </div>
      <p className="st-note">Runs started here show their result here; they don’t post to Discord.</p>
      {!enabled && reason && <p className="st-note">{reason}</p>}

      {problem && <div role="alert" className="microlabel !text-bad">{problem}</div>}

      {job?.state === "error" && (
        <div role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2.5">
          <div className="microlabel !text-bad mb-1">run failed</div>
          <p className="font-mono text-xs text-bad/90 whitespace-pre-wrap break-words">
            {failedRunText(job.error)}
          </p>
        </div>
      )}

      {/* role="status" on the result panel itself: it renders once per run and then sits static (polling stops once the
          job settles), so the panel's appearance is the one announcement. */}
      {job?.state === "done" && job.result && (
        <div role="status" aria-live="polite" className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5 space-y-1">
          <div className="text-xs font-medium text-ink">{job.result.title || "(no title)"}</div>
          <div className="text-ink-dim whitespace-pre-wrap break-words">{job.result.body || "(empty)"}</div>
        </div>
      )}
    </div>
  );
}
