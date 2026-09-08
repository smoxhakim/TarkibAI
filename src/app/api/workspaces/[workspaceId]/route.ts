import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { renameWorkspaceSchema } from '@/lib/workspaces/schema';
import { getWorkspaceView, renameWorkspace } from '@/lib/workspaces/service';

type RouteContext = { params: Promise<{ workspaceId: string }> };

// GET /api/workspaces/:workspaceId — members, invitations and your own role
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await params;
    return getWorkspaceView(workspaceId, user.id);
  });
}

// PATCH /api/workspaces/:workspaceId
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await params;
    const { name } = renameWorkspaceSchema.parse(await readJson(req));
    return { workspace: await renameWorkspace(workspaceId, user.id, name) };
  });
}
