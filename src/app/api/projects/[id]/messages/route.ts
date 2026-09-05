import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError, handleRoute } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The Moroccan Darija conversation layer is built in Phase 1 (T1).
 *
 * Authentication and ownership are enforced here already so the boundary is
 * correct from the start, but the endpoints return 501 rather than fabricating
 * an empty message list or a fake assistant reply — a caller must be able to
 * tell "no messages" apart from "not implemented".
 */
const notImplemented = () =>
  new ApiError(501, 'The conversation layer is not implemented yet (Phase 1).', 'not_implemented');

// GET /api/projects/:id/messages
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    await assertProjectAccess(id, user.id);
    throw notImplemented();
  });
}

// POST /api/projects/:id/messages
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    await assertProjectAccess(id, user.id);
    throw notImplemented();
  });
}
