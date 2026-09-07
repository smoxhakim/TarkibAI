import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { removePiece } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string; pieceId: string }> };

// DELETE /api/projects/:id/cutting-pieces/:pieceId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, pieceId } = await params;
    await removePiece(id, user.id, pieceId);
    return { deleted: true };
  });
}
