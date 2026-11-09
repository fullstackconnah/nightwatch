import { NextRequest, NextResponse } from "next/server";
import {
  loadConfig,
  loadConfigForSave,
  saveConfig,
  saveErrorText,
  readHermesModelFile,
  readHermesSettingsFile,
  systemSetting,
  dockgeUrl,
  publicHost,
  type AppConfig,
} from "@/lib/config";
import { mergeDashPut } from "@/lib/settings/dash-put";
import { sanitizeConfig } from "@/lib/settings/public-config";
import { WIDGET_TYPE_NAMES } from "@/lib/widgets";
import { mcpEnabled } from "@/lib/mcp/auth";
import { mcSecretFlags } from "@/lib/mc-secret-flags";
import { oidcConfig, oidcIssuerHost } from "@/lib/oidc";
import { readCapped } from "@/lib/read-capped";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

interface IntegrationStatus {
  configured: boolean;
  updatedAt?: string;
}

const orchestraConfigured = () =>
  Boolean(systemSetting("orchestraUrl", "ORCHESTRA_URL") && systemSetting("orchestraToken", "ORCHESTRA_TOKEN"));

function integrationsMeta(config: AppConfig) {
  const status = (block: { updatedAt?: string } | undefined, secretPresent: boolean): IntegrationStatus => ({
    configured: secretPresent,
    updatedAt: block?.updatedAt,
  });
  return {
    homeassistant: status(config.homeassistant, Boolean(config.homeassistant?.token)),
    npm: status(config.npm, Boolean(config.npm?.password)),
    forgejo: status(config.forgejo, Boolean(config.forgejo?.token)),
    github: status(config.github, Boolean(config.github?.token)),
    minecraft: { ...status(config.minecraft, Boolean(config.minecraft?.managerToken)), ...mcSecretFlags(config.minecraft) },
    media: status(config.media, Boolean(config.media?.workerToken)),
    hermes: {
      openrouterConfigured: Boolean(config.hermes?.openrouterApiKey),
      anthropicConfigured: Boolean(config.hermes?.anthropicApiKey),
    },
  };
}

/** Configured-booleans for the settings page's System/Voice/SSO cards —
 *  systemSetting()-aware, so "configured" reflects config OR env, matching
 *  what the app will actually use on the next request (GOAL A precedence). */
function systemMeta(config: AppConfig) {
  return {
    mcpTokenConfigured: Boolean(systemSetting("mcpToken", "MCP_TOKEN")),
    kioskPinConfigured: Boolean(systemSetting("kioskPin", "KIOSK_PIN")),
    hermesApiConfigured: Boolean(
      systemSetting("hermesApiUrl", "HERMES_API_URL") && systemSetting("hermesApiToken", "HERMES_API_TOKEN"),
    ),
    voiceConfigured: Boolean(systemSetting("voiceServerUrl", "VOICE_SERVER_URL")),
    orchestraConfigured: orchestraConfigured(),
    orchestraTokenSet: Boolean(systemSetting("orchestraToken", "ORCHESTRA_TOKEN")),
    oidcClientSecretConfigured: Boolean(systemSetting("oidcClientSecret", "OIDC_CLIENT_SECRET")),
    updatedAt: config.system?.updatedAt,
  };
}

/** GOAL B read model for the Hermes · Daemon card — strips
 *  discordWebhookUrl/discordBotToken down to booleans (same secret bar as
 *  everything else here) and passes the rest of hermes-settings.json through
 *  as-is, since none of it is sensitive. A missing file (daemon never
 *  written one, or nightwatch never saved one yet) reads as "nothing
 *  configured" rather than an error. */
function hermesDaemonMeta() {
  const file = readHermesSettingsFile();
  return {
    discordWebhookConfigured: Boolean(file?.discordWebhookUrl),
    discordBotTokenConfigured: Boolean(file?.discordBotToken),
    discordChannelId: file?.discordChannelId,
    discordAllowedUserIds: file?.discordAllowedUserIds ?? [],
    dryRun: file?.dryRun,
    digestHour: file?.digestHour,
    digestMinute: file?.digestMinute,
    pipelineEnabled: file?.pipelineEnabled,
    pipelineDailyBudgetUsd: file?.pipelineDailyBudgetUsd,
    pipelineModel: file?.pipelineModel,
    pipelineModelHard: file?.pipelineModelHard,
    updatedAt: file?.updatedAt ?? null,
  };
}

export async function GET(req: NextRequest) {
  const config = loadConfig();
  return NextResponse.json({
    config: sanitizeConfig(config),
    meta: {
      widgetTypes: WIDGET_TYPE_NAMES,
      publicHost: publicHost(),
      dockgeUrl: dockgeUrl(),
      // Config-over-env, same as every field below: a password rotated on
      // the settings page (system.adminPasswordHash) counts the same as
      // ADMIN_PASSWORD_HASH.
      authConfigured: Boolean(process.env.ADMIN_PASSWORD_HASH || config.system?.adminPasswordHash),
      dataDir: process.env.DATA_DIR || "./data",
      hermesModelUpdatedAt: readHermesModelFile()?.updatedAt ?? null,
      // Surfaced on the Settings "System access" panel — never the token
      // itself, just whether the feature is on and where it lives, computed
      // from the request's own URL so it's correct on both :3005 and a test
      // stack's :3006 without a dedicated env var.
      mcpEnabled: mcpEnabled(),
      mcpEndpoint: `${req.nextUrl.origin}/api/mcp`,
      // Config-over-env via systemSetting() (GOAL A) — true whether the PIN
      // came from the settings page or KIOSK_PIN.
      kioskPinConfigured: Boolean(systemSetting("kioskPin", "KIOSK_PIN")),
      // Additive: whether the /hermes control page has anything to talk to.
      // Same "configured, never the value" idiom as mcpEnabled/kioskPinConfigured —
      // src/lib/hermes-ctl.ts is the only place the Hermes API token is ever read for real.
      hermesApiConfigured: Boolean(
        systemSetting("hermesApiUrl", "HERMES_API_URL") && systemSetting("hermesApiToken", "HERMES_API_TOKEN"),
      ),
      // Additive: whether OIDC SSO (Authelia) is wired up. Same "configured,
      // never the value" idiom — src/lib/oidc.ts is the only place the OIDC
      // client secret is ever read for real. Host only, never the full
      // issuer URL or the secret, mirrors mcpEndpoint's "safe to show" bar.
      orchestraConfigured: orchestraConfigured(),
      orchestraTokenSet: Boolean(systemSetting("orchestraToken", "ORCHESTRA_TOKEN")),
      ssoConfigured: oidcConfig() !== null,
      ssoIssuerHost: oidcIssuerHost(),
    },
    integrations: integrationsMeta(config),
    system: systemMeta(config),
    hermesDaemon: hermesDaemonMeta(),
  });
}

export async function PUT(req: NextRequest) {
  const tooBig = () => NextResponse.json({ error: "Settings are too large to save." }, { status: 413 });
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return tooBig();
  let body: unknown;
  try {
    // one byte past the cap, so a body over it is told apart from a truncated one
    const text = await readCapped(req, MAX_BODY_BYTES + 1);
    if (text === null || text.length > MAX_BODY_BYTES) return tooBig();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  let current: AppConfig;
  try {
    current = loadConfigForSave();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  try {
    // K12: read-modify-write. Each Dashboard save sends only its own fields ({ widgets } or { groups, urls, icons,
    // hidden }); mergeDashPut keeps everything else from the stored config (homeassistant/npm/forgejo/github/hermes/
    // jellyfin/...) and refuses an empty or wrongly shaped body with 400 before anything is written.
    const merged = mergeDashPut(current, body);
    if ("error" in merged) return NextResponse.json({ error: merged.error }, { status: 400 });
    saveConfig(merged.next);
    return NextResponse.json({ ok: true, config: sanitizeConfig(merged.next) });
  } catch (e) {
    console.error("settings save", e);
    return NextResponse.json(
      { error: saveErrorText(e) },
      { status: 500 },
    );
  }
}
