import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createUploadSchema } from '@/lib/files/schema';
import { createUploadIntent, listFiles } from '@/lib/files/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/files — confirmed attachments for a project
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { files: await listFiles(id, user.id) };
  });
}

// POST /api/projects/:id/files — authorise an upload, returning a signed PUT URL.
// The browser then uploads directly to R2 and calls the confirm endpoint.
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = createUploadSchema.parse(await readJson(req));
    return createUploadIntent(id, user.id, input);
  });
}
