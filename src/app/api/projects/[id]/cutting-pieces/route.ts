import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { cuttingPieceSchema } from '@/lib/calc/cutting/schema';
import { addPiece, listPieces } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/cutting-pieces
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { pieces: await listPieces(id, user.id) };
  });
}

// POST /api/projects/:id/cutting-pieces — { materialId, widthMm, heightMm, quantity, ... }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = cuttingPieceSchema.parse(await readJson(req));
    return { pieces: await addPiece(id, user.id, input) };
  });
}
