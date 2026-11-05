import test from "node:test";
import assert from "node:assert/strict";
import { nextOpen } from "../strips.ts";
import type { SettingsFullResponse } from "../../components/settings/settings-integrations.tsx";
import { legacyStripHash, plainReason, settingsModel, type FormId, type ModelInput, type StripId } from "./page-model.ts";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const DAY = 86_400_000;
const iso = (ago: number) => new Date(NOW - ago).toISOString();

type Over = {
  auth?: boolean;
  set?: Partial<Record<"homeassistant" | "npm" | "forgejo" | "github" | "minecraft" | "media", boolean>>;
  voice?: boolean;
  hermes?: { tier?: "local" | "openrouter" | "anthropic"; model?: string };
  hermesKeys?: { openrouterConfigured: boolean; anthropicConfigured: boolean };
  updated?: Partial<Record<"homeassistant" | "npm" | "forgejo" | "github" | "minecraft" | "media", string>>;
  sys?: string;
  daemon?: Partial<SettingsFullResponse["hermesDaemon"]>;
  meta?: Partial<SettingsFullResponse["meta"]>;
  system?: Partial<SettingsFullResponse["system"]>;
  minecraft?: { curseforgeKeySet?: boolean };
  hermesModelUpdatedAt?: string | null;
  widgets?: number;
};
/** Seven of seven set up by default. */
function data(o: Over = {}): SettingsFullResponse {
  const on = (k: keyof NonNullable<Over["set"]>) => o.set?.[k] ?? true;
  const st = (k: keyof NonNullable<Over["set"]>) => ({ configured: on(k), updatedAt: o.updated?.[k] });
  return {
    config: { widgets: Array.from({ length: o.widgets ?? 2 }), hermes: o.hermes ?? { tier: "local", model: "qwen" } },
    meta: {
      authConfigured: o.auth ?? true, mcpEnabled: true, kioskPinConfigured: true, ssoConfigured: false,
      hermesModelUpdatedAt: o.hermesModelUpdatedAt ?? null, ...o.meta,
    },
    integrations: {
      homeassistant: st("homeassistant"), npm: st("npm"), forgejo: st("forgejo"), github: st("github"),
      minecraft: { ...st("minecraft"), curseforgeKeySet: true, ...o.minecraft },
      media: st("media"),
      hermes: o.hermesKeys ?? { openrouterConfigured: true, anthropicConfigured: true },
    },
    system: { voiceConfigured: o.voice ?? true, updatedAt: o.sys, mcpTokenConfigured: true, kioskPinConfigured: true, ...o.system },
    hermesDaemon: { discordAllowedUserIds: [], updatedAt: iso(30 * DAY), digestHour: 7, digestMinute: 5, ...o.daemon },
  } as unknown as SettingsFullResponse;
}
function input(o: Partial<ModelInput> & { d?: Over } = {}): ModelInput {
  const { d, ...rest } = o;
  return { data: data(d), loadError: null, loadedAt: NOW - 5000, forms: {}, tiles: { customized: 3, total: 12 }, now: NOW, ...rest };
}
const model = (o: Partial<ModelInput> & { d?: Over } = {}) => settingsModel(input(o));
const strip = (m: ReturnType<typeof model>, id: StripId) => m.strips.find((s) => s.id === id)!;
const NINE: StripId[] = ["access", "homeassistant", "npm", "forgejo", "github", "minecraft", "media", "voice", "hermes", "dashboard"];
const CALM_EVIDENCE = "Saved on the server in config.json, never in git.";

// ---- C8: one case per section 5 row ----

test("loading: neutral, no strips, nothing writable, nothing opens", () => {
  const m = model({ data: undefined, loadedAt: null });
  assert.deepEqual(m.chip, { tone: "neutral", label: "Loading" });
  assert.equal(m.answer, "Loading settings…");
  assert.equal(m.evidence, "First load usually takes a second.");
  assert.deepEqual(m.strips, []);
  assert.equal(m.writable, false);
  assert.equal(m.autoTarget, "keep");
});

test("load error before any data: warn, its own copy, no strips, no writes", () => {
  const m = model({ data: undefined, loadError: "Unauthorized", loadedAt: null });
  assert.deepEqual(m.chip, { tone: "warn", label: "Not loaded" });
  assert.equal(m.answer, "Settings couldn’t load: Unauthorized. Nothing here can change until they do.");
  assert.equal(m.notice, "Trying again on its own.");
  assert.deepEqual(m.strips, []);
  assert.equal(m.writable, false);
  assert.equal(m.autoTarget, "keep");
});

test("refresh failed: the data's own chip and answer, a notice with the age, writes stay on, keep", () => {
  const m = model({ loadError: "boom", loadedAt: NOW - 90_000 });
  assert.deepEqual(m.chip, { tone: "ok", label: "Ready" });
  assert.match(m.answer, /^All 7 integrations are set up/);
  assert.equal(m.notice, "Couldn’t refresh: showing what loaded 2 min ago.");
  assert.equal(m.writable, true);
  assert.equal(m.autoTarget, "keep");
  assert.equal(m.strips.length, 10);
});

test("save failed: warn, names the form, keeps the changes, opens that form's strip", () => {
  const m = model({ forms: { minecraft: { dirty: true, error: "Manager URL is not valid" } } });
  assert.deepEqual(m.chip, { tone: "warn", label: "Not saved" });
  assert.equal(m.answer, "Couldn’t save Minecraft: Manager URL is not valid. Your changes are kept, so you can try again.");
  assert.equal(m.autoTarget, "minecraft");
  assert.equal(m.evidence, CALM_EVIDENCE);
  assert.equal(m.writable, true);
  assert.equal(m.detailLead, m.answer);
});

test("save failed beats no password, Hermes key and unsaved", () => {
  const m = model({ d: { auth: false, hermes: { tier: "openrouter" }, hermesKeys: { openrouterConfigured: false, anthropicConfigured: false } }, forms: { voice: { dirty: true, error: "nope" }, npm: { dirty: true, error: null } } });
  assert.equal(m.chip.label, "Not saved");
  assert.equal(m.autoTarget, "voice");
});

test("no login password: bad chip, opens Access", () => {
  const m = model({ d: { auth: false } });
  assert.deepEqual(m.chip, { tone: "bad", label: "Sign-in off" });
  assert.equal(m.answer, "No login password is set, so sign-in is off outside dev. Set one in Access.");
  assert.equal(m.autoTarget, "access");
  assert.deepEqual([strip(m, "access").tone, strip(m, "access").state], ["bad", "No password: sign-in is off"]);
});

test("Hermes key missing: OpenRouter and Anthropic, warn, opens Hermes", () => {
  const or = model({ d: { hermes: { tier: "openrouter", model: "m" }, hermesKeys: { openrouterConfigured: false, anthropicConfigured: true } } });
  assert.deepEqual(or.chip, { tone: "warn", label: "Needs a key" });
  assert.equal(or.answer, "Hermes is set to OpenRouter but no OpenRouter key is saved. Add it in Hermes.");
  assert.equal(or.autoTarget, "hermes");
  assert.equal(strip(or, "hermes").tone, "warn");
  assert.equal(strip(or, "hermes").state, "OpenRouter · no key saved");
  const an = model({ d: { hermes: { tier: "anthropic" }, hermesKeys: { openrouterConfigured: true, anthropicConfigured: false } } });
  assert.equal(an.answer, "Hermes is set to Anthropic but no Anthropic key is saved. Add it in Hermes.");
  // a key that is saved, or the local tier, is no problem
  assert.equal(model({ d: { hermes: { tier: "anthropic" } } }).chip.label, "Ready");
  assert.equal(model({ d: { hermes: { tier: "local" }, hermesKeys: { openrouterConfigured: false, anthropicConfigured: false } } }).chip.label, "Ready");
});

test("no password beats the Hermes key and unsaved", () => {
  const m = model({ d: { auth: false, hermes: { tier: "anthropic" }, hermesKeys: { openrouterConfigured: true, anthropicConfigured: false } }, forms: { npm: { dirty: true, error: null } } });
  assert.equal(m.chip.label, "Sign-in off");
});

test("Hermes key beats unsaved", () => {
  const m = model({ d: { hermes: { tier: "anthropic" }, hermesKeys: { openrouterConfigured: true, anthropicConfigured: false } }, forms: { npm: { dirty: true, error: null } } });
  assert.equal(m.chip.label, "Needs a key");
});

test("unsaved: neutral, names the strips, never moves anything", () => {
  const one = model({ forms: { minecraft: { dirty: true, error: null } } });
  assert.deepEqual(one.chip, { tone: "neutral", label: "Unsaved" });
  assert.equal(one.answer, "Unsaved changes in Minecraft. They stay while this page is open.");
  assert.equal(one.autoTarget, "keep");
  assert.equal(one.detailLead, null);
  const three = model({ forms: { voice: { dirty: true, error: null }, password: { dirty: true, error: null }, "hermes-model": { dirty: true, error: null } } });
  assert.equal(three.answer, "Unsaved changes in Access, and 2 more. They stay while this page is open.");
  // two forms in one strip count once
  const same = model({ forms: { password: { dirty: true, error: null }, sso: { dirty: true, error: null } } });
  assert.equal(same.answer, "Unsaved changes in Access. They stay while this page is open.");
});

test("calm: all 7 set up, ok chip, last change, calm evidence, opens nothing", () => {
  const m = model({ d: { updated: { forgejo: iso(2 * DAY), github: iso(5 * DAY) } } });
  assert.deepEqual(m.chip, { tone: "ok", label: "Ready" });
  assert.equal(m.answer, "All 7 integrations are set up. Last change: Forgejo, 2 d ago.");
  assert.equal(m.evidence, CALM_EVIDENCE);
  assert.equal(m.notice, null);
  assert.equal(m.autoTarget, null);
  assert.equal(m.detailLead, null);
  assert.equal(m.writable, true);
});

test("partial: n of 7, ok chip", () => {
  const m = model({ d: { set: { npm: false, github: false }, voice: false } });
  assert.deepEqual(m.chip, { tone: "ok", label: "Ready" });
  assert.match(m.answer, /^4 of 7 integrations are set up\. Last change:/);
  assert.equal(m.autoTarget, null);
});

test("none set up: neutral, each strip says what it needs, nothing required is named", () => {
  const m = model({ d: { set: { homeassistant: false, npm: false, forgejo: false, github: false, minecraft: false, media: false }, voice: false } });
  assert.deepEqual(m.chip, { tone: "neutral", label: "Not set up" });
  assert.equal(m.answer, "No integrations are set up yet. Each one below says what it needs.");
  assert.equal(m.autoTarget, null);
  assert.equal(m.evidence, CALM_EVIDENCE);
});

test("optional things are never problems: no SSO, PIN, Orchestra or daemon is still calm", () => {
  const m = model({ d: { meta: { ssoConfigured: false, kioskPinConfigured: false }, daemon: { updatedAt: null } } });
  assert.equal(m.chip.tone, "ok");
  assert.deepEqual(m.strips.map((s) => s.tone), [null, null, null, null, null, null, null, null, null, null]);
});

// ---- order, last change, strip lines ----

test("the ten strips come in a fixed order with titles", () => {
  const m = model();
  assert.deepEqual(m.strips.map((s) => s.id), NINE);
  assert.deepEqual(m.strips.map((s) => s.title), ["Access", "Home Assistant", "NPM", "Forgejo", "GitHub", "Minecraft", "Media", "Voice", "Hermes", "Dashboard"]);
  // priority states never reorder them (D3)
  assert.deepEqual(model({ d: { auth: false } }).strips.map((s) => s.id), NINE);
});

test("last change is the newest updatedAt, named by its source", () => {
  const ans = (d: Over) => model({ d }).answer;
  assert.match(ans({ sys: iso(3 * DAY), updated: { npm: iso(4 * DAY) } }), /Last change: System settings, 3 d ago\.$/);
  assert.match(ans({ hermesModelUpdatedAt: iso(2 * DAY), sys: iso(3 * DAY) }), /Last change: Hermes model, 2 d ago\.$/);
  assert.match(ans({ daemon: { updatedAt: iso(60_000) } }), /Last change: Hermes daemon, 1 min ago\.$/);
  assert.match(ans({ daemon: { updatedAt: null }, updated: { minecraft: iso(7_200_000) } }), /Last change: Minecraft, 2 h ago\.$/);
  assert.match(ans({ daemon: { updatedAt: null } }), /Nothing has been changed here yet\.$/);
});

test("integration strip lines: set up with age, set up, not set up; Minecraft notes a missing CurseForge key", () => {
  const m = model({ d: { updated: { homeassistant: iso(2 * DAY) }, set: { npm: false }, minecraft: { curseforgeKeySet: false } } });
  assert.equal(strip(m, "homeassistant").state, "Set up · changed 2 d ago");
  assert.equal(strip(m, "forgejo").state, "Set up");
  assert.equal(strip(m, "npm").state, "Not set up");
  assert.equal(strip(m, "minecraft").state, "Set up · no CurseForge key");
  assert.equal(strip(model({ d: { set: { minecraft: false }, minecraft: { curseforgeKeySet: false } } }), "minecraft").state, "Not set up");
  assert.equal(strip(model({ d: { voice: false } }), "voice").state, "Not set up");
  assert.equal(strip(m, "voice").state, "Set up");
});

test("Access line: password, MCP, kiosk PIN, SSO", () => {
  assert.equal(strip(model(), "access").state, "Password set · MCP on · kiosk PIN set · SSO off");
  const m = model({ d: { meta: { mcpEnabled: false, kioskPinConfigured: false, ssoConfigured: true } } });
  assert.equal(strip(m, "access").state, "Password set · MCP off · kiosk PIN not set · SSO on");
});

test("Hermes line: tier, model, digest, dry run, daemon not saved yet", () => {
  assert.equal(strip(model(), "hermes").state, "Local · qwen · digest 07:05");
  assert.equal(strip(model({ d: { daemon: { dryRun: true } } }), "hermes").state, "Local · qwen · digest 07:05 · dry run");
  assert.equal(strip(model({ d: { hermes: { tier: "anthropic", model: "" }, daemon: { updatedAt: null } } }), "hermes").state, "Anthropic · no model · daemon not saved yet");
});

test("Dashboard line: widgets and customised tiles, with or without containers", () => {
  assert.equal(strip(model(), "dashboard").state, "2 widgets · 3 of 12 tiles customised");
  assert.equal(strip(model({ d: { widgets: 1 } }), "dashboard").state, "1 widget · 3 of 12 tiles customised");
  assert.equal(strip(model({ tiles: null }), "dashboard").state, "2 widgets");
  assert.equal(strip(model({ tiles: { customized: 2, total: 0 } }), "dashboard").state, "2 widgets · 2 tiles customised");
});

test("a form's error beats its draft, which beats the base line", () => {
  const m = model({ forms: { homeassistant: { dirty: true, error: "Bad token" }, npm: { dirty: true, error: null } } });
  assert.deepEqual([strip(m, "homeassistant").tone, strip(m, "homeassistant").state], ["warn", "Couldn’t save: Bad token"]);
  assert.deepEqual([strip(m, "npm").tone, strip(m, "npm").state], [null, "Edited · not saved"]);
  assert.equal(strip(m, "forgejo").state, "Set up");
});

// ---- the save-failure reason is plain: no host, address or long detail (rule 4) ----

test("plainReason keeps a short message and hides anything holding a host", () => {
  const ip = ["10", "0", "0", "5"].join(".");
  assert.equal(plainReason("Manager URL is not valid."), "Manager URL is not valid");
  assert.equal(plainReason(`connect ECONNREFUSED ${ip}:8090`), "the server refused it");
  assert.equal(plainReason("fetch failed: http://homelab.local:3010/api"), "the server refused it");
  assert.equal(plainReason("x".repeat(120)), "the server refused it");
  assert.equal(plainReason(""), "the server refused it");
  const m = model({ forms: { npm: { dirty: true, error: `connect ECONNREFUSED ${ip}:81` } } });
  assert.ok(!m.answer.includes(ip));
  assert.ok(!strip(m, "npm").state.includes(ip));
});

// ---- C5: auto-open ----

test("auto-open per row: a strip id only for the rows that name one", () => {
  const rows: [string, ModelInput, StripId | null | "keep"][] = [
    ["loading", input({ data: undefined }), "keep"],
    ["calm", input(), null],
    ["none", input({ d: { set: { homeassistant: false, npm: false, forgejo: false, github: false, minecraft: false, media: false }, voice: false } }), null],
    ["no password", input({ d: { auth: false } }), "access"],
    ["hermes key", input({ d: { hermes: { tier: "anthropic" }, hermesKeys: { openrouterConfigured: true, anthropicConfigured: false } } }), "hermes"],
    ["unsaved", input({ forms: { github: { dirty: true, error: null } } }), "keep"],
    ["save failed", input({ forms: { "hermes-daemon": { dirty: true, error: "x" } } }), "hermes"],
  ];
  for (const [name, i, want] of rows) assert.equal(settingsModel(i).autoTarget, want, name);
  const forms: FormId[] = ["password", "system", "sso", "orchestra"];
  for (const f of forms) assert.equal(model({ forms: { [f]: { dirty: true, error: "x" } } }).autoTarget, "access", f);
  assert.equal(model({ forms: { widgets: { dirty: true, error: "x" } } }).autoTarget, "dashboard");
});

test("a strip the person opened is never closed or replaced by any state", () => {
  const states: ModelInput[] = [
    input({ d: { auth: false } }),
    input({ forms: { voice: { dirty: true, error: "x" } } }),
    input({ forms: { npm: { dirty: true, error: null } } }),
    input({ loadError: "x" }),
    input(),
  ];
  for (const i of states) {
    const s = { open: "minecraft", by: "person" as const };
    for (const wide of [true, false]) assert.deepEqual(nextOpen(s, settingsModel(i).autoTarget, wide), s);
  }
});

test("calm opens nothing at 390 and falls back to the first strip (Access) at 1440", () => {
  const t = model().autoTarget;
  assert.deepEqual(nextOpen({ open: null, by: null }, t, false), { open: null, by: null });
  assert.equal(nextOpen({ open: null, by: null }, t, true).by, "auto");
});

// ---- writes ----

test("writes are on in every loaded state and off while there is nothing loaded", () => {
  for (const i of [input(), input({ loadError: "x" }), input({ d: { auth: false } }), input({ forms: { npm: { dirty: true, error: "x" } } })]) {
    assert.equal(settingsModel(i).writable, true);
  }
  assert.equal(model({ data: undefined }).writable, false);
});

test("load error: the notice carries the retry line and the evidence adds no second one", () => {
  const m = model({ data: undefined, loadError: "Unauthorized", loadedAt: null });
  assert.equal(m.evidence, "");
});

test("N1: old anchors open the strips that now hold them", () => {
  assert.equal(legacyStripHash("#integrations"), "#homeassistant");
  assert.equal(legacyStripHash("#reference"), "#dashboard");
  assert.equal(legacyStripHash("#hermes"), "#hermes");
  assert.equal(legacyStripHash(""), "");
});
