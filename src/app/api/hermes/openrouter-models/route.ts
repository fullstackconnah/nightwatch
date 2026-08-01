import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — this is a public, key-less catalogue endpoint that changes rarely.

export interface OpenRouterModel {
  id: string;
  name: string;
  /** USD per token (not per-million) — straight from OpenRouter's own `pricing.prompt`/`.completion`
   *  strings, parsed to a number. null when OpenRouter didn't report a price for that direction. */
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
}

interface OpenRouterRawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
}

interface Cache {
  fetchedAt: number;
  models: OpenRouterModel[];
}

let cache: Cache | null = null;

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`openrouter returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterRawModel[] };
  if (!Array.isArray(body.data)) throw new Error("openrouter response had no data[] array");

  return body.data
    .filter((m): m is OpenRouterRawModel & { id: string } => typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({
      id: m.id,
      name: typeof m.name === "string" && m.name ? m.name : m.id,
      promptPrice: numberOrNull(m.pricing?.prompt),
      completionPrice: numberOrNull(m.pricing?.completion),
      contextLength: numberOrNull(m.context_length),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Public, key-less OpenRouter model catalogue for the OPENROUTER tier's model
 * picker. Cached in module scope for an hour (mirrors npm.ts's own in-memory
 * cache pattern) — this list changes on the order of days, not requests, and
 * OpenRouter's own catalogue is a few hundred entries, too big to refetch on
 * every keystroke of the client's filter box.
 */
export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ status: "ok", cachedAt: new Date(cache.fetchedAt).toISOString(), models: cache.models });
  }

  try {
    const models = await fetchModels();
    cache = { fetchedAt: Date.now(), models };
    return NextResponse.json({ status: "ok", cachedAt: new Date(cache.fetchedAt).toISOString(), models });
  } catch (e) {
    // A stale cache beats an empty list — OpenRouter's catalogue barely moves.
    if (cache) {
      return NextResponse.json({
        status: "stale",
        detail: e instanceof Error ? e.message : "openrouter unreachable",
        cachedAt: new Date(cache.fetchedAt).toISOString(),
        models: cache.models,
      });
    }
    return NextResponse.json({
      status: "error",
      detail: e instanceof Error ? e.message : "openrouter unreachable",
      cachedAt: null,
      models: [],
    });
  }
}
