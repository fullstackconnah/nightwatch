/**
 * Server-only client for the voice speech server (STT + TTS), same shape as
 * hermes-ctl.ts: one process.env read (VOICE_SERVER_URL, plus optional
 * VOICE_STT_MODEL / VOICE_TTS_MODEL / VOICE_TTS_VOICE), read fresh on every
 * request, never cached, never routed through data/config.json — this is a
 * sibling daemon on the same box, not a third-party integration with a
 * UI-editable key.
 *
 * Being built in parallel against this contract:
 *   POST {url}/v1/audio/transcriptions  multipart file+model  -> { text }
 *   POST {url}/v1/audio/speech          JSON model/voice/input -> audio bytes
 *
 * Same distinguishable-failure vocabulary as hermes-ctl.ts minus
 * "unauthorized" (the contract carries no token): unconfigured (no
 * VOICE_SERVER_URL) / unreachable (transport failure or non-2xx) / error
 * (reachable but the response was unusable) / ok.
 *
 * Model/voice names are intentionally allowed to be empty: an unset env var
 * means "don't send the field, let the speech server apply its own
 * default" rather than "send an empty string as a model name". This file is
 * the one place those three env vars are read — routes never touch
 * process.env directly.
 */

const TIMEOUT_MS = 30_000; // STT of a ~15s clip plus a cold local model can be slow

interface VoiceCredentials {
  url: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
}

function voiceCredentials(): VoiceCredentials | null {
  const url = process.env.VOICE_SERVER_URL?.trim();
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ""),
    sttModel: process.env.VOICE_STT_MODEL?.trim() ?? "",
    ttsModel: process.env.VOICE_TTS_MODEL?.trim() ?? "",
    ttsVoice: process.env.VOICE_TTS_VOICE?.trim() ?? "",
  };
}

/** Cheap, credential-free presence check for /api/voice/status — lets the
 *  client hide every voice affordance outright when the operator hasn't set
 *  VOICE_SERVER_URL yet, rather than rendering a mic button that only fails
 *  once tapped. */
export function isVoiceConfigured(): boolean {
  return Boolean(process.env.VOICE_SERVER_URL?.trim());
}

export const VOICE_UNCONFIGURED_DETAIL =
  "Voice is not connected. Set VOICE_SERVER_URL (e.g. http://192.168.1.70:8970) in the server " +
  "environment, then recreate this container — it's read fresh on every request, so nothing else " +
  "needs to change once it's set.";

function unreachableDetail(url: string): string {
  return `Voice server at ${url} did not respond within ${TIMEOUT_MS / 1000}s.`;
}

/** One shape for every problem status, same convention as HermesStatusProblem. */
export interface VoiceProblem {
  status: "unconfigured" | "unreachable" | "error";
  detail: string;
}

function extensionForContentType(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default:
      return "webm";
  }
}

// --- POST /v1/audio/transcriptions ------------------------------------------

export type VoiceTranscribeResult = { status: "ok"; text: string } | VoiceProblem;

export async function transcribeAudio(audio: Buffer, contentType: string): Promise<VoiceTranscribeResult> {
  const creds = voiceCredentials();
  if (!creds) return { status: "unconfigured", detail: VOICE_UNCONFIGURED_DETAIL };

  const form = new FormData();
  const type = contentType.split(";")[0]?.trim() || "application/octet-stream";
  // Buffer's underlying ArrayBufferLike can widen to SharedArrayBuffer in
  // lib.dom's BlobPart typing; a plain Uint8Array copy sidesteps that.
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `speech.${extensionForContentType(contentType)}`);
  if (creds.sttModel) form.append("model", creds.sttModel);

  let res: Response;
  try {
    res = await fetch(`${creds.url}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { status: "unreachable", detail: unreachableDetail(creds.url) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      status: "error",
      detail: `Voice server returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : "."}`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "error", detail: "Voice server returned a non-JSON response." };
  }
  const text = body && typeof body === "object" && typeof (body as Record<string, unknown>).text === "string"
    ? ((body as Record<string, unknown>).text as string)
    : "";
  return { status: "ok", text };
}

// --- POST /v1/audio/speech --------------------------------------------------

export type VoiceSpeakResult =
  | { status: "ok"; body: ReadableStream<Uint8Array>; contentType: string }
  | VoiceProblem;

export async function speakText(text: string): Promise<VoiceSpeakResult> {
  const creds = voiceCredentials();
  if (!creds) return { status: "unconfigured", detail: VOICE_UNCONFIGURED_DETAIL };

  const payload: Record<string, string> = { input: text };
  if (creds.ttsModel) payload.model = creds.ttsModel;
  if (creds.ttsVoice) payload.voice = creds.ttsVoice;

  let res: Response;
  try {
    res = await fetch(`${creds.url}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { status: "unreachable", detail: unreachableDetail(creds.url) };
  }

  if (!res.ok || !res.body) {
    const text2 = await res.text().catch(() => "");
    return {
      status: "error",
      detail: `Voice server returned HTTP ${res.status}${text2 ? `: ${text2.slice(0, 200)}` : "."}`,
    };
  }

  return { status: "ok", body: res.body, contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}
