"use client";

/* THESIS: "Access" answers one question — who and what can reach this box —
   by putting the login gate beside the four doors that were previously
   invisible from the UI (MCP, kiosk, SSO, Dockge). GOAL A turned three of
   those from read-only env status into config-editable cards: System
   (MCP token + kiosk PIN), Change password, and SSO — each POSTing to
   POST /api/settings/system (or /api/settings/password for the password
   card), which persists into config.json's `system` block and wins over the
   matching env var on the next request (systemSetting() in
   src/lib/config.ts). The original SystemAccessPanel stays as the honest
   "what's actually in effect right now" status board (config OR env, never
   which one), Dockge link included, since that answer doesn't change just
   because the value can now also live in config.json. OWN-WORLD: same Card
   grammar (title + note + badge), SecretField's write-only masked
   treatment, same Save placement as settings-integrations.tsx. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { postJson } from "@/lib/client";
import { CopyButton } from "@/components/settings-reference";
import { SecretField, useSettingsFull, type SettingsFullResponse } from "@/components/settings-integrations";

function AuthPanel({ data }: { data: SettingsFullResponse | undefined }) {
  const configured = data?.meta.authConfigured ?? false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Login password</CardTitle>
        {configured ? (
          <Badge variant="ok">password set</Badge>
        ) : (
          <Badge variant="bad">no password — login disabled outside dev</Badge>
        )}
      </CardHeader>
      <CardContent className="text-[0.7rem] text-ink-dim space-y-1.5">
        <p>
          Checked against a bcrypt hash — either set once via{" "}
          <span className="font-mono text-accent">npm run hash-password -- &apos;pass&apos;</span> and{" "}
          <span className="font-mono">ADMIN_PASSWORD_HASH</span> in the compose file, or rotated any time
          from the <span className="text-ink">Change password</span> card below. A config value set there
          wins on login; the environment hash stays as a fallback, so a bad config value can never lock
          you out as long as the env hash still verifies.
        </p>
        <p>The dashboard should also sit behind an NPM access list — two layers, always.</p>
      </CardContent>
    </Card>
  );
}

function ChangePasswordCard({ data }: { data: SettingsFullResponse | undefined }) {
  const configured = data?.meta.authConfigured ?? false;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = configured && current.length > 0 && next.length >= 8 && next === confirm && !saving;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/settings/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
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
        <CardTitle>Change password</CardTitle>
        {saved && <Badge variant="ok">saved</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {configured ? (
          <>
            <p className="text-[0.7rem] text-ink-dim">
              Requires the current password. The new one is bcrypt-hashed and stored in config.json —
              nothing here is ever echoed back.
            </p>
            <Field label="Current password" required>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="New password"
                required
                hint={!tooShort ? "at least 8 characters" : undefined}
                error={tooShort ? "New password needs at least 8 characters." : undefined}
              >
                <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="at least 8 characters" />
              </Field>
              <Field
                label="Confirm new password"
                required
                error={mismatch && !tooShort ? "Passwords don't match." : undefined}
              >
                <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
              {error && <span className="text-[0.7rem] text-bad">{error}</span>}
              <Button size="sm" disabled={!canSubmit} onClick={handleSave}>
                <Save size={13} /> Save
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[0.7rem] text-ink-dim">
            No admin password is configured yet — set <span className="font-mono">ADMIN_PASSWORD_HASH</span> in
            the environment first (<span className="font-mono text-accent">npm run hash-password</span>), then
            it can be rotated from here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** MCP token (with server-generated regenerate) + kiosk PIN — both
 *  write-only via SecretField, saved together through
 *  POST /api/settings/system. Regenerating the MCP token also re-syncs
 *  hermes-settings.json's nightwatchMcpToken server-side (GOAL B's sync
 *  rule) — nothing to do here beyond calling the same route. */
function SystemConfigCard({ data, mutate }: { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> }) {
  const mcpConfigured = data?.system.mcpTokenConfigured ?? false;
  const pinConfigured = data?.system.kioskPinConfigured ?? false;
  const mcpEndpoint = data?.meta.mcpEndpoint;
  const updatedAt = data?.system.updatedAt;

  const [mcpDraft, setMcpDraft] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [saveVersion, setSaveVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = (await postJson("/api/settings/system", { generateMcpToken: true })) as {
        generatedMcpToken?: string;
      };
      await mutate();
      setMcpDraft("");
      setSaveVersion((v) => v + 1);
      setRevealedToken(res.generatedMcpToken ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (mcpDraft.trim()) body.mcpToken = mcpDraft.trim();
      if (pinDraft.trim()) body.kioskPin = pinDraft.trim();
      await postJson("/api/settings/system", body);
      await mutate();
      setMcpDraft("");
      setPinDraft("");
      setRevealedToken(null);
      setSaveVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[0.7rem] text-ink-dim">
          A value saved here wins over its matching environment variable on the next request — no restart
          needed.
        </p>

        <div>
          <SecretField
            key={saveVersion}
            label="MCP token"
            action={
              <Button type="button" size="sm" variant="outline" disabled={generating} onClick={handleGenerate}>
                <RefreshCw size={12} className={generating ? "animate-spin motion-reduce:animate-none" : undefined} />
                Generate
              </Button>
            }
            configured={mcpConfigured}
            updatedAt={updatedAt}
            draft={mcpDraft}
            onDraftChange={setMcpDraft}
            placeholder="paste a token, or use Generate for a random 48-hex one"
          />
          {revealedToken && (
            <div className="mt-2 space-y-1">
              <p className="text-[0.7rem] text-warn/80">
                Shown once — copy it now. It won&apos;t be shown again after you leave this page.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[0.7rem] text-ink">
                  {revealedToken}
                </code>
                <CopyButton value={revealedToken} label="MCP token" />
              </div>
            </div>
          )}
          {mcpConfigured && mcpEndpoint && (
            <p className="mt-1.5 font-mono text-[0.65rem] text-ink-faint break-all">
              claude mcp add nightwatch --transport http {mcpEndpoint} -H &quot;Authorization: Bearer
              $MCP_TOKEN&quot;
            </p>
          )}
        </div>

        <SecretField
          key={`pin-${saveVersion}`}
          label="Kiosk PIN"
          configured={pinConfigured}
          updatedAt={updatedAt}
          draft={pinDraft}
          onDraftChange={setPinDraft}
          placeholder="4-8 digits"
          describedBy="kiosk-pin-hint"
        />
        <p id="kiosk-pin-hint" className="text-[0.7rem] text-ink-faint -mt-2">
          {pinConfigured ? "Clear it and save to fall back to the environment (or the default 0000)." : "Currently the default — 0000."}
        </p>

        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button size="sm" disabled={saving || (!mcpDraft.trim() && !pinDraft.trim())} onClick={handleSave}>
            <Save size={13} /> Save
          </Button>
        </div>

        <div className="pt-3 border-t border-line/50 space-y-1">
          <p className="text-[0.65rem] text-ink-faint">
            <span className="font-mono">NODE_EXTRA_CA_CERTS</span> and <span className="font-mono">SESSION_SECRET</span> stay
            environment-only — both are process-start values a live config write can&apos;t retroactively apply
            (the Node TLS trust store, and already-signed session tokens).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SsoCard({ data, mutate }: { data: SettingsFullResponse | undefined; mutate: () => Promise<unknown> }) {
  const secretConfigured = data?.system.oidcClientSecretConfigured ?? false;
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !seeded) {
      setIssuer(data.config.system?.oidcIssuer ?? "");
      setClientId(data.config.system?.oidcClientId ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { oidcIssuer: issuer, oidcClientId: clientId };
      if (clientSecret.trim()) body.oidcClientSecret = clientSecret.trim();
      await postJson("/api/settings/system", body);
      await mutate();
      setClientSecret("");
      setSaveVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SSO / OIDC</CardTitle>
        {data?.meta.ssoConfigured ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">
          Adds a &quot;Sign in with SSO&quot; option on the login page once all three are set. For a
          self-signed issuer, <span className="font-mono">NODE_EXTRA_CA_CERTS</span> must still be set in
          the environment — it&apos;s a process-start trust setting this page can&apos;t override.
        </p>
        <Field label="Issuer">
          <Input placeholder="http://192.168.1.70:9091" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </Field>
        <Field label="Client ID">
          <Input placeholder="nightwatch" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </Field>
        <SecretField
          key={saveVersion}
          label="Client secret"
          configured={secretConfigured}
          updatedAt={data?.system.updatedAt}
          draft={clientSecret}
          onDraftChange={setClientSecret}
        />
        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          {error && <span className="text-[0.7rem] text-bad">{error}</span>}
          <Button size="sm" disabled={saving} onClick={handleSave}>
            <Save size={13} /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SystemAccessPanel({ data }: { data: SettingsFullResponse | undefined }) {
  const meta = data?.meta;
  const mcpOn = meta?.mcpEnabled ?? false;
  const mcpEndpoint = meta?.mcpEndpoint;
  const customPin = meta?.kioskPinConfigured ?? false;
  const dockgeUrl = meta?.dockgeUrl;
  const hermesOn = meta?.hermesApiConfigured ?? false;
  const ssoOn = meta?.ssoConfigured ?? false;
  const ssoIssuerHost = meta?.ssoIssuerHost;

  return (
    <Card>
      <CardHeader>
        <CardTitle>System access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">
          What else can reach this box, quietly — checked here, in effect right now regardless of whether
          it came from the cards above or the environment.
        </p>

        {/* MCP server */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink">MCP server</span>
              {mcpOn ? <Badge variant="ok">enabled</Badge> : <Badge variant="neutral">disabled</Badge>}
            </div>
            {mcpOn ? (
              <p className="mt-1 font-mono text-[0.7rem] text-ink-dim break-all">{mcpEndpoint}</p>
            ) : (
              <p className="mt-1 text-[0.7rem] text-ink-dim">
                Set an MCP token on the System card above (or <span className="font-mono">MCP_TOKEN</span> in
                the environment) to enable <span className="font-mono">/api/mcp</span>.
              </p>
            )}
          </div>
          {mcpOn && mcpEndpoint && <CopyButton value={mcpEndpoint} label="MCP endpoint" />}
        </div>

        {/* Hermes API */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink">Hermes API</span>
              {hermesOn ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">disabled</Badge>}
            </div>
            <p className="mt-1 text-[0.7rem] text-ink-dim">
              {hermesOn
                ? "Ops daemon control wired up."
                : "Set the Hermes API URL and token in the Hermes section's Daemon card (or HERMES_API_URL / HERMES_API_TOKEN in the environment) to enable the /hermes control page."}
            </p>
          </div>
          <Link
            href="/hermes"
            className="shrink-0 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Open <ExternalLink size={12} />
          </Link>
        </div>

        {/* SSO / Authelia */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink">SSO / Authelia</span>
              {ssoOn ? <Badge variant="ok">configured</Badge> : <Badge variant="neutral">not configured</Badge>}
            </div>
            <p className="mt-1 text-[0.7rem] text-ink-dim">
              {ssoOn ? (
                <>
                  OIDC sign-in via <span className="font-mono text-ink-dim">{ssoIssuerHost}</span>.
                </>
              ) : (
                <>Fill in the SSO card above to add a &quot;Sign in with SSO&quot; option on the login page.</>
              )}
            </p>
          </div>
        </div>

        {/* Kiosk mode */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-line/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink">Kiosk mode</span>
              {customPin ? <Badge variant="ok">custom PIN</Badge> : <Badge variant="warn">default PIN</Badge>}
            </div>
            <p className="mt-1 text-[0.7rem] text-ink-dim">
              {customPin
                ? "Custom PIN set on the System card above."
                : "Using the fallback PIN (0000) — set one on the System card above to change it."}
            </p>
          </div>
          <Link
            href="/kiosk"
            className="shrink-0 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Open <ExternalLink size={12} />
          </Link>
        </div>

        {/* Dockge */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-xs font-medium text-ink">Stacks · Dockge</span>
            <p className="mt-1 text-[0.7rem] text-ink-dim">
              Manages the compose stacks this dashboard reads from — not this app&apos;s auth.
            </p>
          </div>
          {dockgeUrl && (
            <a
              href={dockgeUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Open <ExternalLink size={12} />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AccessSkeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {["Login password", "Change password", "System", "SSO / OIDC", "System access"].map((label, i) => (
        <div key={label} className="panel p-4 space-y-3">
          <div className="microlabel">{label}</div>
          <div
            className="h-8 rounded bg-panel-2 animate-pulse motion-reduce:animate-none"
            style={{ animationDelay: `${i * 90}ms` }}
          />
          <div
            className="h-8 rounded bg-panel-2 animate-pulse motion-reduce:animate-none w-2/3"
            style={{ animationDelay: `${i * 90 + 90}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

export function SettingsAccess() {
  const { data, error, mutate } = useSettingsFull();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="microlabel !text-accent">Access</h2>
        <p className="text-[0.7rem] text-ink-dim mt-0.5">
          What can reach this dashboard, and what it quietly leaves open.
        </p>
      </div>
      {error && <div className="panel p-4 text-xs text-bad">Could not load settings — {error.message}</div>}
      {!error && !data && <AccessSkeleton />}
      {data && (
        <div className="grid md:grid-cols-2 gap-3">
          <AuthPanel data={data} />
          <ChangePasswordCard data={data} />
          <SystemConfigCard data={data} mutate={mutate} />
          <SsoCard data={data} mutate={mutate} />
          <SystemAccessPanel data={data} />
        </div>
      )}
    </section>
  );
}
