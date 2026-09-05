import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { confirmUpload } from '@/lib/files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

// POST /api/projects/:id/files/:fileId/confirm
// Verifies the object landed in R2 and records its real size. Until this runs
// the file stays "pending" and is invisible to the rest of the application.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, fileId } = await params;
    return { file: await confirmUpload(id, user.id, fileId) };
  });
}
