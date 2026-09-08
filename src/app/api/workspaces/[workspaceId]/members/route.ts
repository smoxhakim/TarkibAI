import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { inviteMemberSchema } from '@/lib/workspaces/schema';
import { inviteMember } from '@/lib/workspaces/service';
import type { WorkspaceRole } from '@/lib/workspaces/permissions';

type RouteContext = { params: Promise<{ workspaceId: string }> };

/**
 * POST /api/workspaces/:workspaceId/members — invite by email.
 *
 * Returns the invitation including its accept path, because no email is sent:
 * no mail provider is wired into the product yet, so the inviter passes the
 * link on themselves rather than the app pretending to have delivered it.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await params;
    const input = inviteMemberSchema.parse(await readJson(req));

    const invitation = await inviteMember(workspaceId, user.id, {
      email: input.email,
      role: input.role as WorkspaceRole,
    });

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        acceptPath: `/invitations/${invitation.token}`,
      },
    };
  });
}
