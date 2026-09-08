import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { supplierSchema } from '@/lib/commercial/schema';
import { setSupplierArchived, updateSupplier } from '@/lib/commercial/service';

type RouteContext = { params: Promise<{ supplierId: string }> };

// PUT /api/suppliers/:supplierId
export async function PUT(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { supplierId } = await params;
    const input = supplierSchema.parse(await readJson(req));
    return { supplier: await updateSupplier(supplierId, user.id, input) };
  });
}

// DELETE /api/suppliers/:supplierId — archives. Suppliers are referenced by
// materials and by past purchase lists, so they are hidden, never removed.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { supplierId } = await params;
    return { supplier: await setSupplierArchived(supplierId, user.id, true) };
  });
}
