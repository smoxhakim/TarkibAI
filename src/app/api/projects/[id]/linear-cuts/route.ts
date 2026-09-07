import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { linearCutSchema } from '@/lib/calc/cutting/schema';
import { addLinearCut, listLinearCuts } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/linear-cuts
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { cuts: await listLinearCuts(id, user.id) };
  });
}

// POST /api/projects/:id/linear-cuts — { materialId, lengthMm, quantity, label? }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = linearCutSchema.parse(await readJson(req));
    return { cuts: await addLinearCut(id, user.id, input) };
  });
}
