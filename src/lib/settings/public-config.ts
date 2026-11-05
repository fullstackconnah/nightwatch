import type { AppConfig } from "../config.ts";
import { publicSystem } from "../orchestra-settings.ts";
import { mediaPublic } from "./../media/settings.ts";
import { publicWidgets } from "./dash-put.ts";

/**
 * Strips every secret value (widget key/password included, O1) from a
 * config before it is allowed anywhere near a response body. `token`/`password`/
 * `*ApiKey` fields become `undefined`, which JSON.stringify simply omits — the
 * client-side AppConfig type is still satisfied (those fields are optional)
 * without ever seeing the real value.
 */
export function sanitizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    widgets: publicWidgets(config.widgets ?? []),
    homeassistant: config.homeassistant
      ? { url: config.homeassistant.url, updatedAt: config.homeassistant.updatedAt }
      : config.homeassistant,
    npm: config.npm
      ? { url: config.npm.url, email: config.npm.email, updatedAt: config.npm.updatedAt }
      : config.npm,
    // Only url + kioskUser: the API key is server-only (src/lib/jellyfin.ts reads it from the stored config).
    jellyfin: config.jellyfin ? { url: config.jellyfin.url, kioskUser: config.jellyfin.kioskUser } : config.jellyfin,
    forgejo: config.forgejo
      ? { url: config.forgejo.url, updatedAt: config.forgejo.updatedAt }
      : config.forgejo,
    github: config.github ? { updatedAt: config.github.updatedAt } : config.github,
    minecraft: config.minecraft
      ? {
          managerUrl: config.minecraft.managerUrl,
          rconHost: config.minecraft.rconHost,
          rconPort: config.minecraft.rconPort,
          updatedAt: config.minecraft.updatedAt,
        }
      : config.minecraft,
    media: mediaPublic(config.media),
    hermes: config.hermes ? { tier: config.hermes.tier, model: config.hermes.model } : config.hermes,
    // system: only the fields the settings page's System/Voice/SSO cards
    // render as plain editable text (URLs, model/voice names, the OIDC
    // issuer + client ID). mcpToken/kioskPin/hermesApiToken/oidcClientSecret/
    // adminPasswordHash never leave the server — same bar as every secret
    // above, applied field-by-field because system is one flat block rather
    // than one block per service.
    system: publicSystem(config.system),
  };
}
