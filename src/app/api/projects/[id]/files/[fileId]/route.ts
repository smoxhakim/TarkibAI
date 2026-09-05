import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { deleteFile } from '@/lib/files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

// DELETE /api/projects/:id/files/:fileId — removes the R2 object and the row
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, fileId } = await params;
    await deleteFile(id, user.id, fileId);
    return { deleted: true };
  });
}
