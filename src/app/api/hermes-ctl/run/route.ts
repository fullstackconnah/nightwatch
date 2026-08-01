import { NextRequest, NextResponse } from "next/server";
import { runHermesJob, type HermesRunResult } from "@/lib/hermes-ctl";
import type { HermesJobKind } from "@/lib/hermes-types";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route — this
// is the one hermes-ctl route that actually does something (start a run on
// the daemon), but there is nothing to add here beyond what already runs,
// same reasoning src/app/api/ha/action/route.ts documents.

const VALID_KINDS: readonly HermesJobKind[] = ["digest", "alert-test", "ask"];
const MAX_QUESTION_LENGTH = 500;

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
      return 401;
    case "conflict":
      return 409; // Hermes' own "already running" — passed straight through
    case "error":
    default:
      return 500;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json(
      {
        error: `kind must be one of ${VALID_KINDS.join(", ")}; "ask" additionally requires a non-empty question up to ${MAX_QUESTION_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  const result = await runHermesJob(body.kind, body.kind === "ask" ? body.question!.trim() : undefined);
  if (result.ok) return NextResponse.json({ jobId: result.jobId }, { status: 202 });

  return NextResponse.json({ error: result.detail }, { status: statusCodeFor(result.status) });
}
