import { isDeepStrictEqual } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { contentLengthError } from "@/lib/upload-limit";
import { candidatePasswordHashes } from "@/lib/auth-server";
import { checkCurrentPassword, currentPasswordLimiter } from "@/lib/step-up";
import { discordStepUpNeeded } from "@/lib/discord-step-up";
import { HERMES_SETTINGS_UNREADABLE, readHermesSettingsFileForSave, writeHermesSettingsFile, type HermesSettingsFile } from "@/lib/config";
import { budgetChangeError, discordChannelIdError, discordUserIdsError, modelNameError, webhookError } from "@/lib/settings-checks";

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
  currentPassword?: unknown;
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

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const tooBig = contentLengthError(req.headers.get("content-length"), MAX_BODY_BYTES, "The request");
  if (tooBig) return NextResponse.json({ error: tooBig.detail }, { status: tooBig.status });
  let body: Body;
  try {
    const parsed = await req.json();
    body = parsed;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // A patch route has no required field, so a null, array or string body gets its own 400.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  // Free text the Hermes daemon reads from the file: check it at this boundary, before the read and any write.
  let typedUserIds: string[] | undefined;
  if ("discordAllowedUserIds" in body) {
    if (!Array.isArray(body.discordAllowedUserIds) || !body.discordAllowedUserIds.every((x) => typeof x === "string")) {
      return NextResponse.json({ error: "discordAllowedUserIds must be an array of strings" }, { status: 400 });
    }
    typedUserIds = body.discordAllowedUserIds.map((x) => x.trim()).filter(Boolean);
  }
  const badInput =
    discordChannelIdError(str(body.discordChannelId)) ??
    (typedUserIds && discordUserIdsError(typedUserIds)) ??
    modelNameError("Model", str(body.pipelineModel)) ??
    modelNameError("Hard-ticket model", str(body.pipelineModelHard));
  if (badInput) return NextResponse.json({ error: badInput }, { status: 400 });

  let raw: HermesSettingsFile | null;
  let existing: HermesSettingsFile;
  try {
    raw = readHermesSettingsFileForSave();
    existing = raw ?? { updatedAt: new Date().toISOString() };
  } catch {
    return NextResponse.json({ error: HERMES_SETTINGS_UNREADABLE }, { status: 500 });
  }

  const badWebhook = body.clearDiscordWebhookUrl === true ? null : webhookError(str(body.discordWebhookUrl));
  if (badWebhook) return NextResponse.json({ error: badWebhook }, { status: 400 });
  const discordWebhookUrl = body.clearDiscordWebhookUrl === true
    ? undefined
    : mergedSecret(str(body.discordWebhookUrl), existing.discordWebhookUrl);
  const discordBotToken = body.clearDiscordBotToken === true
    ? undefined
    : mergedSecret(str(body.discordBotToken), existing.discordBotToken);
  // An empty value over an absent key leaves it absent: the gate counts them equal, and a written "" or [] would override the daemon's env.
  const typedChannelId = "discordChannelId" in body ? (str(body.discordChannelId) ?? existing.discordChannelId) : existing.discordChannelId;
  const discordChannelId = existing.discordChannelId === undefined && typedChannelId === "" ? undefined : typedChannelId;

  const discordAllowedUserIds =
    existing.discordAllowedUserIds === undefined && typedUserIds?.length === 0 ? undefined : (typedUserIds ?? existing.discordAllowedUserIds);

  const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : existing.dryRun;
  const pipelineEnabled = typeof body.pipelineEnabled === "boolean" ? body.pipelineEnabled : existing.pipelineEnabled;

  const digestHour = intInRange(body.digestHour, 0, 23);
  if (digestHour === "invalid") return NextResponse.json({ error: "digestHour must be an integer 0-23" }, { status: 400 });
  const digestMinute = intInRange(body.digestMinute, 0, 59);
  if (digestMinute === "invalid") return NextResponse.json({ error: "digestMinute must be an integer 0-59" }, { status: 400 });

  let pipelineDailyBudgetUsd = existing.pipelineDailyBudgetUsd;
  if (body.pipelineDailyBudgetUsd !== undefined) {
    const overBudget = budgetChangeError(body.pipelineDailyBudgetUsd, existing.pipelineDailyBudgetUsd);
    if (overBudget) return NextResponse.json({ error: overBudget }, { status: 400 });
    pipelineDailyBudgetUsd = body.pipelineDailyBudgetUsd as number; // budgetChangeError passed it
  }

  const pipelineModel = "pipelineModel" in body ? (str(body.pipelineModel) ?? existing.pipelineModel) : existing.pipelineModel;
  const pipelineModelHard = "pipelineModelHard" in body ? (str(body.pipelineModelHard) ?? existing.pipelineModelHard) : existing.pipelineModelHard;

  // --- Step-up: changing who may command Hermes, or where it posts, needs the current password. ---
  // After every 400 above, so a typo never burns an attempt; before the write.
  if (
    discordStepUpNeeded(
      {
        botToken: str(body.discordBotToken),
        clearBotToken: body.clearDiscordBotToken === true,
        webhookUrl: str(body.discordWebhookUrl),
        clearWebhookUrl: body.clearDiscordWebhookUrl === true,
        allowedUserIds: typedUserIds,
        channelId: "discordChannelId" in body ? str(body.discordChannelId) : undefined,
      },
      existing,
    )
  ) {
    const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const check = await checkCurrentPassword(password, candidatePasswordHashes().map((c) => c.hash), {
      limiter: currentPasswordLimiter,
      compare: bcrypt.compare,
    });
    if (check === "missing") return NextResponse.json({ error: "Enter your current password to change this.", stepUp: "missing" }, { status: 400 });
    if (check === "limited") return NextResponse.json({ error: "Too many attempts. Wait a minute and try again.", stepUp: "limited" }, { status: 429 });
    if (check === "wrong") return NextResponse.json({ error: "Current password is incorrect.", stepUp: "wrong" }, { status: 403 });
    // The check awaited bcrypt; another save may have landed meanwhile. Nothing above wrote, so refuse rather than
    // overwrite it with values built from the first read. No await from here to the write.
    let fresh: HermesSettingsFile | null;
    try {
      fresh = readHermesSettingsFileForSave();
    } catch {
      return NextResponse.json({ error: HERMES_SETTINGS_UNREADABLE }, { status: 500 });
    }
    if (!isDeepStrictEqual(fresh, raw)) {
      return NextResponse.json({ error: "Settings changed while the password was checked. Nothing was saved; try again." }, { status: 409 });
    }
  }

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
    console.error("settings/hermes-daemon save", e);
    return NextResponse.json(
      { error: "save failed" },
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
