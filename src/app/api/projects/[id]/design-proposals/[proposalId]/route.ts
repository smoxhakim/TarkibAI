import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { badRequest, handleRoute, readJson } from '@/lib/http/api';
import { approveProposal, listProposals, rejectProposal } from '@/lib/design/service';

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });

/**
 * POST /api/projects/:id/design-proposals/:proposalId — { decision }
 *
 * The user's decision on a proposed design change. No AI tool reaches this
 * route, so a proposal can only ever be applied by a deliberate human act
 * (PRD §5.4).
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, proposalId } = await params;
    const body = await readJson(req);
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) throw badRequest('Send { "decision": "approve" | "reject" }.');

    const proposal =
      parsed.data.decision === 'approve'
        ? await approveProposal(id, user.id, proposalId)
        : await rejectProposal(id, user.id, proposalId);

    return { proposal, proposals: await listProposals(id, user.id) };
  });
}
