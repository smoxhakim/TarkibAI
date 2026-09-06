import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import type { Material } from '@/generated/prisma/client';
import type { CreateMaterialInput, MaterialQuery, UpdateMaterialInput } from './schema';

/**
 * A user's material library is private business data: their suppliers and their
 * purchase prices. Every function here is scoped by userId, and that userId
 * always comes from the server-side session (PRD §22).
 */
export async function assertMaterialAccess(materialId: string, userId: string): Promise<Material> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  // 404 rather than 403, for the same reason as projects: a 403 would confirm
  // that another user's material exists.
  if (!material || material.userId !== userId) throw notFound('Material');
  return material;
}

export async function listMaterials(userId: string, query: MaterialQuery): Promise<Material[]> {
  return prisma.material.findMany({
    where: {
      userId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.measurementModel ? { measurementModel: query.measurementModel } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { supplier: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

/** Distinct categories actually in use, for the filter control. */
export async function listCategories(userId: string): Promise<string[]> {
  const rows = await prisma.material.findMany({
    where: { userId, archivedAt: null },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((row) => row.category);
}

export async function getMaterial(materialId: string, userId: string): Promise<Material> {
  return assertMaterialAccess(materialId, userId);
}

export async function createMaterial(
  userId: string,
  input: CreateMaterialInput
): Promise<Material> {
  return prisma.material.create({
    data: {
      userId,
      name: input.name,
      category: input.category,
      customCategory: input.customCategory,
      supplier: input.supplier ?? null,
      measurementModel: input.measurementModel,
      standardLengthMm: input.standardLengthMm ?? null,
      sheetWidthMm: input.sheetWidthMm ?? null,
      sheetHeightMm: input.sheetHeightMm ?? null,
      thicknessMm: input.thicknessMm ?? null,
      unitPriceCents: input.unitPriceCents,
      technicalProperties: (input.technicalProperties ?? undefined) as object | undefined,
      notes: input.notes ?? null,
    },
  });
}

/**
 * Editing a material does NOT retroactively change past calculations: T4 snapshots
 * the price onto each ProjectMaterial line at calculation time. Changing a price
 * here affects future calculations only, which is why a recalculation is what
 * moves an existing project to the new price.
 */
export async function updateMaterial(
  materialId: string,
  userId: string,
  input: UpdateMaterialInput
): Promise<Material> {
  await assertMaterialAccess(materialId, userId);

  return prisma.material.update({
    where: { id: materialId },
    data: {
      name: input.name,
      category: input.category,
      customCategory: input.customCategory,
      supplier: input.supplier ?? null,
      measurementModel: input.measurementModel,
      // Cleared when the model no longer uses them, so a material switched from
      // sheet to linear cannot keep stale sheet dimensions.
      standardLengthMm: input.measurementModel === 'linear' ? input.standardLengthMm ?? null : null,
      sheetWidthMm: input.measurementModel === 'sheet' ? input.sheetWidthMm ?? null : null,
      sheetHeightMm: input.measurementModel === 'sheet' ? input.sheetHeightMm ?? null : null,
      thicknessMm: input.thicknessMm ?? null,
      unitPriceCents: input.unitPriceCents,
      technicalProperties: (input.technicalProperties ?? undefined) as object | undefined,
      notes: input.notes ?? null,
    },
  });
}

export async function setMaterialArchived(
  materialId: string,
  userId: string,
  archived: boolean
): Promise<Material> {
  await assertMaterialAccess(materialId, userId);
  return prisma.material.update({
    where: { id: materialId },
    data: { archivedAt: archived ? new Date() : null },
  });
}

/**
 * Permanent delete, allowed only while nothing references the material.
 *
 * A material used by a project is history: quotes and production documents
 * refer to it. Deleting it would leave those outputs pointing at nothing, so the
 * caller is told to archive instead — which hides it from pickers while keeping
 * every past reference intact.
 */
export async function deleteMaterial(materialId: string, userId: string): Promise<void> {
  await assertMaterialAccess(materialId, userId);

  const usageCount = await prisma.projectMaterial.count({ where: { materialId } });
  if (usageCount > 0) {
    throw new ApiError(
      409,
      `This material is used by ${usageCount} project${usageCount === 1 ? '' : 's'}. Archive it instead of deleting it, so existing calculations and documents stay intact.`,
      'material_in_use'
    );
  }

  await prisma.material.delete({ where: { id: materialId } });
}

/* -------------------------------------------------------------------------- */
/* Project selection                                                           */
/* -------------------------------------------------------------------------- */

export type ProjectMaterialView = {
  id: string;
  materialId: string;
  name: string;
  category: string;
  measurementModel: string;
  role: string | null;
  unitPriceCents: number;
  /** Null until the T4 calculation engine runs. Never zero-filled. */
  requiredQuantity: string | null;
  unitsToPurchase: number | null;
  totalCostCents: number | null;
  calculatedAt: Date | null;
};

export async function listProjectMaterials(
  projectId: string,
  userId: string
): Promise<ProjectMaterialView[]> {
  await assertProjectAccess(projectId, userId);

  const rows = await prisma.projectMaterial.findMany({
    where: { projectId },
    include: { material: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    materialId: row.materialId,
    name: row.material.name,
    category: row.material.category,
    measurementModel: row.material.measurementModel,
    role: row.role,
    unitPriceCents: row.material.unitPriceCents,
    requiredQuantity: row.requiredQuantity?.toString() ?? null,
    unitsToPurchase: row.unitsToPurchase,
    totalCostCents: row.totalCostCents,
    calculatedAt: row.calculatedAt,
  }));
}

/**
 * Records that a material is used on a project. This is a SELECTION, not a
 * calculation: every quantity and cost column stays null until T4 computes it.
 */
export async function selectProjectMaterial(
  projectId: string,
  userId: string,
  materialId: string,
  role: string | null
): Promise<ProjectMaterialView[]> {
  await assertProjectAccess(projectId, userId);
  // Ensures the material belongs to the same user, so a project cannot
  // reference someone else's private pricing.
  const material = await assertMaterialAccess(materialId, userId);

  if (material.archivedAt) {
    throw badRequest('That material is archived. Restore it before adding it to a project.');
  }

  const existing = await prisma.projectMaterial.findUnique({
    where: { projectId_materialId: { projectId, materialId } },
  });
  if (existing) {
    throw new ApiError(409, 'That material is already selected for this project.', 'already_selected');
  }

  await prisma.projectMaterial.create({ data: { projectId, materialId, role } });
  return listProjectMaterials(projectId, userId);
}

export async function removeProjectMaterial(
  projectId: string,
  userId: string,
  projectMaterialId: string
): Promise<void> {
  await assertProjectAccess(projectId, userId);

  const row = await prisma.projectMaterial.findUnique({ where: { id: projectMaterialId } });
  if (!row || row.projectId !== projectId) throw notFound('Project material');

  await prisma.projectMaterial.delete({ where: { id: row.id } });
}
