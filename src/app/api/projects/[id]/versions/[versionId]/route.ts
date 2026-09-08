import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getVersion } from '@/lib/versions/service';

type RouteContext = { params: Promise<{ id: string; versionId: string }> };

// GET /api/projects/:id/versions/:versionId
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { versionId } = await params;
    return { version: await getVersion(versionId, user.id) };
  });
}
