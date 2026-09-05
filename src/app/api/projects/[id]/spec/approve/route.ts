import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { approveSpec } from '@/lib/spec/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/spec/approve
 *
 * Deliberately a user-facing route with no AI tool counterpart. The agent
 * cannot reach this code path, so a specification is only ever approved by a
 * deliberate act of the person responsible for the project (PRD §5.4).
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return approveSpec(id, user.id);
  });
}
