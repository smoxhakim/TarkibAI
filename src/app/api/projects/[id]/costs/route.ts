import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getProjectCost } from '@/lib/calc/costs/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/costs — the INTERNAL breakdown.
 *
 * Protected by the same ownership check as everything else. This is private
 * business data and has no client-facing counterpart on this route; the
 * client-safe view is produced only by the quote pipeline (T13).
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getProjectCost(id, user.id);
  });
}
