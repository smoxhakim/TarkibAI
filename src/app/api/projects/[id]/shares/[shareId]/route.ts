import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { revokeShare } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ id: string; shareId: string }> };

// DELETE /api/projects/:id/shares/:shareId — withdraw the link
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, shareId } = await params;
    await revokeShare(id, user.id, shareId);
    return { revoked: true };
  });
}
