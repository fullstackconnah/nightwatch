import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig, readHermesModelFile, dockgeUrl, publicHost, type AppConfig } from "@/lib/config";
import { WIDGET_TYPE_NAMES } from "@/lib/widgets";

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

export async function GET() {
  const config = loadConfig();
  return NextResponse.json({
    config: sanitizeConfig(config),
    meta: {
      widgetTypes: WIDGET_TYPE_NAMES,
      publicHost: publicHost(),
      dockgeUrl: dockgeUrl(),
      authConfigured: Boolean(process.env.ADMIN_PASSWORD_HASH),
      dataDir: process.env.DATA_DIR || "./data",
      hermesModelUpdatedAt: readHermesModelFile()?.updatedAt ?? null,
    },
    integrations: integrationsMeta(config),
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
