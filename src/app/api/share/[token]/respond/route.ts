import type { NextRequest } from 'next/server';
import { handleRoute, readJson } from '@/lib/http/api';
import { clientResponseSchema } from '@/lib/collaboration/schema';
import { postClientResponse } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ token: string }> };

/**
 * POST /api/share/:token/respond — the client approves, asks for changes, or
 * comments.
 *
 * Unauthenticated, like the view. The only thing it can write is a message on
 * the project the token names, so a stolen link can add noise to one
 * conversation and nothing else — it cannot read another project, change the
 * specification, or reach any figure the view does not already show.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const { token } = await params;
    const input = clientResponseSchema.parse(await readJson(req));
    await postClientResponse(token, input);
    return { posted: true };
  });
}
