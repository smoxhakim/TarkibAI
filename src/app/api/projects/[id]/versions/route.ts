import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createVersionSchema } from '@/lib/versions/schema';
import { listVersions, recordVersion } from '@/lib/versions/service';
import { assertProjectPermission } from '@/lib/projects/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/versions — the timeline, newest first
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { versions: await listVersions(id, user.id) };
  });
}

// POST /api/projects/:id/versions — save a version deliberately
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = createVersionSchema.parse(await readJson(req));
    // Proved here rather than inside recordVersion, which is an internal
    // primitive the already-authorized services call after their own check.
    // This is the one untrusted entry point into it, and saving a version is a
    // write to the project's timeline, so it takes the project write
    // permission rather than membership.
    await assertProjectPermission(id, user.id, 'project.edit');
    return { version: await recordVersion(id, { reason: 'manual', ...input }) };
  });
}
