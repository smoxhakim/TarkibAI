import { prisma } from '@/lib/db';
import type { WorkspaceId } from '@/lib/workspaces/access';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import {
  assertProjectAccess,
  assertProjectPermission,
  hasProjectPermission,
} from '@/lib/projects/service';
import type { Material } from '@/generated/prisma/client';
import type { CreateMaterialInput, MaterialQuery, UpdateMaterialInput } from './schema';
import { recordAudit } from '@/lib/audit/service';
import { assertWorkspacePermission, getMembership } from '@/lib/workspaces/access';

/**
 * A user's material library is private business data: their suppliers and their
 * purchase prices. Every function here is scoped by userId, and that userId
 * always comes from the server-side session (PRD §22).
 */
/**
 * A material the caller may see, or 404.
 *
 * Resolves the material's workspace and requires membership, the same rule the
 * project gate uses. Before T18 this compared `material.userId`; that column
 * now records who added it and is never consulted for access.
 */
export async function assertMaterialAccess(materialId: string, userId: string): Promise<Material> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  // 404 rather than 403, for the same reason as projects: a 403 would confirm
  // that another business's material exists.
  if (!material) throw notFound('Material');
  if (!(await getMembership(material.workspaceId, userId))) throw notFound('Material');
  return material;
}

/** A material the caller may CHANGE. Managing the library is a permission. */
async function assertMaterialManagement(materialId: string, userId: string): Promise<Material> {
  const material = await assertMaterialAccess(materialId, userId);
  await assertWorkspacePermission(material.workspaceId, userId, 'material.manage');
  return material;
}

export async function listMaterials(
  workspaceId: WorkspaceId,
  query: MaterialQuery
): Promise<Material[]> {
  return prisma.material.findMany({
    where: {
      workspaceId,
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
export async function listCategories(workspaceId: WorkspaceId): Promise<string[]> {
  const rows = await prisma.material.findMany({
    where: { workspaceId, archivedAt: null },
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
  workspaceId: WorkspaceId,
  userId: string,
  input: CreateMaterialInput
): Promise<Material> {
  return prisma.material.create({
    data: {
      workspaceId,
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
  await assertMaterialManagement(materialId, userId);

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
  const material = await assertMaterialManagement(materialId, userId);
  const updated = await prisma.material.update({
    where: { id: material.id },
    data: { archivedAt: archived ? new Date() : null },
  });

  if (archived) {
    // Only the archive is recorded. Restoring is a correction, and a trail that
    // logs both halves of every toggle is one nobody reads.
    await recordAudit({
      userId,
      action: 'material.archived',
      summary: `Archived the material "${updated.name}". Projects still using it will say so.`,
      detail: { materialId },
    });
  }

  return updated;
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
  const material = await assertMaterialManagement(materialId, userId);

  const usageCount = await prisma.projectMaterial.count({ where: { materialId } });
  if (usageCount > 0) {
    throw new ApiError(
      409,
      `This material is used by ${usageCount} project${usageCount === 1 ? '' : 's'}. Archive it instead of deleting it, so existing calculations and documents stay intact.`,
      'material_in_use'
    );
  }

  await prisma.material.delete({ where: { id: materialId } });

  await recordAudit({
    userId,
    action: 'material.deleted',
    summary: `Deleted the material "${material.name}".`,
    detail: { materialId },
  });
}

/* -------------------------------------------------------------------------- */
/* Project selection                                                           */
/* -------------------------------------------------------------------------- */

export type CalculationStep = { label: string; value: string };
export type CalculationWarning = { code: string; message: string };

/**
 * Why a calculated line no longer reflects the project.
 *
 * Derived data goes stale when its inputs move (PRD §24). Rather than silently
 * showing an out-of-date purchase count, the line says which input changed.
 */
export type StaleReason = 'spec_changed' | 'material_changed' | 'requirement_changed';

export type ProjectMaterialView = {
  id: string;
  materialId: string;
  name: string;
  category: string;
  measurementModel: string;
  role: string | null;

  /**
   * Internal price, or null when the reader may not see one.
   *
   * Nullable rather than always-a-number because `cost.view` decides whether it
   * is populated, and a non-nullable type would let a consumer render whatever
   * happened to be there. With this, every caller has to say what it does when
   * the price is withheld, and the compiler checks that it did.
   */
  unitPriceCents: number | null;

  /** User-stated input. Null when they have not said how much they need. */
  requiredQuantity: string | null;
  requiredDimensions: string | null;

  /** Results. All null until the calculation engine runs. Never zero-filled. */
  unitsToPurchase: number | null;
  totalPurchasedQuantity: string | null;
  wasteQuantity: string | null;
  wastePercent: string | null;
  /** Both null for a reader without `cost.view`, as well as before calculation. */
  unitPriceCentsSnapshot: number | null;
  totalCostCents: number | null;
  calculatedAt: Date | null;
  unsupportedReason: string | null;

  /** Audit trail of how the numbers were reached, snapshotted at calculation time. */
  steps: CalculationStep[];
  warnings: CalculationWarning[];

  staleReasons: StaleReason[];
};

/** The material fields a calculation actually depends on. */
type CalculationInputFields = {
  measurementModel: string;
  standardLengthMm: number | null;
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  unitPriceCents: number;
};

/** Reads the snapshotted explanation defensively — it is untyped JSON. */
function readCalculationInputs(value: unknown): {
  steps: CalculationStep[];
  warnings: CalculationWarning[];
  /** Null when the snapshot predates these fields or cannot be read. */
  fields: CalculationInputFields | null;
} {
  if (typeof value !== 'object' || value === null) return { steps: [], warnings: [], fields: null };
  const record = value as Record<string, unknown>;
  const steps = Array.isArray(record.steps) ? (record.steps as CalculationStep[]) : [];
  const warnings = Array.isArray(record.warnings) ? (record.warnings as CalculationWarning[]) : [];

  const number = (key: string): number | null =>
    typeof record[key] === 'number' ? (record[key] as number) : null;

  const fields =
    typeof record.measurementModel === 'string' && typeof record.unitPriceCents === 'number'
      ? {
          measurementModel: record.measurementModel,
          standardLengthMm: number('standardLengthMm'),
          sheetWidthMm: number('sheetWidthMm'),
          sheetHeightMm: number('sheetHeightMm'),
          unitPriceCents: record.unitPriceCents,
        }
      : null;

  return { steps, warnings, fields };
}

/**
 * Whether the material has changed in a way that changes the numbers.
 *
 * Compares the snapshot taken at calculation time against the material now,
 * field by field. The earlier test — `material.updatedAt > calculatedAt` — was
 * a proxy, and it marked a line stale for edits that cannot affect a figure:
 * renaming a material, changing its supplier or category, or archiving it. T16
 * turned staleness into a blocker that refuses to issue a quote, at which point
 * a false positive stops real work.
 *
 * Without a readable snapshot it falls back to the timestamp, which over-reports
 * rather than under-reports. A line wrongly called stale costs a recalculation;
 * a stale line called current reaches a client.
 */
function materialInputsChanged(
  snapshot: CalculationInputFields | null,
  material: Material,
  calculatedAt: Date,
  updatedAt: Date
): boolean {
  if (snapshot === null) return updatedAt > calculatedAt;

  return (
    snapshot.measurementModel !== material.measurementModel ||
    snapshot.standardLengthMm !== material.standardLengthMm ||
    snapshot.sheetWidthMm !== material.sheetWidthMm ||
    snapshot.sheetHeightMm !== material.sheetHeightMm ||
    snapshot.unitPriceCents !== material.unitPriceCents
  );
}

/**
 * The project's material lines.
 *
 * # Why this degrades rather than refuses
 *
 * Quantities are not costs. A production manager orders the material and a
 * worker cuts it, and both need to know that a line needs four sheets; neither
 * has any business knowing what those sheets cost (T18). Refusing the whole
 * read — the rule the cost service uses, where every field IS financial — would
 * take the quantities away with the prices and break the two roles that most
 * need them.
 *
 * So the read is open to any project member and the MONEY is withheld: the
 * three price fields come back null for a reader without `cost.view`, decided
 * here rather than by whoever renders the result. The view is assembled field
 * by field from the row, so a monetary column added to ProjectMaterial later
 * cannot reach a caller unless somebody adds it to this list on purpose.
 */
export async function listProjectMaterials(
  projectId: string,
  userId: string
): Promise<ProjectMaterialView[]> {
  await assertProjectAccess(projectId, userId);
  const showPrices = await hasProjectPermission(projectId, userId, 'cost.view');

  const [rows, approvedSpec] = await Promise.all([
    prisma.projectMaterial.findMany({
      where: { projectId },
      include: { material: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectSpec.findFirst({
      where: { projectId, status: 'approved' },
      orderBy: { version: 'desc' },
    }),
  ]);

  return rows.map((row) => {
    const { steps, warnings, fields } = readCalculationInputs(row.calculationInputs);

    const staleReasons: StaleReason[] = [];
    if (row.calculatedAt) {
      // A newer approved spec means the project itself changed shape.
      if (approvedSpec && row.specVersionAtCalculation !== null && approvedSpec.version > row.specVersionAtCalculation) {
        staleReasons.push('spec_changed');
      }
      // Only an edit that changes a figure counts. Archiving, renaming or
      // changing a supplier bumps updatedAt without touching the arithmetic.
      if (materialInputsChanged(fields, row.material, row.calculatedAt, row.material.updatedAt)) {
        staleReasons.push('material_changed');
      }
      // The requirement was edited after the numbers were produced. This uses
      // requirementUpdatedAt, not updatedAt: the calculation writes to this row
      // too, so updatedAt would mark every line stale the instant it was
      // calculated.
      if (row.requirementUpdatedAt && row.requirementUpdatedAt > row.calculatedAt) {
        staleReasons.push('requirement_changed');
      }
    }

    return {
      id: row.id,
      materialId: row.materialId,
      name: row.material.name,
      category: row.material.category,
      measurementModel: row.material.measurementModel,
      role: row.role,
      unitPriceCents: showPrices ? row.material.unitPriceCents : null,
      requiredQuantity: row.requiredQuantity?.toString() ?? null,
      requiredDimensions: row.requiredDimensions,
      unitsToPurchase: row.unitsToPurchase,
      totalPurchasedQuantity: row.totalPurchasedQuantity?.toString() ?? null,
      wasteQuantity: row.wasteQuantity?.toString() ?? null,
      wastePercent: row.wastePercent?.toString() ?? null,
      unitPriceCentsSnapshot: showPrices ? row.unitPriceCentsSnapshot : null,
      totalCostCents: showPrices ? row.totalCostCents : null,
      calculatedAt: row.calculatedAt,
      unsupportedReason: row.unsupportedReason,
      steps,
      warnings,
      staleReasons,
    };
  });
}

/**
 * Sets how much of a material the project needs.
 *
 * This is the one number the engine does not derive, so it is recorded as a
 * plain input. Existing results are NOT cleared here: they stay visible and are
 * flagged stale, so the user can see what the old numbers were while deciding
 * to recalculate.
 */
export async function updateProjectMaterialRequirement(
  projectId: string,
  userId: string,
  projectMaterialId: string,
  input: { requiredQuantity: number | null; requiredDimensions: string | null; role?: string | null }
): Promise<ProjectMaterialView[]> {
  // The requirement is the one number the engine does not derive, so it is the
  // input every purchase count downstream rests on.
  await assertProjectPermission(projectId, userId, 'project.edit');

  const row = await prisma.projectMaterial.findUnique({ where: { id: projectMaterialId } });
  if (!row || row.projectId !== projectId) throw notFound('Project material');

  await prisma.projectMaterial.update({
    where: { id: row.id },
    data: {
      requiredQuantity: input.requiredQuantity,
      requiredDimensions: input.requiredDimensions,
      requirementUpdatedAt: new Date(),
      ...(input.role !== undefined ? { role: input.role } : {}),
    },
  });

  return listProjectMaterials(projectId, userId);
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
  // `project.edit`, not `material.manage`: this records what THIS PROJECT is
  // built from and never touches the shared catalogue. Requiring the library
  // permission would stop a designer or a salesperson specifying materials,
  // which is most of their job.
  await assertProjectPermission(projectId, userId, 'project.edit');
  // Scoped to the workspace, so a project cannot reference another business's
  // material or its private pricing.
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
  await assertProjectPermission(projectId, userId, 'project.edit');

  const row = await prisma.projectMaterial.findUnique({ where: { id: projectMaterialId } });
  if (!row || row.projectId !== projectId) throw notFound('Project material');

  await prisma.projectMaterial.delete({ where: { id: row.id } });
}
