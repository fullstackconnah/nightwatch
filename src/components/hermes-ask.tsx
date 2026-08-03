/* THESIS: a textarea, a submit, and one answer band — the same job-slot shape
   hermes-actions.tsx uses, kept separate because "ask a question" and "run a
   scheduled job" are different mental modes even though they ride the same
   /run contract. The local-tier note only appears once we actually know the
   tier is local (from the status band's own poll), so it never claims a wait
   that OpenRouter/Anthropic wouldn't have. OWN-WORLD: nightwatch console —
   mono counter, .logbox-style answer band with preserved line breaks. */
"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HermesVoiceMic } from "@/components/hermes-voice-mic";
import { useHermesRun } from "@/lib/use-hermes";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 500;

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Exported so kiosk-voice.tsx's full voice panel can show the same "how
// long has this ask job been running" readout without a second copy of it.
export function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const now = useNow(true);
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(startMs) || now === 0) return null;
  return <span className="font-mono tabular-nums text-ink-dim text-xs">{formatElapsed(now - startMs)}</span>;
}

export function HermesAsk({ tier }: { tier: string | null }) {
  const [question, setQuestion] = useState("");
  const run = useHermesRun();

  const job = run.job;
  const running = run.starting || (job?.ok && job.job.state === "running");
  const trimmed = question.trim();
  const overLimit = question.length > MAX_LENGTH;

  async function submit() {
    if (!trimmed || overLimit || running) return;
    await run.start("ask", trimmed);
    setQuestion("");
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span id="hermes-ask-label" className="microlabel">ask hermes</span>
        {job?.ok && job.job.state === "running" && (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none text-ink-faint" aria-hidden />
            <ElapsedTimer startedAt={job.job.startedAt} />
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={Boolean(running)}
            placeholder="Ask about anything Hermes has seen — a container, a trend, tonight's digest…"
            // Programmatic name via the panel's own already-visible "ask
            // hermes" microlabel — placeholder text disappears once typed and
            // is not a reliable accessible-name source for AT. No new visible
            // text, so no layout change.
            aria-labelledby="hermes-ask-label"
            rows={3}
            maxLength={MAX_LENGTH + 40}
            className={cn(
              "flex-1 min-w-0 rounded-md border border-line bg-bg px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 font-mono resize-y disabled:opacity-60",
            )}
          />
          <HermesVoiceMic
            disabled={Boolean(running)}
            onTranscript={(text) => setQuestion((q) => (q ? `${q} ${text}` : text).slice(0, MAX_LENGTH))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("font-mono text-[0.65rem] tabular-nums", overLimit ? "text-bad" : "text-ink-faint")}>
            {question.length}/{MAX_LENGTH}
          </span>
          <Button size="sm" disabled={!trimmed || overLimit || Boolean(running)} onClick={() => void submit()}>
            <Send size={13} /> Ask
          </Button>
        </div>
      </div>

      {job?.ok && job.job.state === "running" && tier === "local" && (
        <p className="text-[0.7rem] text-ink-dim">The local tier can take a few minutes to answer.</p>
      )}

      {run.startError && <div role="alert" className="microlabel !text-warn/80">{run.startError}</div>}

      {job?.ok && job.job.state === "error" && (
        <div role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2.5">
          <div className="microlabel !text-bad mb-1">ask failed</div>
          <p className="font-mono text-xs text-bad/90 whitespace-pre-wrap break-words">
            {job.job.error ?? "Hermes reported an error with no further detail."}
          </p>
        </div>
      )}

      {/* Same reasoning as hermes-actions.tsx: the answer band appears once
          per run and holds still afterward, so role="status" directly on it
          announces the outcome without risking re-announcement on later polls. */}
      {job?.ok && job.job.state === "done" && job.job.result && (
        <div role="status" aria-live="polite" className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5">
          <div className="text-ink whitespace-pre-wrap break-words">{job.job.result.body || "(no answer)"}</div>
        </div>
      )}

      {job && !job.ok && <div role="alert" className="microlabel !text-bad">{job.detail}</div>}
    </div>
  );
}
