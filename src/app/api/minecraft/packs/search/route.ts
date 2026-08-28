import { NextRequest, NextResponse } from "next/server";
import { searchPacks } from "@/lib/minecraft/packs";

export const dynamic = "force-dynamic";

function isSource(v: string | null): v is "all" | "curseforge" | "modrinth" {
  return v === "all" || v === "curseforge" || v === "modrinth";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const sourceParam = searchParams.get("source");
  const source = isSource(sourceParam) ? sourceParam : "all";

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const result = await searchPacks(q, source);
  return NextResponse.json(result);
}
