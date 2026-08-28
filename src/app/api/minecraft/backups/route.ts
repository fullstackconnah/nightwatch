import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await mcManager.backups();
  if (!isProbeOk(probe)) {
    const { status, error } = probeErrorResponse(probe);
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json(probe.data);
}

function isRestoreBody(v: unknown): v is { action: "restore"; instance: string; file: string } {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    b.action === "restore" &&
    typeof b.instance === "string" &&
    b.instance.length > 0 &&
    typeof b.file === "string" &&
    b.file.length > 0
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as Record<string, unknown>).action : undefined;

  if (action === "run") {
    const probe = await mcManager.runBackup();
    if (!isProbeOk(probe)) {
      const { status, error } = probeErrorResponse(probe);
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json(probe.data);
  }

  if (action === "restore" && isRestoreBody(body)) {
    const probe = await mcManager.restoreBackup(body.instance, body.file);
    if (!isProbeOk(probe)) {
      const { status, error } = probeErrorResponse(probe);
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json(probe.data);
  }

  return NextResponse.json(
    { error: 'action must be "run" or "restore" (with instance and file)' },
    { status: 400 },
  );
}
