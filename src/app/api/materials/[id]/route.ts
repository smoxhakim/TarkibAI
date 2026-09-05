import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { updateMaterialSchema } from '@/lib/materials/schema';
import {
  deleteMaterial,
  getMaterial,
  setMaterialArchived,
  updateMaterial,
} from '@/lib/materials/service';

type RouteContext = { params: Promise<{ id: string }> };

// An archive toggle and a full edit arrive on the same verb, so they are
// distinguished by shape rather than by separate endpoints.
const archiveSchema = z.object({ archived: z.boolean() });

// GET /api/materials/:id
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { material: await getMaterial(id, user.id) };
  });
}

// PATCH /api/materials/:id — full edit, or { archived: boolean }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const body = await readJson(req);

    const archiveOnly = archiveSchema.safeParse(body);
    if (archiveOnly.success) {
      return { material: await setMaterialArchived(id, user.id, archiveOnly.data.archived) };
    }

    const input = updateMaterialSchema.parse(body);
    return { material: await updateMaterial(id, user.id, input) };
  });
}

// DELETE /api/materials/:id — refused with 409 when a project uses it
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    await deleteMaterial(id, user.id);
    return { deleted: true };
  });
}
