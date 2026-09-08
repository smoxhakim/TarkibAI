import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { postCommentSchema } from '@/lib/collaboration/schema';
import { listComments, postComment } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/comments — the whole thread, team and client
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { comments: await listComments(id, user.id) };
  });
}

// POST /api/projects/:id/comments
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const { body } = postCommentSchema.parse(await readJson(req));
    return { comment: await postComment(id, user.id, body) };
  });
}
