import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { updateProjectSchema } from '@/lib/projects/schema';
import { deleteProject, getProject, updateProject } from '@/lib/projects/service';

// Next 15+ delivers route params asynchronously.
type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { project: await getProject(id, user.id) };
  });
}

// PATCH /api/projects/:id — rename { title } and/or archive/restore { archived }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = updateProjectSchema.parse(await readJson(req));
    return { project: await updateProject(id, user.id, input) };
  });
}

// DELETE /api/projects/:id — permanent delete, cascades to all derived rows.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    await deleteProject(id, user.id);
    return { deleted: true };
  });
}
