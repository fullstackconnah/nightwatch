import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";
import { loadConfig } from "@/lib/config";
import type { PackResult } from "@/lib/minecraft/packs";
import { sanitizeSlug } from "@/lib/minecraft/slug";
import { MAX_MEMORY_GB, memoryGbInRange } from "@/lib/minecraft/memory-gb";

export const dynamic = "force-dynamic";

function isPackResult(v: unknown): v is PackResult {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    (p.source === "curseforge" || p.source === "modrinth") &&
    typeof p.slug === "string" &&
    p.slug.length > 0 &&
    typeof p.name === "string" &&
    typeof p.pageUrl === "string"
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pack = body && typeof body === "object" ? (body as Record<string, unknown>).pack : undefined;
  if (!isPackResult(pack)) {
    return NextResponse.json({ error: "pack (PackResult) is required" }, { status: 400 });
  }

  const slugOverride = (body as Record<string, unknown>).slug;
  const memoryGbRaw = (body as Record<string, unknown>).memoryGb;

  const rawSlug = typeof slugOverride === "string" && slugOverride.trim() ? slugOverride : pack.slug;
  const slug = sanitizeSlug(rawSlug);
  const memoryGb = typeof memoryGbRaw === "number" && Number.isFinite(memoryGbRaw) ? memoryGbRaw : undefined;
  if (memoryGb !== undefined && !memoryGbInRange(memoryGb)) {
    return NextResponse.json({ error: `memoryGb must be above 0 and at most ${MAX_MEMORY_GB}` }, { status: 400 });
  }

  let cfApiKey: string | undefined;
  if (pack.source === "curseforge") {
    cfApiKey = loadConfig().minecraft?.curseforgeKey?.trim() || undefined;
    if (!cfApiKey) {
      return NextResponse.json({ error: "Add the CurseForge API key in Settings first" }, { status: 400 });
    }
  }

  const probe = await mcManager.createInstance({
    slug,
    name: pack.name,
    source: pack.source,
    packRef: pack.pageUrl,
    mcVersion: pack.mcVersion ?? "",
    memoryGb,
    cfApiKey,
  });

  if (!isProbeOk(probe)) {
    const { status, error } = probeErrorResponse(probe);
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json(probe.data);
}
