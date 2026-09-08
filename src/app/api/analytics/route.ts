import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { getWorkspaceAnalytics } from '@/lib/commercial/service';

// GET /api/analytics — the workspace's own numbers. Needs cost.view.
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(
      user.id,
      req.nextUrl.searchParams.get('workspaceId')
    );
    return getWorkspaceAnalytics(workspaceId, user.id);
  });
}
