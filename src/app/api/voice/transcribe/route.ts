import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio, type VoiceTranscribeResult } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts like every other /api/* route — an
// elevated kiosk passes the same way it passes for /api/docker/*, so voice
// is NOT added to PUBLIC_PATHS even though /kiosk itself is public.

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function statusCodeFor(status: Exclude<VoiceTranscribeResult, { status: "ok" }>["status"]): number {
  switch (status) {
    case "unconfigured":
      return 503;
    case "unreachable":
      return 502;
    case "error":
    default:
      return 500;
  }
}

/**
 * Accepts either a multipart/form-data body with a "file" field (curl -F,
 * or any client that already assembles the upstream shape) or a raw audio
 * body with Content-Type set to the recorder's mime type (what
 * src/lib/use-voice.ts actually sends — a MediaRecorder blob POSTed as-is).
 * Either way this route is the one place that builds the multipart request
 * transcribeAudio() forwards to the speech server.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let buf: Buffer;
  let audioContentType: string;

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ status: "error", detail: "Could not parse multipart body." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { status: "error", detail: 'Multipart body must include a "file" field.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_BODY_BYTES) {
      return NextResponse.json({ status: "error", detail: "Audio exceeds the 8MB limit." }, { status: 413 });
    }
    buf = Buffer.from(await file.arrayBuffer());
    audioContentType = file.type || "application/octet-stream";
  } else {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return NextResponse.json({ status: "error", detail: "Audio exceeds the 8MB limit." }, { status: 413 });
    }
    let raw: ArrayBuffer;
    try {
      raw = await req.arrayBuffer();
    } catch {
      return NextResponse.json({ status: "error", detail: "Could not read the request body." }, { status: 400 });
    }
    if (raw.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ status: "error", detail: "Audio exceeds the 8MB limit." }, { status: 413 });
    }
    buf = Buffer.from(raw);
    audioContentType = contentType || "application/octet-stream";
  }

  if (buf.byteLength === 0) {
    return NextResponse.json({ status: "error", detail: "No audio received." }, { status: 400 });
  }

  const result = await transcribeAudio(buf, audioContentType);
  if (result.status === "ok") return NextResponse.json(result);
  return NextResponse.json(result, { status: statusCodeFor(result.status) });
}
