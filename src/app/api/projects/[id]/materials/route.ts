import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { selectProjectMaterialSchema } from '@/lib/materials/schema';
import { listProjectMaterials, selectProjectMaterial } from '@/lib/materials/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/materials — materials selected for this project.
// Quantities and costs are null until the calculation engine runs (T4).
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { materials: await listProjectMaterials(id, user.id) };
  });
}

// POST /api/projects/:id/materials — select a material { materialId, role? }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = selectProjectMaterialSchema.parse(await readJson(req));
    return { materials: await selectProjectMaterial(id, user.id, input.materialId, input.role ?? null) };
  });
}
