import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getRecommendations } from '@/lib/calc/efficiency/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/recommendations
 *
 * Computed on demand from the real cutting engines. Nothing is stored, because
 * a saving goes stale the moment a price or piece list changes and stale
 * financial advice is worse than none.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getRecommendations(id, user.id);
  });
}
