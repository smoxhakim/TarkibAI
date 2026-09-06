import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { removeProjectMaterial } from '@/lib/materials/service';

type RouteContext = { params: Promise<{ id: string; projectMaterialId: string }> };

// DELETE /api/projects/:id/materials/:projectMaterialId — deselect
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, projectMaterialId } = await params;
    await removeProjectMaterial(id, user.id, projectMaterialId);
    return { deleted: true };
  });
}
