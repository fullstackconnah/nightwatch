/** The Media integration's save: the URL is a plain field, the token only changes when a new one is sent. */
export interface MediaBlock {
  workerUrl?: string;
  workerToken?: string;
  updatedAt?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

export function mergeMedia(patch: { workerUrl?: unknown; workerToken?: unknown }, current: MediaBlock | undefined, now: string): { media: MediaBlock } | { error: string } {
  const workerUrl = str(patch.workerUrl) || current?.workerUrl;
  const workerToken = str(patch.workerToken) || current?.workerToken;
  if (!workerUrl) return { error: "Media needs the worker URL" };
  if (!workerToken) return { error: "Media needs the worker token" };
  return { media: { workerUrl, workerToken, updatedAt: now } };
}

/** What GET /api/settings may carry: the URL and when it changed, never the token. */
export const mediaPublic = (m: MediaBlock | undefined) => (m ? { workerUrl: m.workerUrl, updatedAt: m.updatedAt } : m);
