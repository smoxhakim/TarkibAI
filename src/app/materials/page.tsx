import { requireDbUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { listCategories, listMaterials } from '@/lib/materials/service';
import { materialQuerySchema, type MeasurementModel } from '@/lib/materials/schema';
import { strings } from '@/lib/strings';
import { MaterialLibrary } from '@/components/MaterialLibrary';

export const dynamic = 'force-dynamic';

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    category?: string;
    measurementModel?: string;
    archived?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await requireDbUser();

  const showArchived = params.archived === 'true';
  // Parsed through the same schema the API uses, so a hand-edited query string
  // cannot reach the database as an unvalidated filter.
  const query = materialQuerySchema.parse({
    search: params.search || undefined,
    category: params.category || undefined,
    measurementModel: (params.measurementModel as MeasurementModel) || undefined,
    includeArchived: showArchived,
  });

  const [materials, categories, costSettings] = await Promise.all([
    listMaterials(user.id, query),
    listCategories(user.id),
    prisma.costSettings.findUnique({ where: { userId: user.id } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.materials.title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{strings.materials.subtitle}</p>

      <div className="mt-6">
        <MaterialLibrary
          materials={materials.map((material) => ({
            id: material.id,
            name: material.name,
            category: material.category,
            customCategory: material.customCategory,
            supplier: material.supplier,
            measurementModel: material.measurementModel,
            standardLengthMm: material.standardLengthMm,
            sheetWidthMm: material.sheetWidthMm,
            sheetHeightMm: material.sheetHeightMm,
            // Prisma Decimal is not serialisable across the server/client
            // boundary, so it is narrowed to a number for display only.
            thicknessMm: material.thicknessMm === null ? null : Number(material.thicknessMm),
            unitPriceCents: material.unitPriceCents,
            notes: material.notes,
            archivedAt: material.archivedAt ? material.archivedAt.toISOString() : null,
          }))}
          categories={categories}
          currency={costSettings?.currency ?? 'MAD'}
          showArchived={showArchived}
          filters={{
            search: params.search ?? '',
            category: params.category ?? '',
            measurementModel: params.measurementModel ?? '',
          }}
        />
      </div>
    </main>
  );
}
