import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createVersionSchema } from '@/lib/versions/schema';
import { listVersions, recordVersion } from '@/lib/versions/service';
import { assertProjectAccess } from '@/lib/projects/service';

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
    // Ownership is proved here rather than inside recordVersion, which is also
    // called by services that have already checked it.
    await assertProjectAccess(id, user.id);
    return { version: await recordVersion(id, { reason: 'manual', ...input }) };
  });
}
