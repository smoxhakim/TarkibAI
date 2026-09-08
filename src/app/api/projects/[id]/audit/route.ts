import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { listProjectAudit } from '@/lib/audit/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/audit — the project's trail, newest first
export async function GET(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100');
    return {
      events: await listProjectAudit(id, user.id, {
        limit: Number.isFinite(limit) ? limit : 100,
      }),
    };
  });
}
