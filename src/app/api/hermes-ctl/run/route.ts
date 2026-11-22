import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { sessionEpoch } from "@/lib/config";
import { contentLengthError } from "@/lib/upload-limit";
import { runAllowed } from "@/lib/kiosk-access";
import { allowAsk } from "@/lib/kiosk-ask-limit";
import { runHermesJob, type HermesRunResult } from "@/lib/hermes-ctl";
import type { HermesJobKind } from "@/lib/types/hermes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route — this
// is the one hermes-ctl route that actually does something (start a run on
// the daemon), but there is nothing to add here beyond what already runs,
// same reasoning src/app/api/ha/action/route.ts documents.

const VALID_KINDS: readonly HermesJobKind[] = ["digest", "alert-test", "ask"];
const MAX_QUESTION_LENGTH = 500;
const MAX_BODY_BYTES = 64 * 1024;

interface RunBody {
  kind: HermesJobKind;
  question?: string;
}

function isValidBody(value: unknown): value is RunBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!(VALID_KINDS as readonly string[]).includes(v.kind as string)) return false;
  if (v.kind === "ask") {
    if (typeof v.question !== "string" || !v.question.trim()) return false;
    if (v.question.length > MAX_QUESTION_LENGTH) return false;
  } else if (v.question !== undefined) {
    return false;
  }
  return true;
}

function statusCodeFor(status: Exclude<HermesRunResult, { ok: true }>["status"]): number {
  switch (status) {
    case "unconfigured":
      return 503; // nothing to talk to yet — mirrors /api/mcp's disabled response
    case "unreachable":
      return 502;
    case "unauthorized":
      return 502; // Hermes' token was rejected; a real 401 would make the client treat the app session as expired
    case "conflict":
      return 409; // Hermes' own "already running" — passed straight through
    case "error":
    default:
      return 500;
  }
}

export async function POST(req: NextRequest) {
  const tooBig = contentLengthError(req.headers.get("content-length"), MAX_BODY_BYTES, "The request");
  if (tooBig) return NextResponse.json({ error: tooBig.detail }, { status: tooBig.status });
  const body = await req.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json(
      {
        error: `kind must be one of ${VALID_KINDS.join(", ")}; "ask" additionally requires a non-empty question up to ${MAX_QUESTION_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  // Middleware lets a PIN-elevated kiosk reach this route and the kiosk only asks questions, so
  // without a real session nothing but "ask" (no digest, no alert-test) is allowed.
  const hasSession = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, sessionEpoch());
  if (!runAllowed(body.kind, hasSession)) {
    return NextResponse.json({ error: "kind not available to the kiosk" }, { status: 403 });
  }

  // Same process-wide cap as the kiosk assistant route; a signed-in dashboard session is not limited.
  if (!hasSession && body.kind === "ask") {
    const gate = allowAsk();
    if (!gate.ok) {
      const error =
        gate.reason === "daily" ? "That's all the questions I can take today." : "One question at a time. Try again in a few seconds.";
      return NextResponse.json({ error }, { status: 429 });
    }
  }

  const result = await runHermesJob(body.kind, body.kind === "ask" ? body.question!.trim() : undefined);
  if (result.ok) return NextResponse.json({ jobId: result.jobId }, { status: 202 });

  return NextResponse.json({ error: result.detail }, { status: statusCodeFor(result.status) });
}
