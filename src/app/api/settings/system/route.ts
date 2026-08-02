import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig, syncHermesMcpToken, systemSetting, type AppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/**
 * Read-modify-write route for config.json's `system` block (GOAL A) — the
 * settings page's System, Voice and SSO cards all write here. Mirrors
 * src/app/api/settings/integrations/route.ts's shape: spreads the rest of
 * `current` through unchanged, only ever touches these named fields, and
 * follows the same secret idiom (an absent or empty secret field means "keep
 * the current value"; an explicit `clearX: true` flag is the only way to
 * actually remove one — see mergedSecret() there for the original pattern).
 * Non-secret fields (the URLs, model names, IDs) are always taken from the
 * body when the key is present, INCLUDING an explicit empty string — that's
 * this route's own "clear" gesture for a plain text field, and it works
 * because systemSetting() in src/lib/config.ts treats a stored empty string
 * exactly like an absent one and falls back to the env var.
 *
 * adminPasswordHash is NOT editable here — see POST /api/settings/password,
 * which is the only writer of that one field (current-password verification
 * makes it a fundamentally different, one-purpose flow).
 */

interface Body {
  mcpToken?: unknown;
  generateMcpToken?: unknown;
  clearMcpToken?: unknown;

  kioskPin?: unknown;
  clearKioskPin?: unknown;

  hermesApiUrl?: unknown;
  hermesApiToken?: unknown;
  clearHermesApiToken?: unknown;

  voiceServerUrl?: unknown;
  voiceTtsUrl?: unknown;
  voiceSttModel?: unknown;
  voiceTtsModel?: unknown;
  voiceTtsVoice?: unknown;

  oidcIssuer?: unknown;
  oidcClientId?: unknown;
  oidcClientSecret?: unknown;
  clearOidcClientSecret?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

/** `newValue` wins only if non-empty; otherwise the existing stored value
 *  survives — same idiom as integrations route's mergedSecret(). */
function mergedSecret(newValue: string | undefined, existing: string | undefined): string | undefined {
  return newValue ? newValue : existing;
}

const KIOSK_PIN_RE = /^\d{4,8}$/;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const current = loadConfig();
  const existing = current.system ?? {};

  // --- MCP token: manual set, explicit clear, or server-generated ---------
  const generated = body.generateMcpToken === true;
  const clearedMcpToken = body.clearMcpToken === true;
  const typedMcpToken = str(body.mcpToken);
  let mcpToken = existing.mcpToken;
  let mcpTokenJustSet = false;
  if (generated) {
    // 24 random bytes -> 48 hex characters, per the settings page's
    // "Generate" button contract.
    mcpToken = randomBytes(24).toString("hex");
    mcpTokenJustSet = true;
  } else if (clearedMcpToken) {
    mcpToken = undefined;
  } else if (typedMcpToken) {
    mcpToken = typedMcpToken;
    mcpTokenJustSet = true;
  }

  // --- kiosk PIN ------------------------------------------------------------
  const clearedKioskPin = body.clearKioskPin === true;
  const typedKioskPin = str(body.kioskPin);
  if (typedKioskPin && !KIOSK_PIN_RE.test(typedKioskPin)) {
    return NextResponse.json({ error: "Kiosk PIN must be 4-8 digits" }, { status: 400 });
  }
  const kioskPin = clearedKioskPin ? undefined : mergedSecret(typedKioskPin, existing.kioskPin);

  // --- Hermes API -------------------------------------------------------------
  const hermesApiUrl = "hermesApiUrl" in body ? (str(body.hermesApiUrl) ?? existing.hermesApiUrl) : existing.hermesApiUrl;
  const hermesApiToken = body.clearHermesApiToken === true
    ? undefined
    : mergedSecret(str(body.hermesApiToken), existing.hermesApiToken);

  // --- Voice --------------------------------------------------------------
  const voiceServerUrl = "voiceServerUrl" in body ? (str(body.voiceServerUrl) ?? existing.voiceServerUrl) : existing.voiceServerUrl;
  const voiceTtsUrl = "voiceTtsUrl" in body ? (str(body.voiceTtsUrl) ?? existing.voiceTtsUrl) : existing.voiceTtsUrl;
  const voiceSttModel = "voiceSttModel" in body ? (str(body.voiceSttModel) ?? existing.voiceSttModel) : existing.voiceSttModel;
  const voiceTtsModel = "voiceTtsModel" in body ? (str(body.voiceTtsModel) ?? existing.voiceTtsModel) : existing.voiceTtsModel;
  const voiceTtsVoice = "voiceTtsVoice" in body ? (str(body.voiceTtsVoice) ?? existing.voiceTtsVoice) : existing.voiceTtsVoice;

  // --- SSO / OIDC -------------------------------------------------------------
  const oidcIssuer = "oidcIssuer" in body ? (str(body.oidcIssuer) ?? existing.oidcIssuer) : existing.oidcIssuer;
  const oidcClientId = "oidcClientId" in body ? (str(body.oidcClientId) ?? existing.oidcClientId) : existing.oidcClientId;
  const oidcClientSecret = body.clearOidcClientSecret === true
    ? undefined
    : mergedSecret(str(body.oidcClientSecret), existing.oidcClientSecret);

  const now = new Date().toISOString();
  const next: AppConfig = {
    ...current,
    system: {
      mcpToken,
      kioskPin,
      hermesApiUrl,
      hermesApiToken,
      voiceServerUrl,
      voiceTtsUrl,
      voiceSttModel,
      voiceTtsModel,
      voiceTtsVoice,
      oidcIssuer,
      oidcClientId,
      oidcClientSecret,
      // adminPasswordHash is never touched by this route — carried through
      // untouched from whatever POST /api/settings/password last wrote.
      adminPasswordHash: existing.adminPasswordHash,
      updatedAt: now,
    },
  };

  try {
    saveConfig(next);
    // CRITICAL SYNC RULE (GOAL B): a freshly set or regenerated MCP token
    // must land in hermes-settings.json's nightwatchMcpToken in the SAME
    // save, or hermes silently keeps calling back with a stale token.
    // Deliberately NOT mirrored on clear/keep-unchanged — only an actual new
    // value needs propagating.
    if (mcpTokenJustSet && mcpToken) syncHermesMcpToken(mcpToken);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    updatedAt: now,
    // The one deliberate exception to "secrets never echoed": a
    // server-generated token has never been seen by the operator, so it is
    // returned once, here, so the settings page can show it for the
    // `claude mcp add` copy hint. A manually-typed token is never echoed —
    // the client already has it.
    generatedMcpToken: generated ? mcpToken : undefined,
    system: {
      mcpTokenConfigured: Boolean(systemSetting("mcpToken", "MCP_TOKEN")),
      kioskPinConfigured: Boolean(systemSetting("kioskPin", "KIOSK_PIN")),
      hermesApiConfigured: Boolean(
        systemSetting("hermesApiUrl", "HERMES_API_URL") && systemSetting("hermesApiToken", "HERMES_API_TOKEN"),
      ),
      oidcClientSecretConfigured: Boolean(systemSetting("oidcClientSecret", "OIDC_CLIENT_SECRET")),
    },
  });
}
