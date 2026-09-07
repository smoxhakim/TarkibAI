import { prisma } from '@/lib/db';
import { assertProjectAccess } from '@/lib/projects/service';
import { readCutDefaults, readMinUsableRemnant } from '@/lib/calc/cutting/schema';
import {
  recommendBarAlternatives,
  recommendRotation,
  recommendSheetAlternatives,
  type CandidateBar,
  type CandidateSheet,
  type Recommendation,
} from './engine';

/**
 * Recommendations are computed on demand and never stored.
 *
 * A stored saving goes stale the moment a price, a piece list or a material
 * changes, and stale financial advice is worse than none. Recomputing is cheap
 * — it is the same engines the plans already run.
 */
export type ProjectRecommendations = {
  recommendations: Recommendation[];
  /** Set when nothing could be compared, with the reason. */
  emptyReason: string | null;
};

export async function getRecommendations(
  projectId: string,
  userId: string
): Promise<ProjectRecommendations> {
  await assertProjectAccess(projectId, userId);

  const [pieces, cuts, materials] = await Promise.all([
    prisma.cuttingPiece.findMany({ where: { projectId } }),
    prisma.linearCut.findMany({ where: { projectId } }),
    // Only the user's own library. Suggesting stock they do not buy would be
    // inventing supplier availability.
    prisma.material.findMany({ where: { userId, archivedAt: null } }),
  ]);

  if (pieces.length === 0 && cuts.length === 0) {
    return {
      recommendations: [],
      emptyReason:
        'Add the pieces or cut lengths for this project first — savings are computed from what you actually need to cut.',
    };
  }

  const recommendations: Recommendation[] = [];

  /* ---- Sheet materials ---------------------------------------------------- */

  const sheetCandidates: CandidateSheet[] = materials
    .filter((material) => material.measurementModel === 'sheet' && material.sheetWidthMm && material.sheetHeightMm)
    .map((material) => {
      const defaults = readCutDefaults(material.technicalProperties);
      return {
        materialId: material.id,
        name: material.name,
        sheetWidthMm: material.sheetWidthMm as number,
        sheetHeightMm: material.sheetHeightMm as number,
        unitPriceCents: material.unitPriceCents,
        kerfMm: defaults.kerfMm,
        edgeMarginMm: defaults.edgeMarginMm,
      };
    });

  const pieceMaterialIds = [...new Set(pieces.map((piece) => piece.materialId))];
  for (const materialId of pieceMaterialIds) {
    const current = sheetCandidates.find((candidate) => candidate.materialId === materialId);
    if (!current) continue;

    const materialPieces = pieces
      .filter((piece) => piece.materialId === materialId)
      .map((piece) => ({
        id: piece.id,
        label: piece.label,
        widthMm: piece.widthMm,
        heightMm: piece.heightMm,
        quantity: piece.quantity,
        allowRotation: piece.allowRotation,
      }));

    recommendations.push(...recommendSheetAlternatives(current, sheetCandidates, materialPieces));

    const rotation = recommendRotation(current, materialPieces);
    if (rotation) recommendations.push(rotation);
  }

  /* ---- Linear materials --------------------------------------------------- */

  const barCandidates: CandidateBar[] = materials
    .filter((material) => material.measurementModel === 'linear' && material.standardLengthMm)
    .map((material) => {
      const defaults = readCutDefaults(material.technicalProperties);
      return {
        materialId: material.id,
        name: material.name,
        standardLengthMm: material.standardLengthMm as number,
        unitPriceCents: material.unitPriceCents,
        kerfMm: defaults.kerfMm,
        minUsableRemnantMm: readMinUsableRemnant(material.technicalProperties),
      };
    });

  const cutMaterialIds = [...new Set(cuts.map((cut) => cut.materialId))];
  for (const materialId of cutMaterialIds) {
    const current = barCandidates.find((candidate) => candidate.materialId === materialId);
    if (!current) continue;

    const materialCuts = cuts
      .filter((cut) => cut.materialId === materialId)
      .map((cut) => ({ id: cut.id, label: cut.label, lengthMm: cut.lengthMm, quantity: cut.quantity }));

    recommendations.push(...recommendBarAlternatives(current, barCandidates, materialCuts));
  }

  recommendations.sort((a, b) => b.savingCents - a.savingCents);

  return {
    recommendations,
    emptyReason:
      recommendations.length === 0
        ? 'No cheaper option was found in your material library for what this project needs.'
        : null,
  };
}

/**
 * Applies a recommendation by switching the project's pieces or cuts to the
 * alternative material.
 *
 * This is the "recalculate after approval" step: the click IS the approval, and
 * the change is a plain deterministic reassignment. Any existing cutting plan
 * for the old material is removed rather than left behind, since it describes a
 * material the project no longer uses.
 */
export async function applyMaterialSwitch(
  projectId: string,
  userId: string,
  fromMaterialId: string,
  toMaterialId: string
): Promise<void> {
  await assertProjectAccess(projectId, userId);

  // Both materials must belong to this user.
  const [from, to] = await Promise.all([
    prisma.material.findUnique({ where: { id: fromMaterialId } }),
    prisma.material.findUnique({ where: { id: toMaterialId } }),
  ]);
  if (!from || from.userId !== userId || !to || to.userId !== userId) {
    const { notFound } = await import('@/lib/http/api');
    throw notFound('Material');
  }
  if (from.measurementModel !== to.measurementModel) {
    const { badRequest } = await import('@/lib/http/api');
    throw badRequest('A material can only be swapped for one measured the same way.');
  }

  await prisma.$transaction([
    prisma.cuttingPiece.updateMany({
      where: { projectId, materialId: fromMaterialId },
      data: { materialId: toMaterialId },
    }),
    prisma.linearCut.updateMany({
      where: { projectId, materialId: fromMaterialId },
      data: { materialId: toMaterialId },
    }),
    prisma.projectMaterial.updateMany({
      where: { projectId, materialId: fromMaterialId },
      data: { materialId: toMaterialId, calculatedAt: null, unitsToPurchase: null, totalCostCents: null },
    }),
    // The old plan describes stock the project no longer uses.
    prisma.cuttingPlan.deleteMany({ where: { projectId, materialId: fromMaterialId } }),
  ]);
}
