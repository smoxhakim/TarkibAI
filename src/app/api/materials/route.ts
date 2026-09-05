import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createMaterialSchema, materialQuerySchema } from '@/lib/materials/schema';
import { createMaterial, listMaterials } from '@/lib/materials/service';

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
    return { materials: await listMaterials(user.id, query) };
  });
}

// POST /api/materials
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = createMaterialSchema.parse(await readJson(req));
    return { material: await createMaterial(user.id, input) };
  });
}
