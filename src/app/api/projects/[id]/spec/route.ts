import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { getSpec } from '@/lib/spec/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/spec — current specification, plus what is still missing
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getSpec(id, user.id);
  });
}
