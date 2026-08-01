/* The four non-happy /smarthome states, written as real copy per DESIGN.md's
   "Do" list — no lorem, no generic "something went wrong". Each one says
   exactly what is true and, where there's a fix, exactly what to do. */

import { cn } from "@/lib/utils";

const CONFIG_SNIPPET = `{
  "homeassistant": {
    "url": "http://192.168.1.70:8123",
    "token": "<the long-lived access token>"
  }
}`;

export function HaUnconfigured() {
  return (
    <div className="panel p-4">
      <div className="microlabel mb-2">not configured</div>
      <p className="max-w-prose text-xs text-ink-dim">
        Home Assistant isn&apos;t connected yet. In HA, open your profile (bottom-left of the
        sidebar) → <span className="text-ink">Security</span> →{" "}
        <span className="text-ink">Long-Lived Access Tokens</span> →{" "}
        <span className="text-ink">Create Token</span>. Then add this block to{" "}
        <span className="font-mono text-ink">data/config.json</span> on the server:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-panel-2 px-3 py-2.5 font-mono text-[0.7rem] text-ink-dim">
        {CONFIG_SNIPPET}
      </pre>
      <p className="mt-2 text-[0.7rem] text-ink-faint">
        The config file is reread on every request — no restart needed once it&apos;s saved.
      </p>
    </div>
  );
}

export function HaUnreachable({ detail }: { detail?: string }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="dot dot-dead" aria-hidden />
        <span className="microlabel !text-bad">unreachable</span>
      </div>
      <p className="text-xs text-ink-dim">{detail ?? "Home Assistant did not respond."}</p>
      <p className="mt-1 text-[0.7rem] text-ink-faint">
        Check that the Home Assistant container is running and that its URL in{" "}
        <span className="font-mono">data/config.json</span> is correct.
      </p>
    </div>
  );
}

export function HaUnauthorized({ detail }: { detail?: string }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="dot dot-unhealthy" aria-hidden />
        <span className="microlabel !text-warn">unauthorized</span>
      </div>
      <p className="text-xs text-ink-dim">{detail ?? "Home Assistant rejected the access token."}</p>
      <p className="mt-1 text-[0.7rem] text-ink-faint">
        Mint a fresh token in HA → Profile → Security → Long-Lived Access Tokens, then replace the
        token in <span className="font-mono">data/config.json</span>.
      </p>
    </div>
  );
}

export function HaLoadError({ error }: { error: unknown }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 microlabel !text-bad">load failed</div>
      <p className="text-xs text-ink-dim">
        {error instanceof Error ? error.message : "Could not reach nightwatch's own /api/ha/states."}
      </p>
    </div>
  );
}

const SKELETON_LABELS = ["Lights", "Switches", "Climate", "Locks", "Sensors"];

function SkeletonBar({ delayMs, className }: { delayMs: number; className?: string }) {
  return (
    <div
      className={cn("h-4 animate-pulse rounded bg-panel-2 motion-reduce:animate-none", className)}
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

/** panel-2 skeleton bars per domain, per DESIGN.md's "loading skeletons on panel-2". */
export function HaSkeleton() {
  return (
    <div className="space-y-5">
      {SKELETON_LABELS.map((label) => (
        <div key={label} className="panel p-4">
          <div className="microlabel mb-3">{label}</div>
          <div className="space-y-2.5">
            <SkeletonBar delayMs={0} className="w-2/3" />
            <SkeletonBar delayMs={120} className="w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
