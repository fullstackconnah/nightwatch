/**
 * Non-"ok" states for the /proxy route map: unconfigured (setup copy with the
 * exact data/config.json snippet), unreachable, unauthorized, and the loading
 * skeleton. Split out of proxy-routes.tsx because every other proxy-*.tsx file
 * only ever renders once status === "ok" — these are what render instead.
 */

const CONFIG_SNIPPET = `{
  "npm": {
    "url": "http://192.168.1.70:81",
    "email": "<admin email>",
    "password": "<admin password>"
  }
}`;

export function ProxyUnconfigured() {
  return (
    <div className="panel p-4 space-y-3">
      <div className="text-sm text-warn font-medium">Nginx Proxy Manager not configured</div>
      <p className="text-xs text-ink-dim">
        Add an <span className="font-mono text-ink">npm</span> block to{" "}
        <span className="font-mono text-ink">data/config.json</span> with the admin login NPM
        already uses — a bearer token is requested server-side per session, and it is never sent
        to the browser.
      </p>
      <pre className="rounded-md bg-panel-2 border border-line px-3 py-2.5 font-mono text-xs text-ink-dim overflow-x-auto">
        {CONFIG_SNIPPET}
      </pre>
    </div>
  );
}

function statusCopy(status: "unreachable" | "unauthorized"): { headline: string; fix: string } {
  if (status === "unreachable") {
    return {
      headline: "Nginx Proxy Manager did not respond",
      fix: 'Check the npm container is running and that its "url" in data/config.json is reachable from this container — the default admin UI is port 81.',
    };
  }
  return {
    headline: "NPM rejected the admin login",
    fix: 'Check the "email" and "password" in the npm block of data/config.json match an NPM admin account.',
  };
}

export function ProxyError({
  status,
  detail,
}: {
  status: "unreachable" | "unauthorized";
  detail?: string;
}) {
  const copy = statusCopy(status);
  return (
    <div className="panel p-4 space-y-2">
      <div className="text-sm text-warn font-medium">{copy.headline}</div>
      <div className="text-xs text-ink-dim">{copy.fix}</div>
      {detail && <div className="font-mono text-xs text-ink-faint">{detail}</div>}
    </div>
  );
}

/** Row-shaped placeholders rather than a bare "loading" line — the shape of the
 *  table that's about to land is itself information. Pulse is gated behind
 *  motion-reduce per DESIGN.md; a reduced-motion reader still sees the same bars,
 *  just steady. */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line/50 last:border-0">
      <span className="h-2 w-2 rounded-full bg-line shrink-0 motion-safe:animate-pulse" />
      <span className="h-3 w-32 rounded bg-line/70 motion-safe:animate-pulse" />
      <span className="h-3 w-40 rounded bg-line/50 motion-safe:animate-pulse hidden sm:block" />
      <span className="h-4 w-14 rounded bg-line/50 motion-safe:animate-pulse ml-auto" />
    </div>
  );
}

export function ProxyLoading() {
  return (
    <div className="panel overflow-hidden" aria-busy="true" aria-label="Reading proxy hosts">
      <div className="px-3 pt-3 pb-2 border-b border-line">
        <span className="h-3.5 w-20 rounded bg-line/70 inline-block motion-safe:animate-pulse" />
      </div>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}
