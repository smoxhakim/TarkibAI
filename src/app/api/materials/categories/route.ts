import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { listCategories } from '@/lib/materials/service';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';

// GET /api/materials/categories — categories actually in use, for filtering
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    return { categories: await listCategories(workspaceId) };
  });
}
