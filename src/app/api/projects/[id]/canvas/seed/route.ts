import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { seedScene } from '@/lib/canvas/service';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/:id/canvas/seed — build the scene from the approved spec
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return seedScene(id, user.id);
  });
}
