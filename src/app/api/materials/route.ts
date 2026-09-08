import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createMaterialSchema, materialQuerySchema } from '@/lib/materials/schema';
import { createMaterial, listMaterials } from '@/lib/materials/service';
import { assertWorkspacePermission, resolveActiveWorkspace } from '@/lib/workspaces/access';

// GET /api/materials — the signed-in user's private library
// ?search= &category= &measurementModel= &includeArchived=true
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const params = req.nextUrl.searchParams;
    const query = materialQuerySchema.parse({
      search: params.get('search') ?? undefined,
      category: params.get('category') ?? undefined,
      measurementModel: params.get('measurementModel') ?? undefined,
      includeArchived: params.get('includeArchived') === 'true',
    });
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    return { materials: await listMaterials(workspaceId, query) };
  });
}

// POST /api/materials
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = createMaterialSchema.parse(await readJson(req));
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    await assertWorkspacePermission(workspaceId, user.id, 'material.manage');
    return { material: await createMaterial(workspaceId, user.id, input) };
  });
}
