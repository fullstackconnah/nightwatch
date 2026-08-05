"use client";

/* THESIS: on THIS deployment the assistant is a typed control, not a mic.

   The kiosk is served over plain HTTP at 192.168.1.70:3005 — nginx-proxy-
   manager has no proxy host in front of it (verified: its proxy_host
   directory is empty, and https on that port refuses). That is a non-
   localhost insecure origin, so the browser blocks both
   `navigator.mediaDevices.getUserMedia` and SpeechRecognition. Every voice
   path is therefore unavailable on the wall tablet regardless of how it is
   written, and `useVoiceSupport()` in src/lib/use-voice.ts already detects
   exactly this and falls back to text.

   So the text field here is the PRIMARY control, not a degraded fallback,
   and the mic only appears where the browser can actually grant it. The
   alternative — shipping a prominent mic button that silently never works —
   would read as a broken feature rather than an absent one. If HTTPS is ever
   put in front of this surface the mic appears on its own, no code change.

   Device control does not go through the model: /kiosk/api/assistant matches
   intents deterministically server-side and only falls through to hermes for
   open questions. See src/lib/kiosk-intent.ts for why. */

import { useCallback, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssistantReply {
  ok: boolean;
  say: string;
  kind: string;
  answer?: string;
}

/** Kept small on purpose: this is a wall display, not a chat client. Two
 *  exchanges is enough to see what you just asked and what happened, without
 *  the pane growing tall enough to shift the carousel's height around it. */
const MAX_HISTORY = 2;

export function KioskAssistant({ onShowCamera }: { onShowCamera?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ asked: string; reply: AssistantReply }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (utterance: string) => {
      const trimmed = utterance.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setText("");
      try {
        const res = await fetch("/kiosk/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ utterance: trimmed }),
        });
        const reply = (await res.json()) as AssistantReply;
        setHistory((h) => [{ asked: trimmed, reply }, ...h].slice(0, MAX_HISTORY));
        // The camera intent has nothing to execute server-side — the modal
        // lives in page.tsx, so the route reports the intent and the host
        // opens it. Without a host callback the reply still reads sensibly.
        if (reply.kind === "camera" && reply.ok) onShowCamera?.();
      } catch {
        setHistory((h) =>
          [{ asked: trimmed, reply: { ok: false, say: "I couldn't reach the assistant.", kind: "unresolved" } }, ...h].slice(
            0,
            MAX_HISTORY,
          ),
        );
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, onShowCamera],
  );

  return (
    /* Stops the surface's root pointerdown from promoting glance→full on every
       keystroke and tap in here — the same opt-out the glance tiles use. A
       control's own press belongs to the control. */
    <div
      className="flex w-full max-w-xl flex-col gap-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="kiosk-assistant-input" className="sr-only">
          Ask the assistant
        </label>
        <span aria-hidden className="flex h-14 w-10 shrink-0 items-center justify-center text-ink-dim">
          <Sparkles size={18} />
        </span>
        <input
          id="kiosk-assistant-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder="Turn on the floodlight…"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-4 text-base text-ink outline-none transition placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send to the assistant"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
        >
          {busy ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Send size={18} aria-hidden />}
        </button>
      </form>

      {history.length > 0 && (
        /* aria-live so the spoken-less path still announces the outcome to a
           screen reader — this surface has no audio on an insecure origin. */
        <div aria-live="polite" className="flex flex-col gap-2">
          {history.map((h, i) => (
            <div key={`${h.asked}-${i}`} className="rounded-md border border-line bg-panel-2 px-3 py-2">
              <p className="truncate text-2xs text-ink-faint">{h.asked}</p>
              <p className={cn("mt-0.5 text-sm", h.reply.ok ? "text-ink" : "text-warn")}>{h.reply.say}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
