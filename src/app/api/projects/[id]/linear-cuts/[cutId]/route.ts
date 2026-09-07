import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { removeLinearCut } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string; cutId: string }> };

// DELETE /api/projects/:id/linear-cuts/:cutId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, cutId } = await params;
    await removeLinearCut(id, user.id, cutId);
    return { deleted: true };
  });
}
