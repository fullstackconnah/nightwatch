/* THESIS: a textarea, a submit, and one answer band — the Ask strip's detail. "Ask a question" and "run a scheduled
   job" are different mental modes even though they ride the same /run contract, and the daemon runs one job at a time,
   so the page owns the slot and passes `run` down (results filtered by job kind). The local-tier note only appears
   once we know the tier is local (from the status poll), so it never claims a wait that OpenRouter/Anthropic wouldn't
   have. OWN-WORLD: nightwatch console — mono counter, .logbox-style answer band with preserved line breaks. */
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HermesVoiceMic } from "@/components/integrations/hermes-voice-mic";
import { jobFor } from "@/lib/hermes/page-model";
import type { UseHermesRunResult } from "@/lib/use-hermes";
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

/** `enabled` is the page's one-slot answer: off while any Hermes job runs, or while the page shows old data. */
export function HermesAsk({ tier, run, enabled }: { tier: string | null; run: UseHermesRunResult; enabled: boolean }) {
  const [question, setQuestion] = useState("");

  const { job, problem } = jobFor("ask", run);
  const trimmed = question.trim();
  const overLimit = question.length > MAX_LENGTH;

  async function submit() {
    if (!trimmed || overLimit || !enabled) return;
    // A refused start (the daemon's 409) keeps the question so it can be sent again.
    if (!(await run.start("ask", trimmed))) setQuestion("");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={!enabled}
            placeholder="Ask about anything Hermes has seen — a container, a trend, tonight's digest…"
            // Placeholder text disappears once typed, so the name is explicit.
            aria-label="Ask Hermes"
            rows={3}
            maxLength={MAX_LENGTH + 40}
            className={cn(
              "flex-1 min-w-0 rounded-md border border-line bg-bg px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 font-mono resize-y disabled:opacity-60",
            )}
          />
          <HermesVoiceMic
            disabled={!enabled}
            onTranscript={(text) => setQuestion((q) => (q ? `${q} ${text}` : text).slice(0, MAX_LENGTH))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("font-mono text-[0.65rem] tabular-nums", overLimit ? "text-bad" : "text-ink-faint")}>
            {question.length}/{MAX_LENGTH}
          </span>
          <Button size="sm" disabled={!trimmed || overLimit || !enabled} onClick={() => void submit()}>
            <Send size={13} /> Ask
          </Button>
        </div>
      </div>

      {job?.state === "running" && tier === "local" && (
        <p className="text-[0.7rem] text-ink-dim">The local tier can take a few minutes to answer.</p>
      )}

      {problem && <div role="alert" className="microlabel !text-warn/80">{problem}</div>}

      {job?.state === "error" && (
        <div role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2.5">
          <div className="microlabel !text-bad mb-1">ask failed</div>
          <p className="font-mono text-xs text-bad/90 whitespace-pre-wrap break-words">
            {job.error ?? "Hermes reported an error with no further detail."}
          </p>
        </div>
      )}

      {/* The answer band appears once per run and holds still afterward, so role="status" directly on it announces the
          outcome without re-announcing on later polls. */}
      {job?.state === "done" && job.result && (
        <div role="status" aria-live="polite" className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5">
          <div className="text-ink whitespace-pre-wrap break-words">{job.result.body || "(no answer)"}</div>
        </div>
      )}
    </div>
  );
}
