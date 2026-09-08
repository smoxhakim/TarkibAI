import { requireDbUser } from '@/lib/auth/current-user';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { can } from '@/lib/workspaces/permissions';
import { listSuppliers } from '@/lib/commercial/service';
import { strings } from '@/lib/strings';
import { SuppliersManager } from '@/components/SuppliersManager';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace } = await searchParams;
  const user = await requireDbUser();
  const { workspaceId, role } = await resolveActiveWorkspace(user.id, workspace ?? null);
  const suppliers = await listSuppliers(workspaceId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.suppliers.title}</h1>

      <div className="mt-6">
        <SuppliersManager
          canManage={can(role, 'material.manage')}
          suppliers={suppliers.map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            contact: supplier.contact,
            phone: supplier.phone,
            email: supplier.email,
            leadTimeDays: supplier.leadTimeDays,
            notes: supplier.notes,
          }))}
        />
      </div>
    </main>
  );
}
