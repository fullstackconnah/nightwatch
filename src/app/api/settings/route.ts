import { NextRequest, NextResponse } from "next/server";
import {
  loadConfig,
  saveConfig,
  readHermesModelFile,
  readHermesSettingsFile,
  systemSetting,
  dockgeUrl,
  publicHost,
  type AppConfig,
} from "@/lib/config";
import { WIDGET_TYPE_NAMES } from "@/lib/widgets";
import { mcpEnabled } from "@/lib/mcp/auth";
import { oidcConfig, oidcIssuerHost } from "@/lib/oidc";

export const dynamic = "force-dynamic";

interface IntegrationStatus {
  configured: boolean;
  updatedAt?: string;
}

/**
 * Strips every secret value (widget-attached secrets excepted — those are
 * pre-existing behaviour for the widget editor and out of scope here) from a
 * config before it is allowed anywhere near a response body. `token`/`password`/
 * `*ApiKey` fields become `undefined`, which JSON.stringify simply omits — the
 * client-side AppConfig type is still satisfied (those fields are optional)
 * without ever seeing the real value.
 */
function sanitizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    homeassistant: config.homeassistant
      ? { url: config.homeassistant.url, updatedAt: config.homeassistant.updatedAt }
      : config.homeassistant,
    npm: config.npm
      ? { url: config.npm.url, email: config.npm.email, updatedAt: config.npm.updatedAt }
      : config.npm,
    forgejo: config.forgejo
      ? { url: config.forgejo.url, updatedAt: config.forgejo.updatedAt }
      : config.forgejo,
    github: config.github ? { updatedAt: config.github.updatedAt } : config.github,
    hermes: config.hermes ? { tier: config.hermes.tier, model: config.hermes.model } : config.hermes,
    // system: only the fields the settings page's System/Voice/SSO cards
    // render as plain editable text (URLs, model/voice names, the OIDC
    // issuer + client ID). mcpToken/kioskPin/hermesApiToken/oidcClientSecret/
    // adminPasswordHash never leave the server — same bar as every secret
    // above, applied field-by-field because system is one flat block rather
    // than one block per service.
    system: config.system
      ? {
          hermesApiUrl: config.system.hermesApiUrl,
          voiceServerUrl: config.system.voiceServerUrl,
          voiceTtsUrl: config.system.voiceTtsUrl,
          voiceSttModel: config.system.voiceSttModel,
          voiceTtsModel: config.system.voiceTtsModel,
          voiceTtsVoice: config.system.voiceTtsVoice,
          oidcIssuer: config.system.oidcIssuer,
          oidcClientId: config.system.oidcClientId,
          updatedAt: config.system.updatedAt,
        }
      : config.system,
  };
}

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
      ssoConfigured: oidcConfig() !== null,
      ssoIssuerHost: oidcIssuerHost(),
    },
    integrations: integrationsMeta(config),
    system: systemMeta(config),
    hermesDaemon: hermesDaemonMeta(),
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<AppConfig>;
    const current = loadConfig();
    // Read-modify-write: start from the full current config (including
    // homeassistant/npm/forgejo/github/hermes/jellyfin/pinnedFolders, none of
    // which this route's body ever carries) and only override the five fields
    // this form actually edits. A previous version built `next` from just
    // those five fields, which silently erased every other block on the next
    // tiles/widgets save — exactly the "clobber unrelated keys" bug the
    // Integrations/Hermes panels below now depend on not happening.
    const next: AppConfig = {
      ...current,
      groups: body.groups ?? current.groups,
      urls: body.urls ?? current.urls,
      icons: body.icons ?? current.icons,
      hidden: body.hidden ?? current.hidden,
      widgets: body.widgets ?? current.widgets,
    };
    saveConfig(next);
    return NextResponse.json({ ok: true, config: sanitizeConfig(next) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }
}
