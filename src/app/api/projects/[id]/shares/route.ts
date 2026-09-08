import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createShareSchema } from '@/lib/collaboration/schema';
import { createShare, listShares } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/shares
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { shares: await listShares(id, user.id) };
  });
}

// POST /api/projects/:id/shares — a client link. Returned, never emailed.
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = createShareSchema.parse(await readJson(req));
    return { share: await createShare(id, user.id, input) };
  });
}
