/* /settings' whole story in one pure function: the head (chip, answer, evidence, notice), the nine strips in a fixed
 * order, which strip the answer names, and whether writes are on. It claims nothing about reachability: only
 * configured flags, updatedAt stamps and the forms' own reports (R1). Type-only imports so node:test can load it.
 * Section 5 of the settings shape brief is the spec; page-model.test.ts has a case per row. */
import { ageText } from "../home.ts";
import type { SettingsFullResponse } from "../../components/settings/settings-integrations.tsx";

export type StripId = "access" | "homeassistant" | "npm" | "forgejo" | "github" | "minecraft" | "voice" | "hermes" | "dashboard";
export type FormId =
  | "password" | "system" | "sso" | "orchestra"
  | "homeassistant" | "npm" | "forgejo" | "github" | "minecraft" | "voice"
  | "hermes-model" | "hermes-daemon" | "widgets" | "tiles";
export type Tone = "ok" | "neutral" | "warn" | "bad";

/** What a form reports upward (D5): an unsaved draft, and the last save's error. */
export interface FormState {
  dirty: boolean;
  error: string | null;
}
export interface ModelInput {
  data: SettingsFullResponse | undefined;
  /** The fetch is failing right now (SWR keeps the last good `data`): the message, or null. */
  loadError: string | null;
  /** ms of the last good load, null before the first. */
  loadedAt: number | null;
  forms: Partial<Record<FormId, FormState>>;
  /** Tiles customised out of all containers; null before the containers load. */
  tiles: { customized: number; total: number } | null;
  now: number;
}
export interface Strip {
  id: StripId;
  title: string;
  state: string;
  tone: "warn" | "bad" | null;
}
export interface Model {
  chip: { tone: Tone; label: string };
  answer: string;
  evidence: string;
  notice: string | null;
  strips: Strip[];
  /** The strip the answer names, null (none), or "keep" (loading, refresh failed, unsaved: leave things as they are). */
  autoTarget: StripId | null | "keep";
  /** The opened strip's detail starts with this, so a clamped answer is never lost (R5). */
  detailLead: string | null;
  /** Every save, clear and generate is on once settings have loaded; nothing here goes stale. */
  writable: boolean;
}

const TITLES: Record<StripId, string> = {
  access: "Access", homeassistant: "Home Assistant", npm: "NPM", forgejo: "Forgejo", github: "GitHub",
  minecraft: "Minecraft", voice: "Voice", hermes: "Hermes", dashboard: "Dashboard",
};
const ORDER = Object.keys(TITLES) as StripId[];
/** Each form's strip, in the order a save failure is looked for. */
const FORMS: Record<FormId, StripId> = {
  password: "access", system: "access", sso: "access", orchestra: "access",
  homeassistant: "homeassistant", npm: "npm", forgejo: "forgejo", github: "github", minecraft: "minecraft", voice: "voice",
  "hermes-model": "hermes", "hermes-daemon": "hermes", widgets: "dashboard", tiles: "dashboard",
};
const FORM_TITLE: Record<FormId, string> = {
  password: "the password", system: "System settings", sso: "SSO", orchestra: "Orchestra",
  homeassistant: "Home Assistant", npm: "NPM", forgejo: "Forgejo", github: "GitHub", minecraft: "Minecraft", voice: "Voice",
  "hermes-model": "the Hermes model", "hermes-daemon": "the Hermes daemon", widgets: "the widgets", tiles: "the tiles",
};
const FORM_IDS = Object.keys(FORMS) as FormId[];
const CALM_EVIDENCE = "Saved on the server in config.json, never in git.";
const TIER = { local: "Local", openrouter: "OpenRouter", anthropic: "Anthropic" } as const;

/** A save error as one plain phrase: a message holding an address, a URL, a host:port or a long detail is replaced (rule 4). */
export function plainReason(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const leaks = /:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b|\w:\d{2,5}\b|\.(local|lan|internal)\b/i;
  return !s || s.length > 80 || leaks.test(s) ? "the server refused it" : s;
}

const ago = (ms: number) => `${ageText(Math.max(0, ms))} ago`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function head(chip: Model["chip"], answer: string, evidence: string, extra: Partial<Model> = {}): Model {
  return { chip, answer, evidence, notice: null, strips: [], autoTarget: "keep", detailLead: null, writable: false, ...extra };
}

export function settingsModel(i: ModelInput): Model {
  const { data, now } = i;
  if (!data) {
    return i.loadError !== null
      ? head({ tone: "warn", label: "Not loaded" }, `Settings couldn’t load: ${plainReason(i.loadError)}. Nothing here can change until they do.`, "Check that the dashboard is running, then reload.", { notice: "Trying again on its own." })
      : head({ tone: "neutral", label: "Loading" }, "Loading settings…", "First load usually takes a second.");
  }

  // ---- facts ----
  const { integrations: ig, system, hermesDaemon: hd, meta } = data;
  const hermes = data.config.hermes;
  const setUp = [ig.homeassistant, ig.npm, ig.forgejo, ig.github, ig.minecraft].filter((x) => x.configured).length + (system.voiceConfigured ? 1 : 0);
  const stamps: [string, string | null | undefined][] = [
    ["Home Assistant", ig.homeassistant.updatedAt], ["NPM", ig.npm.updatedAt], ["Forgejo", ig.forgejo.updatedAt],
    ["GitHub", ig.github.updatedAt], ["Minecraft", ig.minecraft.updatedAt], ["System settings", system.updatedAt],
    ["Hermes model", meta.hermesModelUpdatedAt], ["Hermes daemon", hd.updatedAt],
  ];
  const newest = stamps
    .flatMap(([name, at]) => (at && !isNaN(Date.parse(at)) ? [{ name, ts: Date.parse(at) }] : []))
    .sort((a, b) => b.ts - a.ts)[0];
  const last = newest ? `Last change: ${newest.name}, ${ago(now - newest.ts)}.` : "Nothing has been changed here yet.";
  const keyMissing =
    (hermes?.tier === "openrouter" && !ig.hermes.openrouterConfigured) || (hermes?.tier === "anthropic" && !ig.hermes.anthropicConfigured)
      ? TIER[hermes.tier]
      : null;
  const failed = FORM_IDS.find((f) => i.forms[f]?.error);
  const draftStrips = ORDER.filter((s) => FORM_IDS.some((f) => FORMS[f] === s && i.forms[f]?.dirty));

  // ---- head: the highest row wins ----
  let chip: Model["chip"] = setUp === 0 ? { tone: "neutral", label: "Not set up" } : { tone: "ok", label: "Ready" };
  let answer =
    setUp === 0
      ? "No integrations are set up yet. Each one below says what it needs."
      : `${setUp === 6 ? "All 6" : `${setUp} of 6`} integrations are set up. ${last}`;
  let autoTarget: Model["autoTarget"] = null;
  if (draftStrips.length) {
    const more = draftStrips.length - 1;
    chip = { tone: "neutral", label: "Unsaved" };
    answer = `Unsaved changes in ${TITLES[draftStrips[0]]}${more ? `, and ${more} more` : ""}. They stay while this page is open.`;
    autoTarget = "keep";
  }
  if (keyMissing) {
    chip = { tone: "warn", label: "Needs a key" };
    answer = `Hermes is set to ${keyMissing} but no ${keyMissing} key is saved. Add it in Hermes.`;
    autoTarget = "hermes";
  }
  if (!meta.authConfigured) {
    chip = { tone: "bad", label: "Sign-in off" };
    answer = "No login password is set, so sign-in is off outside dev. Set one in Access.";
    autoTarget = "access";
  }
  if (failed) {
    chip = { tone: "warn", label: "Not saved" };
    answer = `Couldn’t save ${FORM_TITLE[failed]}: ${plainReason(i.forms[failed]!.error!)}. Your changes are kept, so you can try again.`;
    autoTarget = FORMS[failed];
  }
  const refreshFailed = i.loadError !== null;
  if (refreshFailed) autoTarget = "keep";

  // ---- strips ----
  const integration = (x: { configured: boolean; updatedAt?: string }, extra = "") =>
    x.configured ? `Set up${x.updatedAt && !isNaN(Date.parse(x.updatedAt)) ? ` · changed ${ago(now - Date.parse(x.updatedAt))}` : ""}${extra}` : "Not set up";
  const base: Record<StripId, Pick<Strip, "state" | "tone">> = {
    access: meta.authConfigured
      ? { state: `Password set · MCP ${meta.mcpEnabled ? "on" : "off"} · kiosk PIN ${meta.kioskPinConfigured ? "set" : "not set"} · SSO ${meta.ssoConfigured ? "on" : "off"}`, tone: null }
      : { state: "No password: sign-in is off", tone: "bad" },
    homeassistant: { state: integration(ig.homeassistant), tone: null },
    npm: { state: integration(ig.npm), tone: null },
    forgejo: { state: integration(ig.forgejo), tone: null },
    github: { state: integration(ig.github), tone: null },
    minecraft: { state: integration(ig.minecraft, ig.minecraft.curseforgeKeySet ? "" : " · no CurseForge key"), tone: null },
    voice: { state: system.voiceConfigured ? "Set up" : "Not set up", tone: null },
    hermes: keyMissing
      ? { state: `${keyMissing} · no key saved`, tone: "warn" }
      : {
          state: [
            `${TIER[hermes?.tier ?? "local"]} · ${hermes?.model || "no model"}`,
            hd.updatedAt === null || hd.digestHour == null ? "daemon not saved yet" : `digest ${String(hd.digestHour).padStart(2, "0")}:${String(hd.digestMinute ?? 0).padStart(2, "0")}`,
            ...(hd.dryRun ? ["dry run"] : []),
          ].join(" · "),
          tone: null,
        },
    dashboard: {
      state: [plural(data.config.widgets.length, "widget"), ...(i.tiles ? [i.tiles.total > 0 ? `${i.tiles.customized} of ${i.tiles.total} tiles customised` : `${i.tiles.customized} tiles customised`] : [])].join(" · "),
      tone: null,
    },
  };
  const strips = ORDER.map((id): Strip => {
    const err = FORM_IDS.find((f) => FORMS[f] === id && i.forms[f]?.error);
    if (err) return { id, title: TITLES[id], state: `Couldn’t save: ${plainReason(i.forms[err]!.error!)}`, tone: "warn" };
    if (draftStrips.includes(id)) return { id, title: TITLES[id], state: "Edited · not saved", tone: null };
    return { id, title: TITLES[id], ...base[id] };
  });

  return {
    chip,
    answer,
    evidence: CALM_EVIDENCE,
    notice: refreshFailed ? `Couldn’t refresh: showing what loaded ${i.loadedAt === null ? "earlier" : ago(now - i.loadedAt)}.` : null,
    strips,
    autoTarget,
    detailLead: typeof autoTarget === "string" && autoTarget !== "keep" ? answer : null,
    writable: true,
  };
}
