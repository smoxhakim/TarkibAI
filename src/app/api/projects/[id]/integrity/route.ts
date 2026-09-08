import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getIntegrityReport } from '@/lib/validation/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/integrity — every check, and what the project is
// currently safe to produce.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getIntegrityReport(id, user.id);
  });
}
