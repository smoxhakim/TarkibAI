import { prisma } from '@/lib/db';
import { assertProjectAccess, hasProjectPermission } from '@/lib/projects/service';
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
/** One side of a comparison, with the money withheld where it must be. */
export type EfficiencyOutcomeView = {
  materialId: string;
  name: string;
  stockUnits: number;
  wastePercent: number;
  /** Null for a reader without `cost.view`. */
  totalCostCents: number | null;
  unplacedCount: number;
};

export type RecommendationView = {
  kind: Recommendation['kind'];
  current: EfficiencyOutcomeView;
  alternative: EfficiencyOutcomeView;
  /** Null for a reader without `cost.view`. */
  savingCents: number | null;
  savingUnits: number;
  wasteReductionPercent: number;
  /** Rebuilt from units and waste when the money has been withheld. */
  summary: string;
};

export type ProjectRecommendations = {
  recommendations: RecommendationView[];
  /** Whether this reader was given the money. Lets a renderer say so honestly. */
  showsPrices: boolean;
  /** Set when nothing could be compared, with the reason. */
  emptyReason: string | null;
};

/**
 * A recommendation as the caller may see it.
 *
 * The engine's own `summary` quotes both totals — `money()` builds it that way
 * — so it cannot be forwarded to a reader without `cost.view`; it is REPLACED
 * by one built from the units and the waste, which is the part a production
 * role can act on. Everything monetary is set to null rather than deleted, the
 * same shape the purchase plan uses (T20), so a renderer that forgets to check
 * shows nothing instead of showing a leftover figure.
 */
function toView(recommendation: Recommendation, showPrices: boolean): RecommendationView {
  const outcome = (side: Recommendation['current']): EfficiencyOutcomeView => ({
    materialId: side.materialId,
    name: side.name,
    stockUnits: side.stockUnits,
    wastePercent: side.wastePercent,
    totalCostCents: showPrices ? side.totalCostCents : null,
    unplacedCount: side.unplacedCount,
  });

  const { current, alternative } = recommendation;

  return {
    kind: recommendation.kind,
    current: outcome(current),
    alternative: outcome(alternative),
    savingCents: showPrices ? recommendation.savingCents : null,
    savingUnits: recommendation.savingUnits,
    wasteReductionPercent: recommendation.wasteReductionPercent,
    summary: showPrices
      ? recommendation.summary
      : `${alternative.name}: ${alternative.stockUnits} stock unit(s) instead of ` +
        `${current.stockUnits}, waste ${current.wastePercent}% → ${alternative.wastePercent}%.`,
  };
}

/**
 * Efficiency recommendations for a project.
 *
 * # Why the money is withheld here rather than in the panel
 *
 * A recommendation is a price comparison: the saving, both totals, and a
 * summary sentence that quotes them. All of that is internal cost, so it is
 * governed by `cost.view` like every other internal figure (T18). Deciding that
 * in the component would mean the API route still answered with the amounts,
 * and a reader without the permission could simply call it.
 *
 * It degrades rather than refusing, because what is left after the money is
 * removed is genuinely useful to the roles that lack `cost.view`: fewer sheets
 * and less waste are the production manager's problem, and they can act on
 * "three bars instead of four" without knowing what a bar costs.
 */
export async function getRecommendations(
  projectId: string,
  userId: string
): Promise<ProjectRecommendations> {
  await assertProjectAccess(projectId, userId);
  const showPrices = await hasProjectPermission(projectId, userId, 'cost.view');

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
      showsPrices: showPrices,
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

  // Ranked by the real saving before the money is removed, so a reader without
  // cost.view still gets the best option first.
  recommendations.sort((a, b) => b.savingCents - a.savingCents);

  return {
    recommendations: recommendations.map((recommendation) => toView(recommendation, showPrices)),
    showsPrices: showPrices,
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
