import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";
import { loadConfig } from "@/lib/config";
import type { PackResult } from "@/lib/minecraft/packs";

export const dynamic = "force-dynamic";

/**
 * The manager's slug rule is `^[a-z0-9][a-z0-9-_]{0,63}$`. Pack slugs from
 * CurseForge/Modrinth are already close (both are lowercase-with-hyphens by
 * convention) but not guaranteed — this sanitizes rather than rejects, so a
 * pack with an unusual slug (or a user-supplied override) still installs
 * instead of bouncing with a validation error the operator can't act on.
 */
function sanitizeSlug(input: string): string {
  const lowered = input.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
  if (/^[a-z0-9]/.test(lowered)) return lowered;
  // Leading char must be [a-z0-9] per the manager's rule — prefix rather than
  // strip, so a slug that was otherwise fine doesn't lose a character.
  return `m${lowered}`.slice(0, 64) || "pack";
}

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
