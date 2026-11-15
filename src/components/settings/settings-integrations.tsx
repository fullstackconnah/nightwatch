"use client";

/* THESIS: four parallel connection panels (Home Assistant / NPM / Forgejo /
   GitHub), each a write-only secret form — the server never echoes a stored
   token/password back, so every secret field renders masked-and-configured
   or empty-and-editable, never populated with the real value. Config-file
   semantics are read-modify-write through POST /api/settings/integrations,
   which spreads the rest of config.json untouched (see that route's own
   comment for why this isn't routed through the general settings PUT).
   Each panel is one strip's detail on the Strips pattern: the page owns the
   frame, the state line and the answer, so a panel is just its form. Each
   reports its draft and last error upward (useFormReport) so the head can
   say "Unsaved" or "Not saved". Clear is the pattern's one write idiom
   (WriteAction), never a browser confirm(). */

import { useEffect, useId, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Plus, Save, Trash2 } from "lucide-react";
import { WriteAction } from "@/components/strips/write-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { SegmentButton } from "@/components/ui/segment-button";
import { fetcher, postJson } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import { DAY_NAMES, MAX_BINS, MAX_NAME, binLine, checkBins, nextBinNight, nightLabel, type BinsConfig } from "@/lib/bin-night";
import { localDateString } from "@/lib/local-time";
import type { AppConfig } from "@/lib/config";
import { plainReason } from "@/lib/settings/page-model";
import { rconPortFieldError } from "@/lib/settings-field-checks";
import { useFormReport } from "@/components/settings/form-report";

// ---------------------------------------------------------------------------
// Wire type for GET /api/settings. Richer than src/lib/client.ts's own
// useSettings() generic (client.ts is out of constraints scope for this
// feature) — same "/api/settings" cache key though, so this hook and the
// settings page's existing useSettings() share one SWR entry and one
// revalidation.

export interface IntegrationStatus {
  configured: boolean;
  updatedAt?: string;
}

export interface SettingsFullResponse {
  config: AppConfig;
  /** Version tags the dashboard PUT sends back as baseVersion. */
  versions?: { tiles: string; widgets: string };
  meta: {
    widgetTypes: string[];
    publicHost: string;
    dockgeUrl: string;
    authConfigured: boolean;
    dataDir: string;
    hermesModelUpdatedAt: string | null;
    mcpEnabled: boolean;
    mcpEndpoint: string;
    kioskPinConfigured: boolean;
    hermesApiConfigured?: boolean;
    orchestraConfigured?: boolean;
    orchestraTokenSet?: boolean;
    outsideCheckConfigured?: boolean;
    ssoConfigured?: boolean;
    ssoIssuerHost?: string | null;
  };
  integrations: {
    homeassistant: IntegrationStatus;
    npm: IntegrationStatus;
    forgejo: IntegrationStatus;
    github: IntegrationStatus;
    minecraft: IntegrationStatus & { curseforgeKeySet?: boolean; rconPasswordSet?: boolean };
    media: IntegrationStatus;
    hermes: { openrouterConfigured: boolean; anthropicConfigured: boolean };
  };
  /** GOAL A: config.json's `system` block — MCP token, kiosk PIN, Hermes API,
   *  voice server, SSO. `configured` fields are systemSetting()-aware (true
   *  for either a config.json value or the matching env var). */
  system: {
    mcpTokenConfigured: boolean;
    kioskPinConfigured: boolean;
    hermesApiConfigured: boolean;
    voiceConfigured: boolean;
    oidcClientSecretConfigured: boolean;
    updatedAt?: string;
  };
  /** GOAL B: data/hermes/hermes-settings.json's read model for the Hermes ·
   *  Daemon card. Discord secrets reduced to booleans, everything else
   *  passed through as-is (none of it is sensitive). */
  hermesDaemon: {
    discordWebhookConfigured: boolean;
    discordBotTokenConfigured: boolean;
    discordChannelId?: string;
    discordAllowedUserIds: string[];
    dryRun?: boolean;
    digestHour?: number;
    digestMinute?: number;
    pipelineEnabled?: boolean;
    pipelineDailyBudgetUsd?: number;
    pipelineModel?: string;
    pipelineModelHard?: string;
    updatedAt: string | null;
  };
}

export function useSettingsFull(onLoaded?: (at: number) => void) {
  return useSWR<SettingsFullResponse>("/api/settings", fetcher, { onSuccess: () => onLoaded?.(Date.now()) });
}

// ---------------------------------------------------------------------------
// Shared bits: the masked secret field and the "Clear" write.

export function SecretField({
  label,
  configured,
  updatedAt,
  draft,
  onDraftChange,
  placeholder,
  disabled,
  action,
  describedBy,
}: {
  label: string;
  configured: boolean;
  updatedAt?: string;
  draft: string;
  onDraftChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Rendered inline with the label — the System card's "Generate" button
   *  for the MCP token uses this instead of stacking its own separate
   *  (unlabelled-target) row above the field. */
  action?: ReactNode;
  /** id of an external hint/error element (owned by the caller) to fold
   *  into this field's own aria-describedby. */
  describedBy?: string;
}) {
  const [replacing, setReplacing] = useState(!configured);
  // One id backs both states: the editable <input> gets it directly, and
  // the read-only masked view (a <div>, not a labelable element — `for`
  // can't target it) gets an aria-labelledby pointing at the label's own id
  // instead. Either way there is exactly one id in scope, generated here,
  // never hand-typed at a call site.
  const id = useId();
  const labelId = `${id}-label`;

  // Once the server reports this secret as configured (right after this
  // panel's own successful save, which is also when the caller clears its
  // draft), collapse back to the masked view. A failed save leaves
  // `configured` unchanged, so this never fires — and the typed draft
  // survives for another try.
  useEffect(() => {
    if (configured) setReplacing(false);
  }, [configured]);

  // Both `id` AND `htmlFor`, because this one label serves two different
  // renderings: `id` is what the masked read-only view points at with
  // aria-labelledby (a <div> can't be a label target), and `htmlFor` is what
  // names the editable <input> below. Carrying only `id` — as this did until
  // 2026-08-03 — left every unconfigured secret field (the editable state, the
  // one you're in while actually typing a key) with no accessible name at all.
  const labelRow = (label || action) && (
    <div className="flex items-center justify-between gap-2 mb-1">
      {label && (
        <Label id={labelId} htmlFor={id} className="mb-0">
          {label}
        </Label>
      )}
      {action}
    </div>
  );

  if (configured && !replacing) {
    return (
      <div>
        {labelRow}
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-labelledby={label ? labelId : undefined}
            className="h-11 md:h-8 flex-1 min-w-0 flex items-center rounded-md border border-line bg-bg px-2.5 font-mono text-sm md:text-xs text-ink-faint tracking-widest"
          >
            ••••••••••••
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setReplacing(true)}>
            Replace
          </Button>
        </div>
        {updatedAt && (
          <p className="mt-1 text-[0.7rem] text-ink-faint">
            configured · last saved {relativeTime(updatedAt)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {labelRow}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          className="flex-1"
          value={draft}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={placeholder ?? (configured ? "leave blank to keep the current value" : "not set")}
        />
        {configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setReplacing(false);
              onDraftChange("");
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** Clear: an outlined trigger, one plain question, then "Yes, clear". The request fires only on Yes (K10); `run`
 *  throws on failure so the frame shows it with Try again. */
export function ClearAction({ say, failure, run }: { say: string; failure: string; run: () => Promise<void> }) {
  return (
    <WriteAction
      label="Clear"
      icon={<Trash2 size={13} />}
      say={say}
      yes="Yes, clear"
      danger
      flight="Clearing…"
      failure={failure}
      run={run}
    />
  );
}
const clearSay = (x: string) => `Removes the saved ${x} connection. ${x} stops working until you enter its credentials again.`;

/** Posts one { [key]: patch | null } body to /api/settings/integrations and
 *  revalidates the shared /api/settings SWR cache on success. Local to each
 *  panel — nothing here is shared state, so four panels can save/clear
 *  independently without racing each other's in-flight request. */
function useIntegrationWrite(mutate: () => Promise<unknown>, reseed?: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Returns whether the save actually succeeded — callers use this to decide
   *  whether it's safe to clear a typed secret draft. Clearing unconditionally
   *  on click would wipe what the user typed the moment a save fails. */
  async function save(key: string, patch: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/settings/integrations", { [key]: patch });
      await mutate();
      reseed?.(); // the server trims and defaults values, so reload the fields from what it stored
      return true;
    } catch (e) {
      // fetch rejects with a TypeError when the server is unreachable; its own text ("Failed to fetch") says nothing to the owner
      setError(e instanceof TypeError ? "Couldn't reach the server. Nothing was saved." : e instanceof Error && e.message ? plainReason(e.message) : "Couldn't save — check the values and try again");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Throws on failure, so ClearAction's frame shows the reason; the caller
   *  then remounts its SecretField(s) so a stale masked view doesn't linger
   *  after the secret it was describing is gone. */
  async function clear(key: string): Promise<void> {
    try {
      await postJson("/api/settings/integrations", { [key]: null });
      await mutate();
      reseed?.();
    } catch (e) {
      throw new Error(e instanceof Error && e.message ? plainReason(e.message) : "no reason given");
    }
  }

  return { saving, error, save, clear };
}

// ---------------------------------------------------------------------------
// URL + single-secret panels: Home Assistant and Forgejo share this shape.

function UrlTokenPanel({
  title,
  integrationKey,
  urlPlaceholder,
  secretLabel,
  hint,
  data,
  mutate,
}: {
  title: string;
  integrationKey: "homeassistant" | "forgejo";
  urlPlaceholder: string;
  secretLabel: string;
  hint: ReactNode;
  data: SettingsFullResponse | undefined;
  mutate: () => Promise<unknown>;
}) {
  const status = data?.integrations[integrationKey];
  const configured = status?.configured ?? false;
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [seeded, setSeeded] = useState(false);
  // Bumped on every successful save, and passed as SecretField's `key` — that
  // forces a remount so a *replace* of an already-configured secret collapses
  // back to the masked view too, not just a first-time save (`configured`
  // flipping false->true only covers the latter).
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, save, clear } = useIntegrationWrite(mutate, () => setSeeded(false));

  useEffect(() => {
    if (data && !seeded) {
      setUrl(data.config[integrationKey]?.url ?? "");
      setSeeded(true);
    }
  }, [data, seeded, integrationKey]);
  useFormReport(integrationKey, { dirty: seeded && (url !== (data?.config[integrationKey]?.url ?? "") || token !== ""), error });

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">{hint}</p>
      <Field label="URL" required>
        <Input placeholder={urlPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <SecretField
        key={saveVersion}
        label={secretLabel}
        configured={configured}
        updatedAt={status?.updatedAt}
        draft={token}
        onDraftChange={setToken}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {configured ? (
          <ClearAction
            say={clearSay(title)}
            failure="Couldn’t remove the connection"
            run={async () => {
              await clear(integrationKey);
              setSaveVersion((v) => v + 1);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || !url.trim()}
            onClick={async () => {
              const ok = await save(integrationKey, { url, token: token || undefined });
              if (ok) {
                setToken("");
                setSaveVersion((v) => v + 1);
              }
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

type PanelProps = { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> };

export function HomeAssistantPanel({ data, mutate }: PanelProps) {
  return (
    <UrlTokenPanel
      title="Home Assistant"
      integrationKey="homeassistant"
      urlPlaceholder="http://homelab.local:8123"
      secretLabel="Long-lived access token"
      hint="Profile (bottom-left in HA) → Security → Long-Lived Access Tokens → Create Token."
      data={data}
      mutate={mutate}
    />
  );
}

export function ForgejoPanel({ data, mutate }: PanelProps) {
  return (
    <UrlTokenPanel
      title="Forgejo"
      integrationKey="forgejo"
      urlPlaceholder="http://homelab.local:3010"
      secretLabel="Access token"
      hint={
        <>
          Settings → Applications → Generate New Token, read scopes only.
          {data?.config.forgejo?.url && (
            <>
              {" "}
              <a
                href={`${data.config.forgejo.url.replace(/\/+$/, "")}/user/settings/applications`}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                open Forgejo&apos;s token page
              </a>
            </>
          )}
        </>
      }
      data={data}
      mutate={mutate}
    />
  );
}

// ---------------------------------------------------------------------------
// NPM: url + email (not secret) + password (secret).

export function NpmPanel({ data, mutate }: PanelProps) {
  const status = data?.integrations.npm;
  const configured = status?.configured ?? false;
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, save, clear } = useIntegrationWrite(mutate, () => setSeeded(false));

  useEffect(() => {
    if (data && !seeded) {
      setUrl(data.config.npm?.url ?? "");
      setEmail(data.config.npm?.email ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);
  useFormReport("npm", { dirty: seeded && (url !== (data?.config.npm?.url ?? "") || email !== (data?.config.npm?.email ?? "") || password !== ""), error });

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        The admin login itself — NPM only exposes its API to an authenticated admin, no separate token to mint.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="URL" required>
          <Input placeholder="http://homelab.local:81" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Admin email" required>
          <Input placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <SecretField
        key={saveVersion}
        label="Admin password"
        configured={configured}
        updatedAt={status?.updatedAt}
        draft={password}
        onDraftChange={setPassword}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {configured ? (
          <ClearAction
            say={clearSay("NPM")}
            failure="Couldn’t remove the connection"
            run={async () => {
              await clear("npm");
              setSaveVersion((v) => v + 1);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || !url.trim() || !email.trim()}
            onClick={async () => {
              const ok = await save("npm", { url, email, password: password || undefined });
              if (ok) {
                setPassword("");
                setSaveVersion((v) => v + 1);
              }
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub: a bare PAT, no URL/email of its own.

export function GithubPanel({ data, mutate }: PanelProps) {
  const status = data?.integrations.github;
  const configured = status?.configured ?? false;
  const [token, setToken] = useState("");
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, save, clear } = useIntegrationWrite(mutate);
  useFormReport("github", { dirty: token !== "", error });

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        Read-only PAT for the local→cloud mirror sync visualizer.{" "}
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          github.com/settings/tokens
        </a>{" "}
        — repo read scope covers it.
      </p>
      <SecretField
        key={saveVersion}
        label="Personal access token"
        configured={configured}
        updatedAt={status?.updatedAt}
        draft={token}
        onDraftChange={setToken}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {configured ? (
          <ClearAction
            say={clearSay("GitHub")}
            failure="Couldn’t remove the connection"
            run={async () => {
              await clear("github");
              setSaveVersion((v) => v + 1);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || (!configured && !token.trim())}
            onClick={async () => {
              const ok = await save("github", { token: token || undefined });
              if (ok) {
                setToken("");
                setSaveVersion((v) => v + 1);
              }
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minecraft: mc-manager API (URL + token) + RCON (host/port/password) +
// an optional CurseForge search key. Three secrets, mirroring NPM's
// url+non-secret+secret shape but with an extra host/port pair for RCON.

export function MinecraftPanel({ data, mutate }: PanelProps) {
  const status = data?.integrations.minecraft;
  const configured = status?.configured ?? false;
  const [managerUrl, setManagerUrl] = useState("");
  const [managerToken, setManagerToken] = useState("");
  const [curseforgeKey, setCurseforgeKey] = useState("");
  const [rconHost, setRconHost] = useState("");
  const [rconPort, setRconPort] = useState("");
  const [rconPassword, setRconPassword] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, save, clear } = useIntegrationWrite(mutate, () => setSeeded(false));

  useEffect(() => {
    if (data && !seeded) {
      setManagerUrl(data.config.minecraft?.managerUrl ?? "");
      setRconHost(data.config.minecraft?.rconHost ?? "");
      setRconPort(data.config.minecraft?.rconPort ? String(data.config.minecraft.rconPort) : "");
      setSeeded(true);
    }
  }, [data, seeded]);
  const mc = data?.config.minecraft;
  const portError = rconPortFieldError(rconPort);
  useFormReport("minecraft", {
    dirty:
      seeded &&
      (managerUrl !== (mc?.managerUrl ?? "") ||
        rconHost !== (mc?.rconHost ?? "") ||
        rconPort !== (mc?.rconPort ? String(mc.rconPort) : "") ||
        managerToken !== "" ||
        curseforgeKey !== "" ||
        rconPassword !== ""),
    error,
  });

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        mc-manager runs in the minecraft stack; token is <span className="font-mono">MANAGER_TOKEN</span> in its
        secrets.env. CurseForge key is optional — Modrinth search works without it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Manager URL" required>
          <Input
            placeholder="http://homelab.local:8090"
            value={managerUrl}
            onChange={(e) => setManagerUrl(e.target.value)}
          />
        </Field>
        <Field label="RCON host">
          <Input placeholder="homelab.local" value={rconHost} onChange={(e) => setRconHost(e.target.value)} />
        </Field>
        <Field label="RCON port" error={portError}>
          <Input placeholder="25575" value={rconPort} onChange={(e) => setRconPort(e.target.value)} />
        </Field>
      </div>
      <SecretField
        key={`manager-${saveVersion}`}
        label="Manager token"
        configured={configured}
        updatedAt={status?.updatedAt}
        draft={managerToken}
        onDraftChange={setManagerToken}
      />
      <SecretField
        key={`curseforge-${saveVersion}`}
        label="CurseForge API key"
        configured={Boolean(status?.curseforgeKeySet)}
        updatedAt={status?.updatedAt}
        draft={curseforgeKey}
        onDraftChange={setCurseforgeKey}
        placeholder="optional — leave blank to skip"
      />
      <SecretField
        key={`rcon-${saveVersion}`}
        label="RCON password"
        configured={Boolean(status?.rconPasswordSet)}
        updatedAt={status?.updatedAt}
        draft={rconPassword}
        onDraftChange={setRconPassword}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {configured ? (
          <ClearAction
            say={clearSay("Minecraft")}
            failure="Couldn’t remove the connection"
            run={async () => {
              await clear("minecraft");
              setSaveVersion((v) => v + 1);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || !managerUrl.trim()}
            onClick={async () => {
              if (portError) return;
              const ok = await save("minecraft", {
                managerUrl,
                rconHost,
                rconPort: Number(rconPort) || undefined,
                managerToken: managerToken || undefined,
                curseforgeKey: curseforgeKey || undefined,
                rconPassword: rconPassword || undefined,
              });
              if (ok) {
                setManagerToken("");
                setCurseforgeKey("");
                setRconPassword("");
                setSaveVersion((v) => v + 1);
              }
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media: the PC-side media worker (URL + bearer token). Server-side only; the
// token never comes back, so the field shows a configured state.

export function MediaPanel({ data, mutate }: PanelProps) {
  const status = data?.integrations.media;
  const configured = status?.configured ?? false;
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerToken, setWorkerToken] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, save, clear } = useIntegrationWrite(mutate, () => setSeeded(false));

  useEffect(() => {
    if (data && !seeded) {
      setWorkerUrl(data.config.media?.workerUrl ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);
  useFormReport("media", {
    dirty: seeded && (workerUrl !== (data?.config.media?.workerUrl ?? "") || workerToken !== ""),
    error,
  });

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        The media worker runs on the PC that holds the library. Its token is kept on the server and never shown here.
      </p>
      <Field label="Worker URL" required>
        <Input placeholder="http://worker.example.invalid:8091" value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)} />
      </Field>
      <SecretField
        key={`worker-${saveVersion}`}
        label="Worker token"
        configured={configured}
        updatedAt={status?.updatedAt}
        draft={workerToken}
        onDraftChange={setWorkerToken}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {configured ? (
          <ClearAction
            say={clearSay("Media")}
            failure="Couldn’t remove the connection"
            run={async () => {
              await clear("media");
              setSaveVersion((v) => v + 1);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || !workerUrl.trim()}
            onClick={async () => {
              const ok = await save("media", { workerUrl, workerToken: workerToken || undefined });
              if (ok) {
                setWorkerToken("");
                setSaveVersion((v) => v + 1);
              }
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice: server URL, TTS URL, STT/TTS model, voice — all non-secret text,
// per GOAL C. Persisted into config.json's system block via
// POST /api/settings/system, alongside MCP/kiosk/Hermes API/SSO. Honest
// configured/not hinting reuses the same isVoiceConfigured() boolean that
// backs GET /api/voice/status (surfaced here as data.system.voiceConfigured
// so this card doesn't need a second fetch for the same value).

export function VoiceCard({ data, mutate }: PanelProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [ttsUrl, setTtsUrl] = useState("");
  const [sttModel, setSttModel] = useState("");
  const [ttsModel, setTtsModel] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setServerUrl(data.config.system?.voiceServerUrl ?? "");
      setTtsUrl(data.config.system?.voiceTtsUrl ?? "");
      setSttModel(data.config.system?.voiceSttModel ?? "");
      setTtsModel(data.config.system?.voiceTtsModel ?? "");
      setTtsVoice(data.config.system?.voiceTtsVoice ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);
  const sys = data?.config.system;
  useFormReport("voice", {
    dirty:
      seeded &&
      (serverUrl !== (sys?.voiceServerUrl ?? "") ||
        ttsUrl !== (sys?.voiceTtsUrl ?? "") ||
        sttModel !== (sys?.voiceSttModel ?? "") ||
        ttsModel !== (sys?.voiceTtsModel ?? "") ||
        ttsVoice !== (sys?.voiceTtsVoice ?? "")),
    error,
  });

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/settings/system", {
        voiceServerUrl: serverUrl,
        voiceTtsUrl: ttsUrl,
        voiceSttModel: sttModel,
        voiceTtsModel: ttsModel,
        voiceTtsVoice: ttsVoice,
      });
      await mutate();
      setSeeded(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error && e.message ? plainReason(e.message) : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        STT/TTS speech server for the mic on the dashboard and the kiosk voice panel. Wins over{" "}
        <span className="font-mono">VOICE_SERVER_URL</span> and friends when set here.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Server URL">
          <Input placeholder="http://homelab.local:8970" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
        </Field>
        <Field label="TTS URL (optional — defaults to server URL)">
          <Input placeholder="http://homelab.local:8971" value={ttsUrl} onChange={(e) => setTtsUrl(e.target.value)} />
        </Field>
        <Field label="STT model">
          <Input placeholder="leave blank for the server's default" value={sttModel} onChange={(e) => setSttModel(e.target.value)} />
        </Field>
        <Field label="TTS model">
          <Input placeholder="leave blank for the server's default" value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} />
        </Field>
        <Field label="TTS voice">
          <Input placeholder="leave blank for the server's default" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
        {saved && <Badge variant="ok">saved</Badge>}
        {error && <span className="text-[0.7rem] text-bad">{error}</span>}
        <Button size="sm" disabled={saving} onClick={handleSave}>
          <Save size={13} /> Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bin night: the schedule behind the wall kiosk's "goes out tonight" line. Plain values, nothing secret, so no
// SecretField; the same checker the route runs (bin-night.ts) runs live here, so every refusal is worded once.
// A row is a draft until Save; a failed save keeps the draft (no reseed), a good one reloads it from what the server stored.

type BinRow = { id: number; name: string; weekday: number | null; every: 1 | 2; anchor: string; saved: boolean };
let binRowId = 0;
const blankBinRow = (over: Partial<BinRow> = {}): BinRow => ({ id: ++binRowId, name: "", weekday: null, every: 1, anchor: "", saved: false, ...over });
const seedBinRows = (bins: BinsConfig | undefined): BinRow[] => {
  // a hand-edited rule may lack the array or hold junk entries: show empty rows, never crash
  const saved = (Array.isArray(bins?.collections) ? bins.collections : []).filter((c) => c && typeof c === "object");
  return saved.length ? saved.map((c) => blankBinRow({ ...c, anchor: c.anchor ?? "", saved: true })) : [blankBinRow()];
};
/** The untouched first row of an empty card: nothing to check, nothing to save, nothing to nag about. */
const binRowIdle = (r: BinRow) => !r.saved && !r.name.trim() && r.weekday === null && r.every === 1 && !r.anchor;
const binRowsKey = (rows: BinRow[]) => JSON.stringify(rows.map((r) => [r.name, r.weekday, r.every, r.every === 2 ? r.anchor : ""]));
// Monday first, as a wall calendar reads; the index is the stored weekday (0 = Sunday).
const BIN_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type BinRowErrors = Partial<Record<"name" | "weekday" | "every" | "anchor", string>>;

function BinRowEditor({
  row, errors, removable, onChange, onRemove,
}: {
  row: BinRow;
  errors: BinRowErrors;
  removable: boolean;
  onChange: (patch: Partial<BinRow>) => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const dayLabel = `${uid}-day`;
  const dayNote = `${uid}-day-note`;
  const everyLabel = `${uid}-every`;
  return (
    <div className="grid grid-cols-1 gap-3">
      <Field label="Bin" required error={errors.name}>
        <Input placeholder="Recycling" maxLength={MAX_NAME} value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <div>
        <Label id={dayLabel}>
          Collection day<span className="text-ink-dim"> *</span>
        </Label>
        <div role="group" aria-labelledby={dayLabel} aria-describedby={dayNote} className="flex gap-0.5">
          {BIN_DAY_ORDER.map((d) => (
            <SegmentButton key={d} fill active={row.weekday === d} label={DAY_NAMES[d]} onClick={() => onChange({ weekday: d })}>
              {DAY_NAMES[d].slice(0, 3)}
            </SegmentButton>
          ))}
        </div>
        <p id={dayNote} className={errors.weekday ? "mt-1 text-[0.7rem] text-warn/80" : "mt-1 text-[0.7rem] text-ink-dim"}>
          {errors.weekday ?? "The day the truck comes."}
        </p>
      </div>
      <div>
        <Label id={everyLabel}>Repeats</Label>
        <div role="group" aria-labelledby={everyLabel} className="flex gap-1">
          <SegmentButton fill active={row.every === 1} onClick={() => onChange({ every: 1 })}>Every week</SegmentButton>
          <SegmentButton fill active={row.every === 2} onClick={() => onChange({ every: 2 })}>Every second week</SegmentButton>
        </div>
      </div>
      {row.every === 2 && (
        <Field
          label="A collection date"
          required
          error={errors.anchor}
          hint="Any past or coming date this bin is collected. It sets which week."
        >
          <Input type="date" min="2000-01-01" max="2099-12-31" value={row.anchor} onChange={(e) => onChange({ anchor: e.target.value })} />
        </Field>
      )}
      {removable && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" aria-label={`Remove ${row.name.trim() || "this bin"}`} onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

export function BinNightCard({ data, mutate }: PanelProps) {
  const stored = data?.config.bins;
  const [rows, setRows] = useState<BinRow[]>(() => seedBinRows(undefined));
  const [seeded, setSeeded] = useState(false);
  const { saving, error, save, clear } = useIntegrationWrite(mutate, () => setSeeded(false));

  useEffect(() => {
    if (data && !seeded) {
      setRows(seedBinRows(data.config.bins));
      setSeeded(true);
    }
  }, [data, seeded]);
  useFormReport("bins", { dirty: seeded && binRowsKey(rows) !== binRowsKey(seedBinRows(stored)), error });

  const check = rows.length === 1 && binRowIdle(rows[0]) ? null : checkBins({ collections: rows.map(({ name, weekday, every, anchor }) => ({ name, weekday, every, anchor })) });
  const errors = check && !check.ok ? check.errors : [];
  const cardError = errors.find((e) => e.row === undefined)?.message;
  const patch = (id: number, p: Partial<BinRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  // The preview is the saved rule, never the draft: the exact sentence the wall would show, so a fallback is visible.
  const savedCheck = stored ? checkBins(stored) : null;
  const night = savedCheck?.ok ? nextBinNight(savedCheck.value, localDateString(data?.config.display?.timezone)) : null;
  const preview = !stored
    ? "Nothing saved yet. The wall shows no bin line."
    : night
      ? `Next on the wall: ${nightLabel(night.date)}, 5 pm to 10 pm. "${binLine(night.bins)}"`
      : "The saved schedule isn't valid, so the wall shows no bin line.";

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-ink-dim">
        The wall kiosk shows a line from 5 pm to 10 pm on the evening before a collection. Nothing shows on other days.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} className={i > 0 ? "border-t border-line pt-3" : undefined}>
          <BinRowEditor
            row={r}
            errors={Object.fromEntries(errors.filter((e) => e.row === i).map((e) => [e.field, e.message])) as BinRowErrors}
            removable={rows.length > 1}
            onChange={(p) => patch(r.id, p)}
            onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
          />
        </div>
      ))}
      {rows.length < MAX_BINS && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows((rs) => [...rs, blankBinRow({ weekday: rs[rs.length - 1].weekday, every: rs[rs.length - 1].every })])}
        >
          <Plus size={13} /> Add a bin
        </Button>
      )}
      {cardError && <p className="text-[0.7rem] text-warn/80">{cardError}</p>}
      {data && <p className="text-[0.7rem] text-ink-dim">{preview}</p>}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {stored ? (
          <ClearAction
            say="Removes the bin schedule. The wall stops showing bin night until you set it again."
            failure="Couldn't remove the bin schedule"
            run={() => clear("bins")}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button
            size="sm"
            disabled={saving || !check || !check.ok}
            onClick={() => {
              if (check && check.ok) void save("bins", check.value);
            }}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}
