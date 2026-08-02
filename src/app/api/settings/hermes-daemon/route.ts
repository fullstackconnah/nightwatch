import { NextRequest, NextResponse } from "next/server";
import { readHermesSettingsFile, writeHermesSettingsFile, type HermesSettingsFile } from "@/lib/config";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/**
 * Read-modify-write route for data/hermes/hermes-settings.json (GOAL B) — the
 * settings page's Hermes · Daemon card. This file is a hot-read contract
 * with a SEPARATE process (the hermes ops daemon, built in parallel against
 * this same schema — see src/lib/config.ts's HermesSettingsFile), not part
 * of config.json, so this route never touches loadConfig()/saveConfig() at
 * all. Keys present in the file override the daemon's own env var; keys
 * absent fall back to its env — that precedence lives in the daemon, not
 * here. Copy notes on the settings page: changes reach the daemon on its
 * next loop tick (<=60s), no restart required.
 *
 * `nightwatchMcpToken` is deliberately NOT accepted from this route's body —
 * it is written exactly once, in lockstep, by syncHermesMcpToken() whenever
 * POST /api/settings/system sets or regenerates the MCP token. Editing it
 * here would let it drift from the token nightwatch's own MCP server
 * actually expects, exactly the desync GOAL B's sync rule exists to prevent.
 *
 * Secret fields (discordWebhookUrl, discordBotToken) follow the same
 * write-only masked idiom as every other settings panel: an absent or empty
 * value keeps what's stored, and an explicit `clearX: true` flag is the only
 * way to remove one.
 */

interface Body {
  discordWebhookUrl?: unknown;
  clearDiscordWebhookUrl?: unknown;
  discordBotToken?: unknown;
  clearDiscordBotToken?: unknown;
  discordChannelId?: unknown;
  discordAllowedUserIds?: unknown;
  dryRun?: unknown;
  digestHour?: unknown;
  digestMinute?: unknown;
  pipelineEnabled?: unknown;
  pipelineDailyBudgetUsd?: unknown;
  pipelineModel?: unknown;
  pipelineModelHard?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

function mergedSecret(newValue: string | undefined, existing: string | undefined): string | undefined {
  return newValue ? newValue : existing;
}

function intInRange(v: unknown, min: number, max: number): number | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return "invalid";
  return v;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const existing = readHermesSettingsFile() ?? { updatedAt: new Date().toISOString() };

  const discordWebhookUrl = body.clearDiscordWebhookUrl === true
    ? undefined
    : mergedSecret(str(body.discordWebhookUrl), existing.discordWebhookUrl);
  const discordBotToken = body.clearDiscordBotToken === true
    ? undefined
    : mergedSecret(str(body.discordBotToken), existing.discordBotToken);
  const discordChannelId = "discordChannelId" in body ? (str(body.discordChannelId) ?? existing.discordChannelId) : existing.discordChannelId;

  let discordAllowedUserIds = existing.discordAllowedUserIds;
  if ("discordAllowedUserIds" in body) {
    if (!Array.isArray(body.discordAllowedUserIds) || !body.discordAllowedUserIds.every((x) => typeof x === "string")) {
      return NextResponse.json({ error: "discordAllowedUserIds must be an array of strings" }, { status: 400 });
    }
    discordAllowedUserIds = body.discordAllowedUserIds.map((x) => x.trim()).filter(Boolean);
  }

  const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : existing.dryRun;
  const pipelineEnabled = typeof body.pipelineEnabled === "boolean" ? body.pipelineEnabled : existing.pipelineEnabled;

  const digestHour = intInRange(body.digestHour, 0, 23);
  if (digestHour === "invalid") return NextResponse.json({ error: "digestHour must be an integer 0-23" }, { status: 400 });
  const digestMinute = intInRange(body.digestMinute, 0, 59);
  if (digestMinute === "invalid") return NextResponse.json({ error: "digestMinute must be an integer 0-59" }, { status: 400 });

  let pipelineDailyBudgetUsd = existing.pipelineDailyBudgetUsd;
  if (body.pipelineDailyBudgetUsd !== undefined) {
    if (typeof body.pipelineDailyBudgetUsd !== "number" || !Number.isFinite(body.pipelineDailyBudgetUsd) || body.pipelineDailyBudgetUsd < 0) {
      return NextResponse.json({ error: "pipelineDailyBudgetUsd must be a non-negative number" }, { status: 400 });
    }
    pipelineDailyBudgetUsd = body.pipelineDailyBudgetUsd;
  }

  const pipelineModel = "pipelineModel" in body ? (str(body.pipelineModel) ?? existing.pipelineModel) : existing.pipelineModel;
  const pipelineModelHard = "pipelineModelHard" in body ? (str(body.pipelineModelHard) ?? existing.pipelineModelHard) : existing.pipelineModelHard;

  const now = new Date().toISOString();
  const next: HermesSettingsFile = {
    discordWebhookUrl,
    discordBotToken,
    discordChannelId,
    discordAllowedUserIds,
    dryRun,
    digestHour: digestHour ?? existing.digestHour,
    digestMinute: digestMinute ?? existing.digestMinute,
    pipelineEnabled,
    pipelineDailyBudgetUsd,
    pipelineModel,
    pipelineModelHard,
    // Never accepted from this route's body — see the file comment above.
    nightwatchMcpToken: existing.nightwatchMcpToken,
    updatedAt: now,
  };

  try {
    writeHermesSettingsFile(next);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    updatedAt: now,
    discordWebhookConfigured: Boolean(discordWebhookUrl),
    discordBotTokenConfigured: Boolean(discordBotToken),
  });
}
