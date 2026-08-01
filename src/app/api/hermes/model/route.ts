import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig, writeHermesModelFile, type AppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

const TIERS = ["local", "openrouter", "anthropic"] as const;
type Tier = (typeof TIERS)[number];

interface Body {
  tier?: unknown;
  model?: unknown;
  openrouterApiKey?: unknown;
  anthropicApiKey?: unknown;
  clearOpenrouterKey?: unknown;
  clearAnthropicKey?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

/**
 * Saves the Hermes tier/model pick into config.json (read-modify-write, same
 * pattern as /api/settings/integrations — spreads the current config so
 * every other block survives untouched) AND mirrors it into a sibling
 * data/hermes-model.json via writeHermesModelFile, which is the file the
 * hermes daemon actually hot-reads. Changes apply on the daemon's next
 * scheduled run; there is no restart signal from this route.
 *
 * Key semantics match the Integrations panels: an empty/absent key field
 * keeps whatever is already stored, and `clearOpenrouterKey`/
 * `clearAnthropicKey` are the explicit way to remove one.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tier = str(body.tier);
  const model = str(body.model);
  if (!tier || !(TIERS as readonly string[]).includes(tier)) {
    return NextResponse.json({ error: `tier must be one of ${TIERS.join(", ")}` }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  const current = loadConfig();
  const existing = current.hermes;

  const openrouterApiKey = body.clearOpenrouterKey
    ? undefined
    : (str(body.openrouterApiKey) ?? existing?.openrouterApiKey);
  const anthropicApiKey = body.clearAnthropicKey
    ? undefined
    : (str(body.anthropicApiKey) ?? existing?.anthropicApiKey);

  if (tier === "openrouter" && !openrouterApiKey) {
    return NextResponse.json({ error: "OpenRouter tier needs an OpenRouter API key" }, { status: 400 });
  }
  if (tier === "anthropic" && !anthropicApiKey) {
    return NextResponse.json({ error: "Anthropic tier needs an Anthropic API key" }, { status: 400 });
  }

  const tierTyped = tier as Tier;
  const next: AppConfig = {
    ...current,
    hermes: { tier: tierTyped, model, openrouterApiKey, anthropicApiKey },
  };

  const updatedAt = new Date().toISOString();
  try {
    saveConfig(next);
    writeHermesModelFile({ tier: tierTyped, model, openrouterApiKey, anthropicApiKey, updatedAt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    tier: tierTyped,
    model,
    openrouterConfigured: Boolean(openrouterApiKey),
    anthropicConfigured: Boolean(anthropicApiKey),
    updatedAt,
  });
}
