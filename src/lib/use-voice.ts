"use client";

/**
 * Shared client-side voice logic: secure-context detection, the
 * MediaRecorder + AnalyserNode recorder/visualizer primitive, and the full
 * kiosk pipeline built on top of it. Two tiers, both exported, so the
 * dashboard's compact mic (hermes-voice-mic.tsx) and the kiosk's full voice
 * panel (kiosk-voice.tsx) share exactly one implementation of "record, tap
 * again, transcribe" rather than each rolling their own:
 *
 *   useVoiceSupport()  — is getUserMedia usable at all right now.
 *   useVoiceRecorder() — record → transcribe, nothing else. What the
 *                        dashboard's compact mic uses: it hands the
 *                        transcript back to the caller and stops there.
 *   useVoicePipeline() — useVoiceRecorder() + the existing Hermes ask-job
 *                        flow (useHermesRun, unforked) + TTS playback. What
 *                        the kiosk's full voice panel uses.
 *
 * State machine (useVoicePipeline): idle -> recording -> transcribing ->
 * asking -> answering -> speaking -> idle. Every state is honest on
 * failure — a failure at any stage surfaces as `error` and returns the
 * machine to idle rather than hanging in the state that broke.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useHermesRun } from "@/lib/use-hermes";
import { isAsking, settleExchange } from "@/lib/voice-settle";

const LEVEL_BAR_COUNT = 5;
const STATIC_LEVEL = 0.4; // reduced-motion fallback: a flat, non-animated bar
// Hard stop so a forgotten mic doesn't record indefinitely or blow the
// server route's 8MB body cap (opus at typical MediaRecorder bitrates keeps
// a minute-long clip well under a megabyte).
const MAX_RECORDING_MS = 60_000;

// --- secure-context gate -----------------------------------------------------

export type VoiceSupport = { supported: true } | { supported: false; reason: string };

const UNSUPPORTED_REASON =
  "Voice needs a secure (https) connection — coming with the reverse-proxy setup.";

/**
 * getUserMedia requires HTTPS or localhost. Checked client-side only (both
 * APIs are undefined during SSR) so this starts "supported" for one render
 * and settles in an effect — callers should treat the very first render as
 * provisional, same as any other client-only capability check in this app.
 */
export function useVoiceSupport(): VoiceSupport {
  const [support, setSupport] = useState<VoiceSupport>({ supported: true });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const usable = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
    if (!usable) setSupport({ supported: false, reason: UNSUPPORTED_REASON });
  }, []);
  return support;
}

/**
 * Server-side presence check for VOICE_SERVER_URL (via /api/voice/status —
 * never the URL itself). `undefined` means "not yet known"; every caller in
 * this app treats that the same as `false` (don't render the affordance
 * yet) so a slow first fetch never flashes a mic button that immediately
 * disappears. Unset env -> voice hidden everywhere, per the backend
 * contract, not a disabled-with-explanation control the way the
 * secure-context gate is.
 */
export function useVoiceConfigured(): boolean | undefined {
  // Local fetcher: the shared one navigates to /login on a 401, which must
  // never happen to a kiosk just because the status probe was refused.
  const probe = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : { configured: false }));
  const { data } = useSWR<{ configured: boolean }>("/api/voice/status", probe, {
    revalidateOnFocus: false,
    refreshInterval: 0,
  });
  return data?.configured;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// --- recorder + visualizer primitive ----------------------------------------

export type RecorderState = "idle" | "recording" | "transcribing";

export interface UseVoiceRecorderResult {
  state: RecorderState;
  /** LEVEL_BAR_COUNT values, 0..1. Flat at STATIC_LEVEL while recording under
   *  prefers-reduced-motion; all zero once idle. */
  levels: number[];
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * Tap start() to arm the mic, stop() to end the clip and transcribe it via
 * /api/voice/transcribe. onTranscript fires once, with the trimmed text,
 * only on a successful non-empty transcription — every other outcome
 * (permission denied, empty clip, transcription failure) resolves back to
 * "idle" with `error` set instead.
 */
export function useVoiceRecorder(onTranscript: (text: string) => void): UseVoiceRecorderResult {
  const [state, setState] = useState<RecorderState>("idle");
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BAR_COUNT).fill(0));
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const mountedRef = useRef(true);

  const teardownStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true; // strict-mode remount re-arms it
    return () => {
      mountedRef.current = false;
      // Leaving mid-recording must not upload the clip or start an ask.
      if (recorderRef.current) recorderRef.current.onstop = null;
      teardownStream();
    };
  }, [teardownStream]);

  const sampleLevels = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bucket = Math.max(1, Math.floor(data.length / LEVEL_BAR_COUNT));
    const next: number[] = [];
    for (let i = 0; i < LEVEL_BAR_COUNT; i++) {
      const start = i * bucket;
      const end = Math.min(start + bucket, data.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j];
      next.push(end > start ? Math.min(1, sum / (end - start) / 200) : 0);
    }
    setLevels(next);
    rafRef.current = requestAnimationFrame(sampleLevels);
  }, []);

  const finish = useCallback(async () => {
    setState("transcribing");
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    teardownStream();
    setLevels(Array(LEVEL_BAR_COUNT).fill(0));

    if (blob.size === 0) {
      setError("No audio captured — try again.");
      setState("idle");
      return;
    }

    try {
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      const data: { status?: string; text?: string; detail?: string } = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "ok") {
        setError(data.detail ?? `Transcription failed (HTTP ${res.status}).`);
        setState("idle");
        return;
      }
      const text = (data.text ?? "").trim();
      if (!text) {
        setError("Heard nothing — try again, a little closer to the mic.");
        setState("idle");
        return;
      }
      setState("idle");
      if (!mountedRef.current) return; // the panel closed mid-transcribe: no ask
      onTranscriptRef.current(text);
    } catch {
      setError("Could not reach the transcription service.");
      setState("idle");
    }
  }, [teardownStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) return; // a second tap while getUserMedia is pending
    startingRef.current = true;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];

      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
      const mimeType = candidates.find(
        (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t),
      );
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void finish();
      };
      recorder.start();

      if (!prefersReducedMotion() && typeof window.AudioContext === "function") {
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          rafRef.current = requestAnimationFrame(sampleLevels);
        } catch {
          // The visualizer is decorative — recording still works without it.
          setLevels(Array(LEVEL_BAR_COUNT).fill(STATIC_LEVEL));
        }
      } else {
        setLevels(Array(LEVEL_BAR_COUNT).fill(STATIC_LEVEL));
      }

      maxTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);
      setState("recording");
    } catch {
      teardownStream(); // a MediaRecorder constructor throw must not leave the mic on
      setError("Could not access the microphone — check the browser's site permission.");
      setState("idle");
    } finally {
      startingRef.current = false;
    }
  }, [finish, sampleLevels, stop, teardownStream]);

  const reset = useCallback(() => {
    setError(null);
    setState("idle");
  }, []);

  return { state, levels, error, start, stop, reset };
}

// --- full kiosk pipeline: recorder + ask-job reuse + TTS --------------------

export type VoicePipelineState = "idle" | "recording" | "transcribing" | "asking" | "answering" | "speaking";

export interface VoiceExchange {
  id: string;
  transcript: string;
  answer: string | null;
  error: string | null;
}

const MAX_EXCHANGES = 3;
const MAX_SPEAK_CHARS = 800;

export interface UseVoicePipelineResult {
  state: VoicePipelineState;
  levels: number[];
  exchanges: VoiceExchange[]; // newest first
  error: string | null;
  /** Hermes job's own startedAt, for an elapsed-timer while `state === "asking"`. */
  askStartedAt: string | null;
  toggleRecording: () => void;
  submitText: (text: string) => void;
  stopSpeaking: () => void;
  dismissError: () => void;
}

/**
 * Wraps useVoiceRecorder with the SAME ask-job client hermes-ask.tsx uses
 * (useHermesRun — unforked, so /run's 409-on-already-running contract is
 * honoured the same way everywhere) and adds spoken playback of the answer
 * via /api/voice/speak. Exchanges are capped at MAX_EXCHANGES, newest first,
 * so a wall tablet never accumulates an unbounded scrollback.
 */
export function useVoicePipeline(): UseVoicePipelineResult {
  const [exchanges, setExchanges] = useState<VoiceExchange[]>([]);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // True from the moment a job settles "done" until the /api/voice/speak
  // round-trip resolves (success or failure) — the gap the "answering"
  // state machine step covers, distinct from "asking" (job still running)
  // and "speaking" (audio actually playing).
  const [awaitingSpeech, setAwaitingSpeech] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeExchangeId = useRef<string | null>(null);
  const run = useHermesRun();
  const runRef = useRef(run);
  runRef.current = run;
  const startingRef = useRef(false); // set synchronously, ahead of the render that flips run.starting
  const mountedRef = useRef(true);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true; // strict-mode remount re-arms it
    return () => {
      mountedRef.current = false;
      audioRef.current?.pause();
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed.slice(0, MAX_SPEAK_CHARS) }),
      });
      if (!res.ok) {
        const data: { detail?: string } = await res.json().catch(() => ({}));
        setPipelineError(data.detail ?? "Could not speak the answer.");
        return;
      }
      const blob = await res.blob();
      if (!mountedRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      const cleanup = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) {
          audioRef.current = null;
          audioUrlRef.current = null;
        }
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      setSpeaking(true);
      await audio.play().catch(cleanup);
    } catch {
      setPipelineError("Could not reach the speech service.");
    }
  }, []);

  const handleTranscript = useCallback(
    async (text: string) => {
      if (startingRef.current || isAsking(runRef.current)) return; // one question at a time
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeExchangeId.current = id;
      run.reset(); // drop the previous job so its error or answer cannot land on this question
      setExchanges((prev) => [{ id, transcript: text, answer: null, error: null }, ...prev].slice(0, MAX_EXCHANGES));
      startingRef.current = true;
      const failure = await run.start("ask", text).finally(() => {
        startingRef.current = false;
      });
      if (failure) {
        setExchanges((prev) => prev.map((ex) => (ex.id === id ? { ...ex, error: failure } : ex)));
        if (activeExchangeId.current === id) activeExchangeId.current = null;
      }
    },
    [run],
  );

  const recorder = useVoiceRecorder(handleTranscript);

  // Settles the active exchange once the job leaves "running" — fires once
  // per job because activeExchangeId is cleared immediately, so a later
  // render with the same settled job object (SWR stops polling once
  // settled) can't re-trigger it.
  useEffect(() => {
    const id = activeExchangeId.current;
    if (!id || !run.job) return;
    const s = settleExchange(run.job);
    if (s.kind === "wait") return;
    if (s.kind === "answer") {
      const { answer } = s;
      // error: null so an answer recovered after a failed read replaces the error
      setExchanges((prev) => prev.map((ex) => (ex.id === id ? { ...ex, answer, error: null } : ex)));
      activeExchangeId.current = null;
      setAwaitingSpeech(true);
      void speak(answer || "I didn't get an answer back.").finally(() => setAwaitingSpeech(false));
      return;
    }
    setExchanges((prev) => prev.map((ex) => (ex.id === id ? { ...ex, error: s.error } : ex)));
    if (!s.keepActive) activeExchangeId.current = null;
  }, [run.job, speak]);

  const state: VoicePipelineState =
    recorder.state === "recording"
      ? "recording"
      : recorder.state === "transcribing"
        ? "transcribing"
        : isAsking(run)
          ? "asking"
          : speaking
            ? "speaking"
            : awaitingSpeech
              ? "answering"
              : "idle";

  const toggleRecording = useCallback(() => {
    if (recorder.state === "recording") recorder.stop();
    else if (recorder.state === "idle" && state !== "asking") void recorder.start();
  }, [recorder, state]);

  const submitText = useCallback((text: string) => handleTranscript(text), [handleTranscript]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    setSpeaking(false);
  }, []);

  const dismissError = useCallback(() => {
    setPipelineError(null);
    recorder.reset();
  }, [recorder]);

  return {
    state,
    levels: recorder.levels,
    exchanges,
    error: pipelineError ?? recorder.error, // a failed run.start already shows on its exchange
    askStartedAt: run.job?.ok ? run.job.job.startedAt : null,
    toggleRecording,
    submitText,
    stopSpeaking,
    dismissError,
  };
}
