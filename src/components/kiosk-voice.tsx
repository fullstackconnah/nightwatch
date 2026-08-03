"use client";

/* THESIS: the kiosk's own §-shaped exchange — tap the mic, see a blue-tinted
   "what you said" card land above a logbox-style "what Hermes said" card,
   newest exchange on top, last three kept. The mic button carries the one
   authored motion (voice-mic-recording's breathing ring); the bar display
   below it is live data, not decoration, so it isn't gated behind
   prefers-reduced-motion the way the ring is — use-voice.ts already freezes
   it to a flat static level there instead of sampling. OWN-WORLD: same
   hairline .panel / mono / microlabel vocabulary as the rest of nightwatch,
   just sized for a wall tablet read from across the room. */

import { useState } from "react";
import { Loader2, Mic, Send, Square, VolumeX } from "lucide-react";
import { ElapsedTimer } from "@/components/hermes-ask";
import { useHermesStatus } from "@/lib/use-hermes";
import { useVoiceConfigured, useVoicePipeline, useVoiceSupport, type VoiceExchange } from "@/lib/use-voice";
import { cn } from "@/lib/utils";

/* Bars are drawn at full fixed height and scaled with a compositor-only
   `transform: scaleY()` from each bar's own vertical centre, rather than
   animating the SVG height/y geometry — same "transform/opacity, not
   layout properties" rule the rest of this system's motion follows. */
function VoiceLevelBars({ levels, active }: { levels: number[]; active: boolean }) {
  return (
    <svg viewBox="0 0 100 40" className="w-28 h-10 text-accent" aria-hidden="true">
      {levels.map((level, i) => {
        const x = 2 + i * 20;
        const cy = 20;
        return (
          <rect
            key={i}
            x={x}
            y={2}
            width={12}
            height={36}
            rx={2}
            fill="currentColor"
            opacity={active ? 0.9 : 0.3}
            style={{
              transform: `scaleY(${Math.max(0.1, level)})`,
              transformOrigin: `${x + 6}px ${cy}px`,
              transition: "transform 80ms linear",
            }}
          />
        );
      })}
    </svg>
  );
}

function VoiceExchangeCards({ exchange }: { exchange: VoiceExchange }) {
  return (
    <div className="space-y-1.5">
      <div className="rounded-md border border-blue/30 bg-blue/5 px-3 py-2 font-mono text-xs text-blue whitespace-pre-wrap break-words">
        {exchange.transcript}
      </div>
      {exchange.answer !== null && (
        <div className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5 text-ink whitespace-pre-wrap break-words">
          {exchange.answer || "(no answer)"}
        </div>
      )}
      {exchange.error !== null && (
        <div className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2.5">
          <p className="font-mono text-xs text-bad/90 whitespace-pre-wrap break-words">{exchange.error}</p>
        </div>
      )}
    </div>
  );
}

function VoiceTextFallback({ onSubmit, disabled }: { onSubmit: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setValue("");
      }}
      className="flex items-center gap-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Type instead…"
        maxLength={500}
        className="flex-1 h-11 rounded-md border border-line bg-bg px-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 font-mono disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="h-11 px-4 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
      >
        <Send size={13} /> Ask
      </button>
    </form>
  );
}

/**
 * The wall-tablet voice panel — elevated kiosk only (KioskPage gates it the
 * same way it gates KioskAdminPanel). Fetches Hermes status itself (the
 * elevation cookie already passes middleware.ts the same way it does for
 * KioskAdminPanel's container calls) purely for the tier string the
 * local-tier honesty note needs; falls back to generic copy if that
 * fetch hasn't resolved or Hermes isn't reachable.
 */
export function KioskVoicePanel() {
  const configured = useVoiceConfigured();
  const support = useVoiceSupport();
  const pipeline = useVoicePipeline();
  const { data: status } = useHermesStatus();
  const tier = status?.status === "ok" ? status.tier.tier : null;

  // VOICE_SERVER_URL unset: the whole panel is hidden, not shown-disabled —
  // hooks above still run unconditionally, only the render bails out.
  if (!configured) return null;

  const recording = pipeline.state === "recording";
  const transcribing = pipeline.state === "transcribing";
  const asking = pipeline.state === "asking";
  const answering = pipeline.state === "answering";
  const speaking = pipeline.state === "speaking";
  const busy = transcribing || asking || answering || speaking;

  function micLabel(): string {
    if (recording) return "Tap to stop";
    if (transcribing) return "Transcribing…";
    if (asking) return "Asking Hermes…";
    if (answering) return "Answer's in…";
    if (speaking) return "Speaking…";
    return "Tap to ask Hermes";
  }

  return (
    <div className="w-full max-w-xl flex flex-col items-center gap-4">
      <span className="microlabel">voice</span>

      {!support.supported ? (
        <div className="panel w-full px-5 py-4 space-y-3 text-center">
          <p className="text-xs text-ink-dim">{support.reason}</p>
          <VoiceTextFallback onSubmit={pipeline.submitText} disabled={asking} />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={pipeline.toggleRecording}
            disabled={busy}
            aria-label={micLabel()}
            className={cn(
              "h-24 w-24 rounded-full flex items-center justify-center border outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-colors",
              recording
                ? "bg-accent/15 border-accent/50 text-accent voice-mic-recording"
                : "bg-panel-2 border-line text-ink-dim hover:text-ink hover:border-line-bright",
            )}
          >
            {transcribing || asking || answering ? (
              <Loader2 size={30} className="animate-spin motion-reduce:animate-none" />
            ) : recording ? (
              <Square size={28} />
            ) : (
              <Mic size={30} />
            )}
          </button>

          <VoiceLevelBars levels={pipeline.levels} active={recording} />

          <div className="microlabel">{micLabel()}</div>

          {asking && (
            <div className="flex items-center gap-2 text-ink-dim text-xs text-center">
              <ElapsedTimer startedAt={pipeline.askStartedAt} />
              {tier === "local" && <span>· thinking locally can take a couple of minutes</span>}
            </div>
          )}

          {speaking && (
            <button
              type="button"
              onClick={pipeline.stopSpeaking}
              className="h-11 px-4 rounded-md border border-line text-ink-dim hover:text-ink hover:border-line-bright text-xs flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <VolumeX size={14} /> Stop speaking
            </button>
          )}
        </>
      )}

      {pipeline.error && (
        <button
          type="button"
          onClick={pipeline.dismissError}
          // min-h-14, not a fixed h-*: the error text can wrap past one line,
          // and a fixed height would clip it. No border/background — the
          // touch floor is a hit-area, not a visual weight, on a surface
          // that's meant to disappear once dismissed.
          className="microlabel !text-bad max-w-xs min-h-14 flex items-center justify-center px-3 text-center"
        >
          {pipeline.error}
        </button>
      )}

      {pipeline.exchanges.length > 0 && (
        <div className="w-full space-y-2">
          {pipeline.exchanges.map((ex) => (
            <VoiceExchangeCards key={ex.id} exchange={ex} />
          ))}
        </div>
      )}
    </div>
  );
}
