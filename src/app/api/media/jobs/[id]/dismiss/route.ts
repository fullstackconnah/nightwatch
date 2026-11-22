import { dismissResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts. The id is checked in dismissResponse before any fetch.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return dismissResponse((await ctx.params).id);
}
