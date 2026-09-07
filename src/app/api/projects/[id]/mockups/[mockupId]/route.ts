import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { deleteMockup } from '@/lib/mockup/service';

type RouteContext = { params: Promise<{ id: string; mockupId: string }> };

// DELETE /api/projects/:id/mockups/:mockupId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, mockupId } = await params;
    await deleteMockup(id, user.id, mockupId);
    return { deleted: true };
  });
}
