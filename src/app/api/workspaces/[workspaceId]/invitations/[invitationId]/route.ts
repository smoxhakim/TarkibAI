import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { revokeInvitation } from '@/lib/workspaces/service';

type RouteContext = { params: Promise<{ workspaceId: string; invitationId: string }> };

// DELETE /api/workspaces/:workspaceId/invitations/:invitationId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId, invitationId } = await params;
    await revokeInvitation(workspaceId, user.id, invitationId);
    return { revoked: true };
  });
}
