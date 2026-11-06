import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";
import { listContainers } from "@/lib/docker";
import { restoreRefusal } from "@/lib/mc-backup-reason";

export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await mcManager.backups();
  if (!isProbeOk(probe)) {
    const { status, error } = probeErrorResponse(probe);
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json(probe.data);
}

// A bare file or instance name: a path piece would walk out of the backups folder on the manager.
const plainName = (v: string) => v.length <= 255 && !/[\/]/.test(v) && !v.includes("..");

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
    if (!plainName(body.instance) || !plainName(body.file)) {
      return NextResponse.json({ error: "instance and file must be plain names" }, { status: 400 });
    }
    // Trust boundary: the UI disables Restore while running, but the route must refuse it too.
    const all = await listContainers().catch(() => null);
    if (!all) return NextResponse.json({ error: "Couldn't check whether the server is running." }, { status: 503 });
    const refusal = restoreRefusal(all.find((c) => c.name === "minecraft")?.state);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
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
