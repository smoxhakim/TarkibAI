import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { listProjectMaterials } from '@/lib/materials/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/calculate-materials
 *
 * Runs the deterministic engine. Refused until the specification is approved,
 * so purchase quantities always correspond to an agreed project.
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const summary = await calculateProjectMaterials(id, user.id);
    return { summary, materials: await listProjectMaterials(id, user.id) };
  });
}
