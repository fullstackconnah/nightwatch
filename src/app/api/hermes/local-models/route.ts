import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

const OLLAMA_URL = "http://192.168.1.70:11434/api/tags";
const TIMEOUT_MS = 3000;

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

/**
 * Server-side proxy for the LOCAL tier's model picker. Ollama has no CORS
 * headers and sits on the LAN, not behind NPM, so the browser cannot fetch
 * this directly — same "server does the fetching" rule PRODUCT.md sets for
 * every other widget. "hermes-local" is always returned as the first/default
 * pick regardless of reachability: it is a name the hermes daemon resolves
 * itself (to the pre-wired qwen3:8b), not a live Ollama query.
 */
export async function GET() {
  let res: Response;
  try {
    res = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return NextResponse.json({
      reachable: false,
      detail: `ollama not reachable at ${OLLAMA_URL} (${TIMEOUT_MS / 1000}s timeout) — pick "hermes-local" or type a model name.`,
      suggested: "hermes-local",
      models: [],
    });
  }

  if (!res.ok) {
    return NextResponse.json({
      reachable: false,
      detail: `ollama returned HTTP ${res.status} — pick "hermes-local" or type a model name.`,
      suggested: "hermes-local",
      models: [],
    });
  }

  let body: OllamaTagsResponse;
  try {
    body = (await res.json()) as OllamaTagsResponse;
  } catch {
    return NextResponse.json({
      reachable: false,
      detail: "ollama returned a non-JSON response — pick \"hermes-local\" or type a model name.",
      suggested: "hermes-local",
      models: [],
    });
  }

  const names = Array.isArray(body.models)
    ? body.models.map((m) => m.name).filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];

  return NextResponse.json({
    reachable: true,
    suggested: "hermes-local",
    models: names.map((n) => `ollama/${n}`),
  });
}
