import { cancelResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts. The id is checked in cancelResponse before any fetch.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cancelResponse((await ctx.params).id);
}
