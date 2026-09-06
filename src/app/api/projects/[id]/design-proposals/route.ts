import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { listProposals } from '@/lib/design/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/design-proposals
 *
 * Pending proposals plus the design revision history. There is deliberately no
 * POST: proposals are created by the agent's tool during a conversation, not by
 * a direct client call.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { proposals: await listProposals(id, user.id) };
  });
}
