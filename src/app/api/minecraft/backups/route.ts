import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";
import { listContainers } from "@/lib/docker";
import { restoreRefusal } from "@/lib/mc-backup-reason";
import { busyMessage, holdAfterTimeout, tryBegin } from "@/lib/minecraft-busy";

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
const plainName = (v: string) => v.length <= 255 && !/[\/\\]/.test(v) && !v.includes("..");

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
    const release = tryBegin("run");
    if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
    let probe: Awaited<ReturnType<typeof mcManager.runBackup>> | undefined;
    try {
      probe = await mcManager.runBackup();
      if (!isProbeOk(probe)) {
        const { status, error } = probeErrorResponse(probe);
        return NextResponse.json({ error }, { status });
      }
      return NextResponse.json(probe.data);
    } finally {
      if (probe?.timedOut) holdAfterTimeout(release);
      else release();
    }
  }

  if (action === "restore" && isRestoreBody(body)) {
    if (!plainName(body.instance) || !plainName(body.file)) {
      return NextResponse.json({ error: "instance and file must be plain names" }, { status: 400 });
    }
    // Taken before the running check, so a Start can't slip in between that check and the restore.
    const release = tryBegin("restore");
    if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
    let probe: Awaited<ReturnType<typeof mcManager.restoreBackup>> | undefined;
    try {
      // Trust boundary: the UI disables Restore while running, but the route must refuse it too.
      const all = await listContainers().catch(() => null);
      if (!all) return NextResponse.json({ error: "Couldn't check whether the server is running." }, { status: 503 });
      const refusal = restoreRefusal(all.find((c) => c.name === "minecraft")?.state);
      if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
      probe = await mcManager.restoreBackup(body.instance, body.file);
      if (!isProbeOk(probe)) {
        // A timeout is the one case where the restore may still be running; the client keys its soft copy on 504.
        const { status, error } = probe.timedOut ? { status: 504, error: probeErrorResponse(probe).error } : probeErrorResponse(probe);
        return NextResponse.json({ error }, { status });
      }
      return NextResponse.json(probe.data);
    } finally {
      if (probe?.timedOut) holdAfterTimeout(release);
      else release();
    }
  }

  return NextResponse.json(
    { error: 'action must be "run" or "restore" (with instance and file)' },
    { status: 400 },
  );
}
