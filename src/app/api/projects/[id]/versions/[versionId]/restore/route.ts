import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { previewRestore, restoreVersion } from '@/lib/versions/service';

type RouteContext = { params: Promise<{ id: string; versionId: string }> };

/**
 * GET /api/projects/:id/versions/:versionId/restore
 *
 * What restoring would do, without doing it. Restoring changes the working
 * specification and the canvas, so it goes behind an explicit review step
 * rather than a single click (PRD 12).
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { versionId } = await params;
    return previewRestore(versionId, user.id);
  });
}

// POST /api/projects/:id/versions/:versionId/restore — confirmed
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { versionId } = await params;
    return { version: await restoreVersion(versionId, user.id) };
  });
}
