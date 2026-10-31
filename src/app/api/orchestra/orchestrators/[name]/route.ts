import { NextResponse, type NextRequest } from "next/server";
import { getOrchestraDetail, ORCHESTRA_NAME } from "@/lib/orchestra";
import { requireFullSession } from "@/lib/orchestra-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const denied = await requireFullSession(req);
  if (denied) return denied;
  const { name } = await params;
  if (!ORCHESTRA_NAME.test(name)) return NextResponse.json({ error: "Invalid orchestrator name." }, { status: 400 });
  const body = await getOrchestraDetail(name);
  if (body.status === "ok" && !body.orchestrator) return NextResponse.json({ error: "No such orchestrator." }, { status: 404 });
  return NextResponse.json(body);
}
