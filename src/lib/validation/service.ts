import { prisma } from '@/lib/db';
import { assertProjectAccess } from '@/lib/projects/service';
import { getSpec } from '@/lib/spec/service';
import { listProjectMaterials } from '@/lib/materials/service';
import { getProjectCost } from '@/lib/calc/costs/service';
import { getScene } from '@/lib/canvas/service';
import { listLinearPlans, listPlans } from '@/lib/calc/cutting/service';
import {
  checkCalculations,
  checkCost,
  checkCutting,
  checkDesign,
  checkDimensions,
  checkMaterials,
  sortFindings,
  summarise,
  type Finding,
  type FindingSummary,
} from './checks';

/**
 * The project's integrity report, and the safeguards built on it.
 *
 * One place that asks every question at once. Each engine already reports its
 * own caveats where it lives; what was missing was somewhere a user could see
 * the whole picture before committing to a document, and somewhere the system
 * could refuse to produce one from figures it knows are superseded.
 */

export type IntegrityReport = {
  findings: Finding[];
  summary: FindingSummary;
  /** What the project is currently safe to produce. */
  readiness: {
    quote: { ready: boolean; blockers: Finding[] };
    production: { ready: boolean; blockers: Finding[] };
  };
};

/**
 * Findings that make a priced document wrong.
 *
 * A quote's price rests on every material line being current and complete. A
 * line that is stale, missing or uncalculable means the total is missing
 * something, and the client would be quoted a number the system knows is not
 * the project's.
 */
const QUOTE_BLOCKING_CODES = new Set([
  'calculation.stale',
  'calculation.missing',
  'calculation.unsupported',
  'material.missing_stock_size',
  'cost.stale',
  'cost.missing',
]);

/**
 * Findings that make a workshop sheet wrong.
 *
 * Deliberately narrower. A package may be built from a drawing alone, and T14
 * prints what it does not contain rather than refusing — absent data is a gap,
 * stated on the document. What is blocked here is data that is present and
 * WRONG: figures superseded by a later change, and pieces the optimiser could
 * not place, which a plan would otherwise imply are being cut.
 */
const PRODUCTION_BLOCKING_CODES = new Set([
  'calculation.stale',
  'calculation.unsupported',
  'cutting.unplaced',
]);

/** Gathers every check over the project's real state. */
export async function getIntegrityReport(
  projectId: string,
  userId: string
): Promise<IntegrityReport> {
  await assertProjectAccess(projectId, userId);

  const [spec, materialRows, costView, sceneView, sheetPlans, linearPlans] = await Promise.all([
    getSpec(projectId, userId),
    listProjectMaterials(projectId, userId),
    getProjectCost(projectId, userId),
    getScene(projectId, userId),
    listPlans(projectId, userId),
    listLinearPlans(projectId, userId),
  ]);

  const library = materialRows.length
    ? await prisma.material.findMany({
        where: { id: { in: materialRows.map((row) => row.materialId) } },
      })
    : [];
  const byId = new Map(library.map((material) => [material.id, material]));

  const findings: Finding[] = [
    ...checkDimensions(spec.spec),

    ...checkMaterials(
      materialRows.map((row) => {
        const material = byId.get(row.materialId);
        return {
          name: row.name,
          measurementModel: row.measurementModel,
          archived: material?.archivedAt !== null && material?.archivedAt !== undefined,
          standardLengthMm: material?.standardLengthMm ?? null,
          sheetWidthMm: material?.sheetWidthMm ?? null,
          sheetHeightMm: material?.sheetHeightMm ?? null,
          unitPriceCents: material?.unitPriceCents ?? 0,
          hasRequirement: row.requiredQuantity !== null,
        };
      })
    ),

    // Only lines with a stated requirement are checked for calculation: a line
    // with no quantity is already reported by checkMaterials, and reporting it
    // twice would make the list read as worse than it is.
    ...checkCalculations(
      materialRows
        .filter((row) => row.requiredQuantity !== null)
        .map((row) => ({
          name: row.name,
          calculated: row.calculatedAt !== null,
          staleReasons: row.staleReasons,
          unsupportedReason: row.unsupportedReason,
          warnings: row.warnings.map((warning) => warning.message),
        }))
    ),

    ...checkCost({
      exists: costView.cost !== null,
      stale: costView.stale,
      blockedReason: costView.blockedReason,
    }),

    ...checkDesign({
      hasScene: sceneView.scene.objects.length > 0,
      diverged: sceneView.diverged,
    }),

    ...checkCutting(
      [...sheetPlans, ...linearPlans]
        .filter((entry) => entry.plan !== null)
        .map((entry) => ({
          materialName:
            byId.get(entry.plan!.materialId)?.name ??
            materialRows.find((row) => row.materialId === entry.plan!.materialId)?.name ??
            'a material',
          unplacedCount: entry.plan!.unplacedCount,
        }))
    ),
  ];

  const sorted = sortFindings(findings);
  const quoteBlockers = sorted.filter(
    (finding) => finding.severity === 'blocker' && QUOTE_BLOCKING_CODES.has(finding.code)
  );
  const productionBlockers = sorted.filter(
    (finding) => finding.severity === 'blocker' && PRODUCTION_BLOCKING_CODES.has(finding.code)
  );

  return {
    findings: sorted,
    summary: summarise(sorted),
    readiness: {
      quote: { ready: quoteBlockers.length === 0, blockers: quoteBlockers },
      production: { ready: productionBlockers.length === 0, blockers: productionBlockers },
    },
  };
}

/**
 * The blockers standing between a project and one kind of document.
 *
 * Used by the issue and generate gates. Kept separate from the full report so
 * a gate pays for the checks it needs and nothing else reads as a side effect.
 */
export async function blockersFor(
  purpose: 'quote' | 'production',
  projectId: string,
  userId: string
): Promise<Finding[]> {
  const report = await getIntegrityReport(projectId, userId);
  return report.readiness[purpose].blockers;
}

/** One sentence per blocker, for an error message. */
export function describeBlockers(blockers: Finding[]): string {
  return blockers
    .map((blocker) => (blocker.action ? `${blocker.message} ${blocker.action}` : blocker.message))
    .join(' ');
}
