import { cancelBatchResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts. The id is checked in cancelBatchResponse before any fetch.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cancelBatchResponse((await ctx.params).id);
}
