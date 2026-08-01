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

export function GitStatusPanel({ snapshot }: { snapshot: GitSnapshotUnavailable }) {
  const copy = copyFor(snapshot.status);
  return (
    <div className="panel p-4 space-y-2">
      <div className="text-sm text-warn font-medium">{copy.headline}</div>
      {copy.fix && <div className="text-xs text-ink-dim">{copy.fix}</div>}
      <div className="font-mono text-xs text-ink-dim whitespace-pre-wrap break-words">{snapshot.detail}</div>
    </div>
  );
}
