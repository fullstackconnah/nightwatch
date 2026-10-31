import type { SystemSettings } from "./config.ts";

type Orchestra = Pick<SystemSettings, "orchestraUrl" | "orchestraToken">;

/** Same idioms as the Hermes pair in POST /api/settings/system: a present url key wins (even ""), an empty token keeps the stored one. */
export function mergeOrchestraSettings(
  body: { orchestraUrl?: unknown; orchestraToken?: unknown; clearOrchestraToken?: unknown },
  existing: Orchestra,
): Orchestra | { error: string } {
  let orchestraUrl = existing.orchestraUrl;
  if ("orchestraUrl" in body && typeof body.orchestraUrl === "string") {
    const url = body.orchestraUrl.trim();
    if (url && !/^https?:$/.test(URL.canParse(url) ? new URL(url).protocol : "")) {
      return { error: "orchestraUrl must be an http(s) URL" };
    }
    orchestraUrl = url;
  }
  const typed = typeof body.orchestraToken === "string" ? body.orchestraToken.trim() : "";
  // An explicit clear wins over a typed token, like clearMcpToken.
  return { orchestraUrl, orchestraToken: body.clearOrchestraToken === true ? undefined : typed || existing.orchestraToken };
}

/** The `system` fields GET /api/settings may send to the browser: plain-text settings only, never a secret. */
export function publicSystem(system: SystemSettings | undefined): SystemSettings | undefined {
  return system
    ? {
        hermesApiUrl: system.hermesApiUrl,
        orchestraUrl: system.orchestraUrl,
        voiceServerUrl: system.voiceServerUrl,
        voiceTtsUrl: system.voiceTtsUrl,
        voiceSttModel: system.voiceSttModel,
        voiceTtsModel: system.voiceTtsModel,
        voiceTtsVoice: system.voiceTtsVoice,
        oidcIssuer: system.oidcIssuer,
        oidcClientId: system.oidcClientId,
        updatedAt: system.updatedAt,
      }
    : system;
}
