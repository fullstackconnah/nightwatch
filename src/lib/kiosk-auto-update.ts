export const AUTO_UPDATE_IDLE_MS = 30_000;

export type AutoUpdateInput = {
  pageBuild: string;
  serverBuild: string;
  /** The build this tab last reloaded for (loop guard), or null. */
  reloadedFor: string | null;
  idleMs: number;
  overlayOpen: boolean;
};

/** Reload only for a new build nobody is using the screen for, and never twice for one target. */
export function autoUpdateDecision(i: AutoUpdateInput): "reload" | "wait" {
  if (i.serverBuild === i.pageBuild || i.reloadedFor === i.serverBuild) return "wait";
  if (i.idleMs < AUTO_UPDATE_IDLE_MS || i.overlayOpen) return "wait";
  return "reload";
}
