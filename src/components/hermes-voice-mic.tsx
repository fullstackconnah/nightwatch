"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useVoiceConfigured, useVoiceRecorder, useVoiceSupport } from "@/lib/use-voice";
import { cn } from "@/lib/utils";

/**
 * Compact mic affordance beside the /hermes Ask textarea. Reuses the same
 * record/transcribe primitive the kiosk voice panel uses
 * (useVoiceRecorder in src/lib/use-voice.ts) but stops there: the answer
 * flows through the SAME useHermesRun-backed Ask button HermesAsk already
 * has, so there's no second copy of the ask/answer machinery on the
 * dashboard — this component only ever hands a transcript back up.
 */
export function HermesVoiceMic({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const configured = useVoiceConfigured();
  const support = useVoiceSupport();
  const recorder = useVoiceRecorder(onTranscript);

  // VOICE_SERVER_URL unset: hidden outright, not shown-and-disabled — the
  // hook itself hasn't been called differently above, so this is a plain
  // early return, not a conditional hook call.
  if (!configured) return null;

  if (!support.supported) {
    return (
      <button
        type="button"
        disabled
        title={support.reason}
        aria-label={`Voice input unavailable: ${support.reason}`}
        className="h-11 w-11 md:h-8 md:w-8 shrink-0 rounded-md border border-line text-ink-faint flex items-center justify-center opacity-50 cursor-not-allowed"
      >
        <Mic size={14} />
      </button>
    );
  }

  const recording = recorder.state === "recording";
  const transcribing = recorder.state === "transcribing";

  function toggle() {
    if (recording) recorder.stop();
    else if (!transcribing && !disabled) void recorder.start();
  }

  const label = recording ? "Stop recording" : transcribing ? "Transcribing…" : "Ask by voice";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={(disabled && !recording) || transcribing}
      aria-label={label}
      title={recorder.error ?? label}
      className={cn(
        "h-11 w-11 md:h-8 md:w-8 shrink-0 rounded-md border flex items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        recording
          ? "bg-accent/15 border-accent/50 text-accent voice-mic-recording"
          : "border-line text-ink-dim hover:text-ink hover:border-line-bright",
      )}
    >
      {transcribing ? (
        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
      ) : recording ? (
        <Square size={14} />
      ) : (
        <Mic size={14} />
      )}
    </button>
  );
}
