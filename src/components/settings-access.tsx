"use client";

/* THESIS: "Access" answers one question — who and what can reach this box —
   by putting the login gate beside the three doors that were previously
   invisible from the UI (MCP, kiosk, Dockge). None of these four things
   share a data model, so this is presentation-only: it reads meta fields
   already on GET /api/settings (mcpEnabled/mcpEndpoint/kioskPinConfigured,
   additive per this feature's own scope) plus the pre-existing
   authConfigured/dockgeUrl. Nothing here writes anything — every value is
   either an env var set outside this app or a link to a page that owns its
   own state (kiosk's PIN pad, Dockge itself). OWN-WORLD: same Card grammar
   (title + note + badge) as every panel in settings-integrations.tsx. */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/settings-reference";
import { useSettingsFull, type SettingsFullResponse } from "@/components/settings-integrations";

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
          Uses <span className="font-mono">ADMIN_PASSWORD_HASH</span> (bcrypt) from the environment.
          Generate one with{" "}
          <span className="font-mono text-accent">npm run hash-password -- &apos;pass&apos;</span> and set
          it in the compose file — this page never holds or edits it.
        </p>
        <p>The dashboard should also sit behind an NPM access list — two layers, always.</p>
      </CardContent>
    </Card>
  );
}

/** Additive field GET /api/settings now returns on `meta` — kept local rather
 *  than editing settings-integrations.tsx's SettingsFullResponse, which is
 *  out of this feature's touch scope. Same "env var presence, never the
 *  value" idiom as mcpEnabled/kioskPinConfigured above it. */
type SettingsMetaWithHermes = SettingsFullResponse["meta"] & {
  hermesApiConfigured?: boolean;
  ssoConfigured?: boolean;
  ssoIssuerHost?: string | null;
};

function SystemAccessPanel({ data }: { data: SettingsFullResponse | undefined }) {
  const meta = data?.meta as SettingsMetaWithHermes | undefined;
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
          What else can reach this box, quietly — checked here, configured elsewhere.
        </p>

        {/* MCP server */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink">MCP server</span>
              {mcpOn ? <Badge variant="ok">enabled</Badge> : <Badge variant="neutral">disabled</Badge>}
            </div>
            {mcpOn ? (
              <>
                <p className="mt-1 font-mono text-[0.7rem] text-ink-dim break-all">{mcpEndpoint}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint break-all">
                  claude mcp add nightwatch --transport http {mcpEndpoint} -H &quot;Authorization: Bearer
                  $MCP_TOKEN&quot;
                </p>
              </>
            ) : (
              <p className="mt-1 text-[0.7rem] text-ink-dim">
                Set <span className="font-mono">MCP_TOKEN</span> in the server environment to enable{" "}
                <span className="font-mono">/api/mcp</span>.
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
                ? "Ops daemon control wired via HERMES_API_URL / HERMES_API_TOKEN."
                : "Set HERMES_API_URL and HERMES_API_TOKEN in the server environment to enable the /hermes control page."}
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
                <>
                  Set <span className="font-mono">OIDC_ISSUER</span>, <span className="font-mono">OIDC_CLIENT_ID</span> and{" "}
                  <span className="font-mono">OIDC_CLIENT_SECRET</span> to add a &quot;Sign in with SSO&quot; option on
                  the login page.
                </>
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
                ? "PIN set via KIOSK_PIN in the environment."
                : "Using the fallback PIN (0000) — set KIOSK_PIN to change it."}
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
      {["Login password", "System access"].map((label, i) => (
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
  const { data, error } = useSettingsFull();

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
          <SystemAccessPanel data={data} />
        </div>
      )}
    </section>
  );
}
