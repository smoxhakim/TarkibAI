import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { badRequest, handleRoute } from '@/lib/http/api';
import { compareVersions } from '@/lib/versions/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/versions/compare?from=<id>&to=<id>
 *
 * `to` may be omitted to compare against the project as it stands now, which is
 * the question a user usually has and needs no version to have been recorded
 * for the present state.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;

    const fromId = req.nextUrl.searchParams.get('from');
    if (!fromId) throw badRequest('Choose a version to compare from.');
    const toId = req.nextUrl.searchParams.get('to');

    return compareVersions(id, user.id, { fromId, toId });
  });
}
