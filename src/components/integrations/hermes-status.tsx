/* The non-"ok" /hermes states, written as real copy per DESIGN.md's "Do" list —
   no lorem, no generic "something went wrong". Unconfigured explains the two
   env vars this integration actually reads (process.env, never
   data/config.json — Hermes is a sibling daemon on this same box, not a
   third-party service with a UI-editable login) and that a container
   recreate is what picks them up, mirroring how HaUnconfigured/
   ProxyUnconfigured walk through their own config.json block. */

const ENV_SNIPPET = `HERMES_API_URL=http://192.168.1.70:8722
HERMES_API_TOKEN=<the daemon's bearer token>`;

export function HermesUnconfigured() {
  return (
    <div className="panel p-4 space-y-3">
      <div className="text-sm font-medium text-warn">Hermes is not connected</div>
      <p className="max-w-prose text-xs text-ink-dim">
        This page talks straight to the Hermes ops daemon&apos;s own HTTP API — not{" "}
        <span className="font-mono text-ink">data/config.json</span>, which every other
        integration on this app uses. Set two variables in the server environment instead:
      </p>
      <pre className="overflow-x-auto rounded-md border border-line bg-panel-2 px-3 py-2.5 font-mono text-xs text-ink-dim">
        {ENV_SNIPPET}
      </pre>
      <p className="text-[0.7rem] text-ink-dim">
        Both are read fresh on every request — recreate this container once they&apos;re set in
        the compose environment and nothing else needs to change.
      </p>
    </div>
  );
}

export function HermesUnreachable({ detail }: { detail?: string }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="dot dot-dead" aria-hidden />
        <span className="microlabel !text-bad">unreachable</span>
      </div>
      <p className="text-xs text-ink-dim">{detail ?? "Hermes did not respond."}</p>
      <p className="mt-1 text-[0.7rem] text-ink-dim">
        Check that the <span className="font-mono text-ink">hermes</span> container — the
        &quot;hermes&quot; stack in Dockge — is running, and that{" "}
        <span className="font-mono">HERMES_API_URL</span> in the server environment still points
        at it.
      </p>
    </div>
  );
}

export function HermesUnauthorized({ detail }: { detail?: string }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="dot dot-unhealthy" aria-hidden />
        <span className="microlabel !text-warn">unauthorized</span>
      </div>
      <p className="text-xs text-ink-dim">{detail ?? "Hermes rejected the API token."}</p>
      <p className="mt-1 text-[0.7rem] text-ink-dim">
        <span className="font-mono">HERMES_API_TOKEN</span> in this app&apos;s environment no
        longer matches what the daemon expects — update one side to match the other and recreate
        this container.
      </p>
    </div>
  );
}

export function HermesLoadError({ error }: { error: unknown }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 microlabel !text-bad">load failed</div>
      <p className="text-xs text-ink-dim">
        {error instanceof Error ? error.message : "Could not reach nightwatch's own /api/hermes-ctl."}
      </p>
    </div>
  );
}

function SkeletonBar({ delayMs, className }: { delayMs: number; className?: string }) {
  return (
    <div
      className={`h-4 animate-pulse rounded bg-panel-2 motion-reduce:animate-none ${className ?? ""}`}
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

/** Row-shaped skeleton for the whole surface — status band, actions row, ask
 *  panel, activity feed — so the shape of what's arriving is itself
 *  information, per DESIGN.md's skeleton idiom (proxy-status.tsx's SkeletonRow). */
export function HermesSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Reading Hermes status">
      <div className="panel p-4 space-y-3">
        <SkeletonBar delayMs={0} className="w-1/3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SkeletonBar delayMs={60} />
          <SkeletonBar delayMs={90} />
          <SkeletonBar delayMs={120} />
          <SkeletonBar delayMs={150} />
        </div>
      </div>
      <div className="panel p-4 space-y-3">
        <SkeletonBar delayMs={0} className="w-1/4" />
        <SkeletonBar delayMs={60} className="w-2/3" />
      </div>
      <div className="panel p-4 space-y-3">
        <SkeletonBar delayMs={0} className="w-1/4" />
        <SkeletonBar delayMs={60} className="w-full" />
        <SkeletonBar delayMs={90} className="w-full" />
      </div>
    </div>
  );
}
