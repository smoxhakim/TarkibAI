import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { changeRoleSchema } from '@/lib/workspaces/schema';
import { changeMemberRole, removeMember } from '@/lib/workspaces/service';
import type { WorkspaceRole } from '@/lib/workspaces/permissions';

type RouteContext = { params: Promise<{ workspaceId: string; userId: string }> };

// PATCH /api/workspaces/:workspaceId/members/:userId — change a role
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId, userId } = await params;
    const { role } = changeRoleSchema.parse(await readJson(req));
    return {
      member: await changeMemberRole(workspaceId, user.id, userId, role as WorkspaceRole),
    };
  });
}

// DELETE /api/workspaces/:workspaceId/members/:userId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId, userId } = await params;
    await removeMember(workspaceId, user.id, userId);
    return { removed: true };
  });
}
