"use client";

/* THESIS: four parallel connection panels (Home Assistant / NPM / Forgejo /
   GitHub), each a write-only secret form — the server never echoes a stored
   token/password back, so every secret field renders masked-and-configured
   or empty-and-editable, never populated with the real value. Config-file
   semantics are read-modify-write through POST /api/settings/integrations,
   which spreads the rest of config.json untouched (see that route's own
   comment for why this isn't routed through the general settings PUT).
   OWN-WORLD: nightwatch console — .panel hairlines, mono secrets, microlabel
   captions, inline two-step confirm for the destructive "Clear" action
   (never a browser confirm()), same as reclaim-shared.tsx. */

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { fetcher, postJson } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import type { AppConfig } from "@/lib/config";

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
    ssoConfigured?: boolean;
    ssoIssuerHost?: string | null;
  };
  integrations: {
    homeassistant: IntegrationStatus;
    npm: IntegrationStatus;
    forgejo: IntegrationStatus;
    github: IntegrationStatus;
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

export function useSettingsFull() {
  return useSWR<SettingsFullResponse>("/api/settings", fetcher);
}

// ---------------------------------------------------------------------------
// Shared bits: the masked secret field and the inline two-step "Clear".

type ClearStep = "idle" | "confirm" | "busy";

export function SecretField({
  label,
  configured,
  updatedAt,
  draft,
  onDraftChange,
  placeholder,
  disabled,
}: {
  label: string;
  configured: boolean;
  updatedAt?: string;
  draft: string;
  onDraftChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [replacing, setReplacing] = useState(!configured);

  // Once the server reports this secret as configured (right after this
  // panel's own successful save, which is also when the caller clears its
  // draft), collapse back to the masked view. A failed save leaves
  // `configured` unchanged, so this never fires — and the typed draft
  // survives for another try.
  useEffect(() => {
    if (configured) setReplacing(false);
  }, [configured]);

  if (configured && !replacing) {
    return (
      <div>
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <div className="h-11 md:h-8 flex-1 min-w-0 flex items-center rounded-md border border-line bg-bg px-2.5 font-mono text-sm md:text-xs text-ink-faint tracking-widest">
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
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          className="flex-1"
          value={draft}
          disabled={disabled}
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

function ClearControl({
  step,
  setStep,
  onConfirm,
  label,
}: {
  step: ClearStep;
  setStep: (s: ClearStep) => void;
  onConfirm: () => void;
  label: string;
}) {
  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[0.7rem] text-ink-dim">Remove the {label} connection?</span>
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="ghost" disabled={step === "busy"} onClick={() => setStep("confirm")}>
      <Trash2 size={13} /> Clear
    </Button>
  );
}

/** Posts one { [key]: patch | null } body to /api/settings/integrations and
 *  revalidates the shared /api/settings SWR cache on success. Local to each
 *  panel — nothing here is shared state, so four panels can save/clear
 *  independently without racing each other's in-flight request. */
function useIntegrationWrite(mutate: () => Promise<unknown>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearStep, setClearStep] = useState<ClearStep>("idle");

  /** Returns whether the save actually succeeded — callers use this to decide
   *  whether it's safe to clear a typed secret draft. Clearing unconditionally
   *  on click would wipe what the user typed the moment a save fails. */
  async function save(key: string, patch: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/settings/integrations", { [key]: patch });
      await mutate();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Same success/failure contract as save() — a cleared block also flips
   *  `configured` back to false, and the caller uses the return value to
   *  decide whether to remount its SecretField(s) so a stale masked view
   *  doesn't linger after the secret it was describing is gone. */
  async function clear(key: string): Promise<boolean> {
    setClearStep("busy");
    setError(null);
    try {
      await postJson("/api/settings/integrations", { [key]: null });
      await mutate();
      setClearStep("idle");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "clear failed");
      setClearStep("idle");
      return false;
    }
  }

  return { saving, error, clearStep, setClearStep, save, clear };
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
  const { saving, error, clearStep, setClearStep, save, clear } = useIntegrationWrite(mutate);

  useEffect(() => {
    if (data && !seeded) {
      setUrl(data.config[integrationKey]?.url ?? "");
      setSeeded(true);
    }
  }, [data, seeded, integrationKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {configured ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">{hint}</p>
        <div>
          <Label>URL</Label>
          <Input placeholder={urlPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
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
            <ClearControl
              step={clearStep}
              setStep={setClearStep}
              label={title}
              onConfirm={async () => {
                const ok = await clear(integrationKey);
                if (ok) setSaveVersion((v) => v + 1);
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// NPM: url + email (not secret) + password (secret).

function NpmPanel({ data, mutate }: { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> }) {
  const status = data?.integrations.npm;
  const configured = status?.configured ?? false;
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, clearStep, setClearStep, save, clear } = useIntegrationWrite(mutate);

  useEffect(() => {
    if (data && !seeded) {
      setUrl(data.config.npm?.url ?? "");
      setEmail(data.config.npm?.email ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nginx Proxy Manager</CardTitle>
        {configured ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">
          The admin login itself — NPM only exposes its API to an authenticated admin, no separate token to mint.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>URL</Label>
            <Input placeholder="http://192.168.1.70:81" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <Label>Admin email</Label>
            <Input placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
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
            <ClearControl
              step={clearStep}
              setStep={setClearStep}
              label="NPM"
              onConfirm={async () => {
                const ok = await clear("npm");
                if (ok) setSaveVersion((v) => v + 1);
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// GitHub: a bare PAT, no URL/email of its own.

function GithubPanel({ data, mutate }: { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> }) {
  const status = data?.integrations.github;
  const configured = status?.configured ?? false;
  const [token, setToken] = useState("");
  const [saveVersion, setSaveVersion] = useState(0);
  const { saving, error, clearStep, setClearStep, save, clear } = useIntegrationWrite(mutate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub</CardTitle>
        {configured ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
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
            <ClearControl
              step={clearStep}
              setStep={setClearStep}
              label="GitHub"
              onConfirm={async () => {
                const ok = await clear("github");
                if (ok) setSaveVersion((v) => v + 1);
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Voice: server URL, TTS URL, STT/TTS model, voice — all non-secret text,
// per GOAL C. Persisted into config.json's system block via
// POST /api/settings/system, alongside MCP/kiosk/Hermes API/SSO. Honest
// configured/not hinting reuses the same isVoiceConfigured() boolean that
// backs GET /api/voice/status (surfaced here as data.system.voiceConfigured
// so this card doesn't need a second fetch for the same value).

function VoiceCard({ data, mutate }: { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> }) {
  const configured = data?.system.voiceConfigured ?? false;
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice</CardTitle>
        {configured ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">
          STT/TTS speech server for the mic on the dashboard and the kiosk voice panel. Wins over{" "}
          <span className="font-mono">VOICE_SERVER_URL</span> and friends when set here.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Server URL</Label>
            <Input placeholder="http://192.168.1.70:8970" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          </div>
          <div>
            <Label>TTS URL (optional — defaults to server URL)</Label>
            <Input placeholder="http://192.168.1.70:8971" value={ttsUrl} onChange={(e) => setTtsUrl(e.target.value)} />
          </div>
          <div>
            <Label>STT model</Label>
            <Input placeholder="leave blank for the server's default" value={sttModel} onChange={(e) => setSttModel(e.target.value)} />
          </div>
          <div>
            <Label>TTS model</Label>
            <Input placeholder="leave blank for the server's default" value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} />
          </div>
          <div>
            <Label>TTS voice</Label>
            <Input placeholder="leave blank for the server's default" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          {saved && <Badge variant="ok">saved</Badge>}
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button size="sm" disabled={saving} onClick={handleSave}>
            <Save size={13} /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function IntegrationsSkeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {["Home Assistant", "Nginx Proxy Manager", "Forgejo", "GitHub", "Voice"].map((label, i) => (
        <div key={label} className="panel p-4 space-y-3">
          <div className="microlabel">{label}</div>
          <div className="h-8 rounded bg-panel-2 animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${i * 90}ms` }} />
          <div className="h-8 rounded bg-panel-2 animate-pulse motion-reduce:animate-none w-2/3" style={{ animationDelay: `${i * 90 + 90}ms` }} />
        </div>
      ))}
    </div>
  );
}

export function SettingsIntegrations() {
  const { data, error, mutate } = useSettingsFull();

  return (
    <section className="space-y-3">
      <h2 className="microlabel !text-accent">Integrations</h2>
      {error && (
        <div className="panel p-4 text-xs text-bad">Could not load settings — {error.message}</div>
      )}
      {!error && !data && <IntegrationsSkeleton />}
      {data && (
        <div className="grid md:grid-cols-2 gap-3">
          <UrlTokenPanel
            title="Home Assistant"
            integrationKey="homeassistant"
            urlPlaceholder="http://192.168.1.70:8123"
            secretLabel="Long-lived access token"
            hint="Profile (bottom-left in HA) → Security → Long-Lived Access Tokens → Create Token."
            data={data}
            mutate={mutate}
          />
          <NpmPanel data={data} mutate={mutate} />
          <UrlTokenPanel
            title="Forgejo"
            integrationKey="forgejo"
            urlPlaceholder="http://192.168.1.70:3010"
            secretLabel="Access token"
            hint={
              <>
                Settings → Applications → Generate New Token, read scopes only.
                {data.config.forgejo?.url && (
                  <>
                    {" "}
                    <a
                      href={`${data.config.forgejo.url.replace(/\/+$/, "")}/user/settings/applications`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      open Forgejo's token page
                    </a>
                  </>
                )}
              </>
            }
            data={data}
            mutate={mutate}
          />
          <GithubPanel data={data} mutate={mutate} />
          <VoiceCard data={data} mutate={mutate} />
        </div>
      )}
    </section>
  );
}
