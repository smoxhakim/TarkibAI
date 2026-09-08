import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getPurchasePlan } from '@/lib/commercial/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/purchasing — what to order, grouped by supplier.
 *
 * Available to anybody who can see the project; prices appear only for a reader
 * with cost visibility. Production buys the material without seeing what it
 * costs, and quantities are what they need.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getPurchasePlan(id, user.id);
  });
}
