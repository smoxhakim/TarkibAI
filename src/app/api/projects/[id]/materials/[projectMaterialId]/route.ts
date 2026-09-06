import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { removeProjectMaterial, updateProjectMaterialRequirement } from '@/lib/materials/service';

type RouteContext = { params: Promise<{ id: string; projectMaterialId: string }> };

const requirementSchema = z.object({
  // Null clears the requirement. The upper bound is a sanity limit that catches
  // a slipped decimal point rather than a fabrication rule.
  requiredQuantity: z.number().positive().max(1_000_000).nullable(),
  requiredDimensions: z.string().trim().max(300).nullable().optional(),
  role: z.string().trim().max(160).nullable().optional(),
});

// PATCH /api/projects/:id/materials/:projectMaterialId — set how much is needed
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, projectMaterialId } = await params;
    const input = requirementSchema.parse(await readJson(req));
    return {
      materials: await updateProjectMaterialRequirement(id, user.id, projectMaterialId, {
        requiredQuantity: input.requiredQuantity,
        requiredDimensions: input.requiredDimensions ?? null,
        ...(input.role !== undefined ? { role: input.role } : {}),
      }),
    };
  });
}

// DELETE /api/projects/:id/materials/:projectMaterialId — deselect
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, projectMaterialId } = await params;
    await removeProjectMaterial(id, user.id, projectMaterialId);
    return { deleted: true };
  });
}
