import type { GitSnapshotUnavailable } from "@/lib/forgejo-types";

/**
 * Same shape as gpu-view.tsx's gpuUnavailableCopy/transcodeUnavailableCopy:
 * name an action, not just a condition. "unconfigured" returns no canned fix
 * because its `detail` already carries the full setup instructions (account,
 * token, exact config.json snippet) — repeating that here would just put two
 * sentences of the same instruction on screen.
 */
function copyFor(status: GitSnapshotUnavailable["status"]): { headline: string; fix: string | null } {
  switch (status) {
    case "unconfigured":
      return { headline: "Forgejo is not configured", fix: null };
    case "unreachable":
      return {
        headline: "Forgejo did not respond",
        fix: "Check the forgejo container is running at 192.168.1.70:3010 and that its URL in data/config.json is reachable from this container.",
      };
    case "unauthorized":
      return {
        headline: "Forgejo rejected the API token",
        fix: "Mint a fresh token in Forgejo under Settings → Applications, then update the forgejo block in data/config.json.",
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

const CONFIG_SNIPPET = `{
  "forgejo": {
    "url": "http://192.168.1.70:3010",
    "token": "<the access token>"
  }
}`;

export function GitStatusPanel({ snapshot }: { snapshot: GitSnapshotUnavailable }) {
  const copy = copyFor(snapshot.status);
  const unconfigured = snapshot.status === "unconfigured";
  return (
    <div className="panel p-4 space-y-2">
      <div className="text-sm text-warn font-medium">{copy.headline}</div>
      {copy.fix && <div className="text-xs text-ink-dim">{copy.fix}</div>}
      {/* unconfigured detail is setup prose; the other states carry raw error
          strings, which stay mono per the Mono-Is-Data rule. */}
      <div
        className={
          unconfigured
            ? "max-w-prose text-xs text-ink-dim"
            : "font-mono text-xs text-ink-dim whitespace-pre-wrap break-words"
        }
      >
        {snapshot.detail}
      </div>
      {unconfigured && (
        <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-panel-2 px-3 py-2.5 font-mono text-[0.7rem] text-ink-dim">
          {CONFIG_SNIPPET}
        </pre>
      )}
    </div>
  );
}
