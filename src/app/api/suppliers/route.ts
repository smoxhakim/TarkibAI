import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { supplierSchema } from '@/lib/commercial/schema';
import { createSupplier, listSuppliers } from '@/lib/commercial/service';

// GET /api/suppliers — the workspace's suppliers
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(
      user.id,
      req.nextUrl.searchParams.get('workspaceId')
    );
    const includeArchived = req.nextUrl.searchParams.get('includeArchived') === 'true';
    return { suppliers: await listSuppliers(workspaceId, { includeArchived }) };
  });
}

// POST /api/suppliers
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(
      user.id,
      req.nextUrl.searchParams.get('workspaceId')
    );
    const input = supplierSchema.parse(await readJson(req));
    return { supplier: await createSupplier(workspaceId, user.id, input) };
  });
}
