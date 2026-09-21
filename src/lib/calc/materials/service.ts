import { prisma } from '@/lib/db';
import { ApiError, badRequest } from '@/lib/http/api';
import { assertProjectPermission, hasProjectPermission } from '@/lib/projects/service';
import { calculateMaterialLine, type MeasurementModel } from './engine';

/**
 * Runs the deterministic engine over a project's selected materials and
 * persists the results.
 *
 * Two guarantees this function is responsible for:
 *
 *  - It refuses to run before the specification is approved. Purchase
 *    quantities derived from an unapproved spec would be numbers nobody signed
 *    off (PRD §5.4), and the project stage machine expects spec_approved before
 *    calculated.
 *
 *  - A line the engine cannot support is stored with a reason and no numbers.
 *    Guessing would be worse than saying nothing.
 */
export type CalculationSummary = {
  calculatedLines: number;
  skippedLines: number;
  unsupportedLines: number;
  /**
   * The material total, or null when the caller may not see internal cost.
   *
   * Nullable rather than always-a-number because `cost.view` decides whether
   * it is populated, and the type is what forces a consumer to say what it
   * does when the figure is withheld. Null and zero are distinguishable: a
   * calculation where every line was skipped genuinely totals 0.
   */
  totalMaterialCostCents: number | null;
};

/**
 * Runs the material engine over the project and stores the results.
 *
 * # Two different permissions, deliberately not combined
 *
 * Running this is `project.edit`: it writes purchase counts, waste, snapshots
 * and the project's stage. SEEING the money it totals is `cost.view`. A
 * production manager holds the first and not the second, and that has to keep
 * working — they calculate what to buy without learning what it costs.
 *
 * So the calculation is never gated on `cost.view`; only the figure it returns
 * is. The per-line money is already withheld by `listProjectMaterials`; this
 * closes the summary, which the earlier cost-visibility pass did not cover.
 */
export async function calculateProjectMaterials(
  projectId: string,
  userId: string
): Promise<CalculationSummary> {
  await assertProjectPermission(projectId, userId, 'project.edit');
  const showTotal = await hasProjectPermission(projectId, userId, 'cost.view');

  const approvedSpec = await prisma.projectSpec.findFirst({
    where: { projectId, status: 'approved' },
    orderBy: { version: 'desc' },
  });

  if (!approvedSpec) {
    throw badRequest(
      'Approve the project specification before calculating materials. Quantities derived from an unapproved specification would not correspond to an agreed project.'
    );
  }

  const rows = await prisma.projectMaterial.findMany({
    where: { projectId },
    include: { material: true },
  });

  if (rows.length === 0) {
    throw badRequest('Select at least one material for this project before calculating.');
  }

  let calculatedLines = 0;
  let skippedLines = 0;
  let unsupportedLines = 0;
  let totalMaterialCostCents = 0;

  for (const row of rows) {
    // A line with no stated requirement is not an error — the user simply has
    // not said how much they need yet. It is left untouched and reported.
    if (row.requiredQuantity === null) {
      skippedLines += 1;
      continue;
    }

    const material = row.material;
    const result = calculateMaterialLine({
      measurementModel: material.measurementModel as MeasurementModel,
      requiredQuantity: Number(row.requiredQuantity),
      standardLengthMm: material.standardLengthMm,
      sheetWidthMm: material.sheetWidthMm,
      sheetHeightMm: material.sheetHeightMm,
      unitPriceCents: material.unitPriceCents,
    });

    if (!result.supported) {
      unsupportedLines += 1;
      await prisma.projectMaterial.update({
        where: { id: row.id },
        data: {
          unsupportedReason: result.reason,
          // Any previous result is cleared: a stale number next to an
          // "unsupported" message is worse than no number.
          unitsToPurchase: null,
          totalPurchasedQuantity: null,
          wasteQuantity: null,
          wastePercent: null,
          unitPriceCentsSnapshot: null,
          totalCostCents: null,
          calculatedAt: null,
          calculationInputs: undefined,
          specVersionAtCalculation: null,
        },
      });
      continue;
    }

    calculatedLines += 1;
    totalMaterialCostCents += result.totalCostCents;

    await prisma.projectMaterial.update({
      where: { id: row.id },
      data: {
        unitsToPurchase: result.unitsToPurchase,
        totalPurchasedQuantity: result.purchasedQuantity,
        wasteQuantity: result.wasteQuantity,
        wastePercent: result.wastePercent,
        unitPriceCentsSnapshot: material.unitPriceCents,
        totalCostCents: result.totalCostCents,
        calculatedAt: new Date(),
        specVersionAtCalculation: approvedSpec.version,
        unsupportedReason: null,
        // Snapshotting the stock dimensions and price keeps the stored
        // explanation truthful even if the material is edited afterwards.
        calculationInputs: {
          measurementModel: material.measurementModel,
          standardLengthMm: material.standardLengthMm,
          sheetWidthMm: material.sheetWidthMm,
          sheetHeightMm: material.sheetHeightMm,
          unitPriceCents: material.unitPriceCents,
          unit: result.unit,
          steps: result.steps,
          warnings: result.warnings,
        },
      },
    });
  }

  // Only advance the stage when something was actually calculated.
  if (calculatedLines > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'calculated' },
    });
  }

  return {
    calculatedLines,
    skippedLines,
    unsupportedLines,
    totalMaterialCostCents: showTotal ? totalMaterialCostCents : null,
  };
}

/** Thrown when a caller asks for results on a project that has none. */
export const noCalculation = () =>
  new ApiError(409, 'This project has no material calculation yet.', 'not_calculated');
