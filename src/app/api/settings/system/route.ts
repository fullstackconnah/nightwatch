import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mergeOrchestraSettings } from "@/lib/orchestra-settings";
import { loadConfigForSave, saveConfig, syncHermesMcpToken, systemSetting, type AppConfig } from "@/lib/config";
import { httpUrlError, mcpTokenError } from "@/lib/settings-checks";
import { secretForUrl } from "@/lib/settings/dash-put";

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

  orchestraUrl?: unknown;
  orchestraToken?: unknown;
  clearOrchestraToken?: unknown;

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
    const parsed = await req.json();
    body = parsed;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // A patch route has no required field, so a null, array or string body gets its own 400.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  let current: AppConfig;
  try {
    current = loadConfigForSave();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const existing = current.system ?? {};

  // --- MCP token: manual set, explicit clear, or server-generated ---------
  const generated = body.generateMcpToken === true;
  const clearedMcpToken = body.clearMcpToken === true;
  const typedMcpToken = str(body.mcpToken);
  let mcpToken = existing.mcpToken;
  let mcpTokenJustSet = false;
  // Only a typed token that would actually be stored is length-checked.
  const shortToken = !generated && !clearedMcpToken ? mcpTokenError(typedMcpToken) : null;
  if (shortToken) return NextResponse.json({ error: shortToken }, { status: 400 });
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

  // --- URL fields: http(s) only, blank allowed ---------------------------------
  const badUrl =
    httpUrlError("hermesApiUrl", str(body.hermesApiUrl)) ??
    httpUrlError("voiceServerUrl", str(body.voiceServerUrl)) ??
    httpUrlError("voiceTtsUrl", str(body.voiceTtsUrl)) ??
    httpUrlError("oidcIssuer", str(body.oidcIssuer));
  if (badUrl) return NextResponse.json({ error: badUrl }, { status: 400 });

  // --- Hermes API -------------------------------------------------------------
  const hermesApiUrl = "hermesApiUrl" in body ? (str(body.hermesApiUrl) ?? existing.hermesApiUrl) : existing.hermesApiUrl;
  const hermesApiToken = body.clearHermesApiToken === true
    ? undefined
    : mergedSecret(str(body.hermesApiToken), secretForUrl(existing.hermesApiToken, existing.hermesApiUrl, hermesApiUrl));

  // --- Orchestra ----------------------------------------------------------
  const orchestra = mergeOrchestraSettings(body, existing);
  if ("error" in orchestra) return NextResponse.json({ error: orchestra.error }, { status: 400 });

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
    : mergedSecret(str(body.oidcClientSecret), secretForUrl(existing.oidcClientSecret, existing.oidcIssuer, oidcIssuer));

  const now = new Date().toISOString();
  const next: AppConfig = {
    ...current,
    system: {
      ...existing, // a field this build doesn't know survives; the keys below override it, so a cleared (undefined) secret stays cleared
      mcpToken,
      kioskPin,
      hermesApiUrl,
      hermesApiToken,
      orchestraUrl: orchestra.orchestraUrl,
      orchestraToken: orchestra.orchestraToken,
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
  } catch (e) {
    console.error("settings/system save", e);
    return NextResponse.json(
      { error: "save failed" },
      { status: 500 },
    );
  }

  // CRITICAL SYNC RULE (GOAL B): a freshly set or regenerated MCP token
  // must land in hermes-settings.json's nightwatchMcpToken in the SAME
  // save, or hermes silently keeps calling back with a stale token.
  // Deliberately NOT mirrored on clear/keep-unchanged — only an actual new
  // value needs propagating. The token is already live once saveConfig
  // succeeded, so a sync failure is reported in the response, not as a 500.
  let hermesSyncFailed = false;
  if (mcpTokenJustSet && mcpToken) {
    try {
      syncHermesMcpToken(mcpToken);
    } catch (e) {
      console.error("settings/system hermes token sync", e);
      hermesSyncFailed = true;
    }
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
    hermesSyncFailed: hermesSyncFailed || undefined,
    system: {
      mcpTokenConfigured: Boolean(systemSetting("mcpToken", "MCP_TOKEN")),
      kioskPinConfigured: Boolean(systemSetting("kioskPin", "KIOSK_PIN")),
      hermesApiConfigured: Boolean(
        systemSetting("hermesApiUrl", "HERMES_API_URL") && systemSetting("hermesApiToken", "HERMES_API_TOKEN"),
      ),
      orchestraConfigured: Boolean(
        systemSetting("orchestraUrl", "ORCHESTRA_URL") && systemSetting("orchestraToken", "ORCHESTRA_TOKEN"),
      ),
      orchestraTokenSet: Boolean(systemSetting("orchestraToken", "ORCHESTRA_TOKEN")),
      oidcClientSecretConfigured: Boolean(systemSetting("oidcClientSecret", "OIDC_CLIENT_SECRET")),
    },
  });
}
