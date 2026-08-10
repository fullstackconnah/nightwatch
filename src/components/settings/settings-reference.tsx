"use client";

/* THESIS: two read-only reference panels documenting decisions made
   elsewhere (compose labels, socket-proxy env) so the owner never has to go
   spelunking in DEPLOY.md or a compose file to remember the shape of a
   label or which scopes are live. Static text, no fetch — this is memory,
   not configuration, and nothing here writes anywhere. Copy buttons only.
   OWN-WORLD: nightwatch console — mono facts, microlabel captions, the same
   panel grammar as every other Settings card. */

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permission denied or unavailable in this context —
          // the text is still there to select by hand, nothing to recover.
        }
      }}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="inline-flex items-center justify-center h-11 w-11 md:h-7 md:w-7 shrink-0 rounded-md text-ink-faint hover:text-ink hover:bg-panel-2 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
    >
      {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// dashboard.* label convention — see src/lib/labels.ts, the source of truth
// this panel transcribes from. Keep the two in sync by hand; it's ten lines.

const LABEL_LINES: { line: string; note: string }[] = [
  { line: "dashboard.enable=false", note: "hide this container's tile (default: shown)" },
  { line: "dashboard.url=http://…", note: "app URL opened by the tile's external link" },
  { line: "dashboard.icon=jellyfin", note: "selfh.st icon slug, or an absolute icon URL" },
  { line: "dashboard.group=Media", note: "overview section — overrides the compose project" },
  { line: "dashboard.widget.type=generic", note: "attach a widget — a builtin type, or generic" },
  { line: "dashboard.widget.endpoint=http://…/api/stats", note: "generic only — appended to url, or absolute" },
  { line: "dashboard.widget.path=Queries:queries.total,Hits:cache.hits", note: "generic only — comma-separated Label:json.path pairs" },
  { line: "dashboard.widget.key=<api key>", note: "widget auth, generic or builtin" },
  { line: "jellyfin.url=http://…", note: "GPU transcode telemetry — separate from widgets" },
  { line: "jellyfin.key=<api key>", note: "Dashboard → API Keys" },
];

function LabelConventionPanel() {
  const text = LABEL_LINES.map((l) => l.line).join("\n");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Label convention</CardTitle>
        <CopyButton value={text} label="label convention" />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[0.7rem] text-ink-dim">
          Docker labels on a container&apos;s compose service — the dashboard reads them on the next
          container poll, nothing here to restart.
        </p>
        <dl className="space-y-1.5">
          {LABEL_LINES.map((l) => (
            <div key={l.line}>
              <dt className="font-mono text-[0.7rem] text-ink-dim break-all">{l.line}</dt>
              <dd className="text-[0.65rem] text-ink-faint">{l.note}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// socket-proxy scopes — mirrors PRODUCT.md's "Operating Context" bullet and
// the actual proxy env in docker-compose.yml. A scope flipping to 1 is a
// deliberate, dated decision (SYSTEM=1 approved 2026-07-29 for volume
// sizes) — this panel exists so that history doesn't live only in a commit
// message.

const SCOPE_GROUPS: { label: string; value: "granted" | "denied"; text: string; note?: string }[] = [
  { label: "read", value: "granted", text: "CONTAINERS=1  IMAGES=1  INFO=1  NETWORKS=1  VOLUMES=1  PING=1" },
  { label: "read — volume sizes", value: "granted", text: "SYSTEM=1", note: "/system/df — approved 2026-07-29" },
  { label: "write — lifecycle", value: "granted", text: "POST=1  ALLOW_START=1  ALLOW_STOP=1  ALLOW_RESTARTS=1" },
  { label: "never granted", value: "denied", text: "EXEC=1  BUILD=1" },
];

function ScopesPanel() {
  const text = SCOPE_GROUPS.map((g) => `# ${g.label}\n${g.text}`).join("\n");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Socket-proxy scopes</CardTitle>
        <CopyButton value={text} label="socket-proxy scopes" />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.7rem] text-ink-dim">
          What this dashboard may ask the Docker socket proxy for. A new scope is a deliberate,
          user-approved decision — never a default flip.
        </p>
        <div className="space-y-2">
          {SCOPE_GROUPS.map((g) => (
            <div key={g.label}>
              <div className={cn("microlabel", g.value === "granted" ? "!text-ok" : "!text-bad")}>
                {g.label}
              </div>
              <div className={cn("font-mono text-[0.7rem] break-all", g.value === "granted" ? "text-ink-dim" : "text-bad")}>
                {g.text}
              </div>
              {g.note && <div className="text-[0.65rem] text-ink-faint mt-0.5">{g.note}</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function SettingsReference() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="microlabel !text-accent">Reference</h2>
        <p className="text-[0.7rem] text-ink-dim mt-0.5">
          Decided elsewhere, read here — edited in compose files and DEPLOY.md, never in this UI.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <LabelConventionPanel />
        <ScopesPanel />
      </div>
    </section>
  );
}
