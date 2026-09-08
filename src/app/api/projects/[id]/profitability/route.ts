import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getProjectProfitability } from '@/lib/commercial/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/profitability — projected, never realised. Needs cost.view.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getProjectProfitability(id, user.id);
  });
}
