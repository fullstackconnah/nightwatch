import { NextRequest, NextResponse } from "next/server";
import { speakText, type VoiceSpeakResult } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts like every other /api/* route — see the
// same note in transcribe/route.ts.

const MAX_TEXT_LENGTH = 800;

function statusCodeFor(status: Exclude<VoiceSpeakResult, { status: "ok" }>["status"]): number {
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body && typeof body === "object" && typeof (body as Record<string, unknown>).text === "string"
    ? ((body as Record<string, unknown>).text as string).trim()
    : "";
  if (!text) {
    return NextResponse.json({ status: "error", detail: "text is required." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { status: "error", detail: `text exceeds the ${MAX_TEXT_LENGTH}-character limit.` },
      { status: 400 },
    );
  }

  const result = await speakText(text);
  if (result.status !== "ok") {
    return NextResponse.json({ status: result.status, detail: result.detail }, { status: statusCodeFor(result.status) });
  }

  return new NextResponse(result.body, {
    status: 200,
    headers: { "Content-Type": result.contentType },
  });
}
