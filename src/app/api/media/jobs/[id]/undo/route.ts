import { undoResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts. The id is checked in undoResponse before any fetch.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return undoResponse((await ctx.params).id);
}
