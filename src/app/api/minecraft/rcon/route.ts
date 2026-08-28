import { NextRequest, NextResponse } from "next/server";
import { rconCommand } from "@/lib/minecraft/rcon";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const command = body && typeof body === "object" ? (body as Record<string, unknown>).command : undefined;
  if (typeof command !== "string" || !command.trim()) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }

  const mc = loadConfig().minecraft;
  if (!mc?.rconHost || !mc?.rconPassword) {
    return NextResponse.json({ error: "RCON not configured" }, { status: 409 });
  }

  try {
    const response = await rconCommand({
      host: mc.rconHost,
      port: mc.rconPort ?? 25575,
      password: mc.rconPassword,
      command,
    });
    return NextResponse.json({ response });
  } catch (e) {
    const message = e instanceof Error ? e.message : "rcon command failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
