import { prisma } from '@/lib/db';
import { assertProjectAccess, hasProjectPermission } from '@/lib/projects/service';
import { getDomain } from '@/lib/domains/registry';
import { getSpec } from '@/lib/spec/service';
import { listProjectMaterials } from '@/lib/materials/service';
import { readCostReadiness } from '@/lib/calc/costs/service';
import { getScene } from '@/lib/canvas/service';
import { listLinearPlans, listPlans } from '@/lib/calc/cutting/service';
import {
  FINANCIAL_FINDING_CODES,
  PRODUCTION_BLOCKING_CODES,
  QUOTE_BLOCKING_CODES,
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

/** Gathers every check over the project's real state. */
export async function getIntegrityReport(
  projectId: string,
  userId: string
): Promise<IntegrityReport> {
  const project = await assertProjectAccess(projectId, userId);
  const domain = getDomain(project.domain);

  // Only decides which FINDINGS this reader may see. It must not decide which
  // checks RUN: a check that is skipped is a blocker that does not exist, and
  // the gates below are built from these findings.
  const canSeeCost = await hasProjectPermission(projectId, userId, 'cost.view');

  const [spec, materialRows, costReadiness, sceneView, sheetPlans, linearPlans] = await Promise.all([
    getSpec(projectId, userId),
    listProjectMaterials(projectId, userId),
    // Read for everyone, and deliberately not through `getProjectCost`: this
    // returns whether the cost exists and whether it is current, with no
    // amounts, so the checks can run for a caller who may not see the figures.
    readCostReadiness(projectId),
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
    ...checkDimensions(spec.spec, domain),

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

    // Always. `cost.stale` and `cost.missing` are the two findings that stop a
    // quote going out on superseded figures, and neither states an amount —
    // they say the cost is out of date or absent. Running them only for readers
    // who may see the figures made the gate depend on the audience.
    ...checkCost(costReadiness),

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

  // Visibility, applied AFTER every check has run. The order matters: a check
  // that never runs is a blocker that does not exist, which is how a hidden
  // cost made a quote issuable. Here the checks have all happened, and only the
  // presentation narrows.
  //
  // Safe to do before the blockers are selected because nothing in the hidden
  // set gates a document — `financialCodesThatGate()` asserts that, so the rule
  // is checked rather than remembered.
  //
  // Hiding by AREA is what was not enough: a finding can be about a price while
  // belonging to another area, which is how "priced at zero" reached roles the
  // cost boundary excludes. Financial findings are named explicitly instead.
  const visible = canSeeCost
    ? findings
    : findings.filter((finding) => !FINANCIAL_FINDING_CODES.has(finding.code));

  const sorted = sortFindings(visible);
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
