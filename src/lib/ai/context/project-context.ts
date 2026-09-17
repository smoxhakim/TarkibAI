import { prisma } from '@/lib/db';
import { getScene } from '@/lib/canvas/service';
import { listProjectMaterials } from '@/lib/materials/service';
import { getProjectCost } from '@/lib/calc/costs/service';
import { FIELD_LABELS, type SpecFieldKey } from '@/lib/spec/completeness';
import { isVisionMimeType } from '@/lib/files/schema';
import type { SpecView } from '@/lib/spec/service';
import { grantsFor, type AiGrants, type ProjectAiAccess } from '../access';

/**
 * A bounded, cross-domain picture of what the project ALREADY HAS.
 *
 * # Why this exists
 *
 * Until T21 the only project state the agent ever saw was the specification.
 * Everything the platform had learned since — which materials are selected, how
 * many sheets the engine says to buy, whether a cost is current, whether a quote
 * exists, whether the workshop package is blocked — was invisible to it. The
 * agent therefore could not do the one thing the milestone asks for: EXPLAIN a
 * deterministic result instead of inventing one. Asked "ch7al mn plaque?" it had
 * no way to reach the answer the material engine had already computed and
 * stored.
 *
 * # Why it is a summary and not the project
 *
 * Dumping every row into every turn would be expensive, would push the real
 * question down the context, and would go stale the moment a tool ran. So this
 * carries EXISTENCE and STATUS — what there is, whether it is current, what is
 * missing — and the tools carry the figures. The agent reads the snapshot to
 * decide whether a question is answerable, then calls the tool that owns the
 * number. That keeps a turn's fixed cost small and puts every authoritative
 * figure behind a deterministic service.
 *
 * # Why it is permission-aware
 *
 * The snapshot is assembled per caller, not per project. A role without
 * `cost.view` does not get a cost section that says "hidden"; it does not get a
 * cost section at all, and the cost row is never read from the database for
 * them. Data that is never fetched cannot leak through a field somebody adds
 * later — the same rule the cost service and the client-safe quote boundary
 * already follow.
 */

/** How many material lines are listed before the rest are summarised. */
const MAX_MATERIAL_LINES = 12;
/** How many reference files are named before the rest are counted. */
const MAX_FILE_NAMES = 6;

export type MaterialLineSummary = {
  name: string;
  measurementModel: string;
  /** What the user said they need. Null when they have not said. */
  requiredQuantity: string | null;
  /** Deterministic result. Null until the engine has run. Never zero-filled. */
  unitsToPurchase: number | null;
  calculated: boolean;
  stale: boolean;
  unsupportedReason: string | null;
};

export type ProjectSnapshot = {
  title: string;
  /** Workflow stage from the Project row: intake, spec_approved, calculated… */
  stage: string;
  domainLabel: string;

  spec: {
    version: number;
    status: 'draft' | 'approved';
    complete: boolean;
    /** Human labels for what is still required, in domain order. */
    missingLabels: string[];
  };

  design: {
    objectCount: number;
    /** A newer specification was approved after the canvas was built from it. */
    diverged: boolean;
    seedBlockedReason: string | null;
  };

  materials: {
    selectedCount: number;
    calculatedCount: number;
    staleCount: number;
    lines: MaterialLineSummary[];
    /** Lines beyond MAX_MATERIAL_LINES, so the list can be honestly truncated. */
    omittedLineCount: number;
  };

  cutting: {
    sheetPlanCount: number;
    linearPlanCount: number;
    /** Pieces the optimiser could not place. Non-zero means a plan is incomplete. */
    unplacedCount: number;
  };

  /** Null when the caller's role may not see internal cost. Never redacted in place. */
  cost: {
    computed: boolean;
    stale: boolean;
    blockedReason: string | null;
  } | null;

  /** Null when the caller's role may not see quotations. */
  quotes: {
    count: number;
    statuses: string[];
  } | null;

  documents: {
    productionCount: number;
    issuedDrawingCount: number;
    mockupCount: number;
  };

  references: {
    imageCount: number;
    /** Names only — never a URL, never an object key. */
    imageNames: string[];
    otherFileCount: number;
  };
};

export type ProjectContext = {
  access: ProjectAiAccess;
  grants: AiGrants;
  snapshot: ProjectSnapshot;
};

/**
 * Reads the snapshot for one caller.
 *
 * `spec` is passed in rather than re-read: the conversation turn already needs
 * it for the specification state message, and reading it twice per turn would
 * be two round trips for one answer.
 */
export async function buildProjectContext(
  access: ProjectAiAccess,
  spec: SpecView
): Promise<ProjectContext> {
  const grants = grantsFor(access.role);
  const { projectId, userId } = access;

  const [project, sceneView, materialRows, plans, quotes, counts, files, costView] =
    await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { title: true, status: true },
      }),
      getScene(projectId, userId),
      listProjectMaterials(projectId, userId),
      prisma.cuttingPlan.findMany({
        where: { projectId },
        select: { kind: true, unplacedCount: true },
      }),
      // Not read at all for a role without quote visibility.
      grants.viewQuotes
        ? prisma.quote.findMany({ where: { projectId }, select: { status: true } })
        : Promise.resolve(null),
      Promise.all([
        prisma.document.count({ where: { projectId, type: 'production' } }),
        prisma.diagram.count({ where: { projectId } }),
        prisma.mockup.count({ where: { projectId, status: 'succeeded' } }),
      ]),
      prisma.file.findMany({
        where: { projectId, status: 'ready' },
        select: { originalName: true, mimeType: true },
        orderBy: { createdAt: 'desc' },
      }),
      // Same: never fetched for a role that may not see it.
      grants.viewCost ? getProjectCost(projectId, userId) : Promise.resolve(null),
    ]);

  const [productionCount, issuedDrawingCount, mockupCount] = counts;

  const lines: MaterialLineSummary[] = materialRows.map((row) => ({
    name: row.name,
    measurementModel: row.measurementModel,
    requiredQuantity: row.requiredQuantity,
    unitsToPurchase: row.unitsToPurchase,
    calculated: row.calculatedAt !== null,
    stale: row.staleReasons.length > 0,
    unsupportedReason: row.unsupportedReason,
  }));

  const imageFiles = files.filter((file) => isVisionMimeType(file.mimeType));

  return {
    access,
    grants,
    snapshot: {
      title: project.title,
      stage: project.status,
      domainLabel: access.domain.label,

      spec: {
        version: spec.version,
        status: spec.status,
        complete: spec.complete,
        missingLabels: spec.missing.map((key: SpecFieldKey) => FIELD_LABELS[key]),
      },

      design: {
        objectCount: sceneView.scene.objects.length,
        diverged: sceneView.diverged,
        seedBlockedReason: sceneView.seedBlockedReason,
      },

      materials: {
        selectedCount: lines.length,
        calculatedCount: lines.filter((line) => line.calculated).length,
        staleCount: lines.filter((line) => line.stale).length,
        lines: lines.slice(0, MAX_MATERIAL_LINES),
        omittedLineCount: Math.max(0, lines.length - MAX_MATERIAL_LINES),
      },

      cutting: {
        sheetPlanCount: plans.filter((plan) => plan.kind === 'sheet').length,
        linearPlanCount: plans.filter((plan) => plan.kind === 'linear').length,
        unplacedCount: plans.reduce((sum, plan) => sum + plan.unplacedCount, 0),
      },

      cost: costView
        ? {
            computed: costView.cost !== null,
            stale: costView.stale,
            blockedReason: costView.blockedReason,
          }
        : null,

      quotes: quotes ? { count: quotes.length, statuses: [...new Set(quotes.map((q) => q.status))] } : null,

      documents: { productionCount, issuedDrawingCount, mockupCount },

      references: {
        imageCount: imageFiles.length,
        imageNames: imageFiles.slice(0, MAX_FILE_NAMES).map((file) => file.originalName),
        otherFileCount: files.length - imageFiles.length,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

const line = (label: string, value: string) => `${label}: ${value}`;

function describeMaterialLine(entry: MaterialLineSummary): string {
  if (entry.unsupportedReason) {
    return `  - ${entry.name}: cannot be calculated (${entry.unsupportedReason})`;
  }
  if (!entry.calculated) {
    return entry.requiredQuantity === null
      ? `  - ${entry.name}: selected, no requirement recorded yet, NOT calculated`
      : `  - ${entry.name}: requirement recorded, NOT calculated yet`;
  }
  const units =
    entry.unitsToPurchase === null
      ? 'calculated'
      : `${entry.unitsToPurchase} to purchase (calculated)`;
  return `  - ${entry.name}: ${units}${entry.stale ? ' — SUPERSEDED, needs recalculating' : ''}`;
}

/**
 * The snapshot as the message the model reads.
 *
 * Pure, so what the agent is told can be asserted in a unit test without a
 * database or a model. Every number here came from the application; the closing
 * paragraph says so, because the difference between a figure the engines
 * produced and a figure the model produced is the whole point of the product.
 */
export function renderProjectState(snapshot: ProjectSnapshot): string {
  const parts: string[] = [
    'CURRENT PROJECT STATE (read from the application just now; chat history is not authoritative):',
    '',
    line('Project', `"${snapshot.title}" — trade: ${snapshot.domainLabel}, stage: ${snapshot.stage}`),
    line(
      'Specification',
      `v${snapshot.spec.version}, ${snapshot.spec.status}` +
        (snapshot.spec.complete
          ? ', every required field answered'
          : `, still missing: ${snapshot.spec.missingLabels.join(', ')}`)
    ),
  ];

  parts.push(
    line(
      'Design canvas',
      snapshot.design.objectCount === 0
        ? `empty${snapshot.design.seedBlockedReason ? ` — ${snapshot.design.seedBlockedReason}` : ''}`
        : `${snapshot.design.objectCount} object(s)` +
            (snapshot.design.diverged
              ? ' — BUILT FROM AN OLDER SPECIFICATION, it no longer matches the approved one'
              : '')
    )
  );

  if (snapshot.materials.selectedCount === 0) {
    parts.push(line('Materials', 'none selected for this project yet'));
  } else {
    parts.push(
      line(
        'Materials',
        `${snapshot.materials.selectedCount} selected, ${snapshot.materials.calculatedCount} calculated` +
          (snapshot.materials.staleCount > 0
            ? `, ${snapshot.materials.staleCount} superseded by a later change`
            : '')
      )
    );
    parts.push(...snapshot.materials.lines.map(describeMaterialLine));
    if (snapshot.materials.omittedLineCount > 0) {
      parts.push(`  - …and ${snapshot.materials.omittedLineCount} more line(s) not listed here.`);
    }
  }

  const { sheetPlanCount, linearPlanCount, unplacedCount } = snapshot.cutting;
  parts.push(
    line(
      'Cutting plans',
      sheetPlanCount + linearPlanCount === 0
        ? 'none computed'
        : `${sheetPlanCount} sheet, ${linearPlanCount} linear` +
            (unplacedCount > 0 ? ` — ${unplacedCount} piece(s) could NOT be placed` : '')
    )
  );

  if (snapshot.cost === null) {
    parts.push(
      'Cost: NOT VISIBLE TO THIS USER. Their role in this workspace cannot see internal cost, ' +
        'margin, purchase prices or savings. Never state one, never estimate one, and do not ' +
        'speculate about what it might be.'
    );
  } else if (snapshot.cost.blockedReason) {
    parts.push(line('Cost', `not computed — ${snapshot.cost.blockedReason}`));
  } else {
    parts.push(
      line(
        'Cost',
        snapshot.cost.computed
          ? snapshot.cost.stale
            ? 'computed, but SUPERSEDED by a later material calculation'
            : 'computed and current'
          : 'not computed yet'
      )
    );
  }

  if (snapshot.quotes !== null) {
    parts.push(
      line(
        'Quotes',
        snapshot.quotes.count === 0
          ? 'none'
          : `${snapshot.quotes.count} (${snapshot.quotes.statuses.join(', ')})`
      )
    );
  }

  parts.push(
    line(
      'Documents',
      `${snapshot.documents.issuedDrawingCount} issued drawing(s), ` +
        `${snapshot.documents.productionCount} production package(s), ` +
        `${snapshot.documents.mockupCount} mockup(s)`
    )
  );

  parts.push(
    line(
      'Reference files',
      snapshot.references.imageCount === 0
        ? `no images uploaded${snapshot.references.otherFileCount > 0 ? `, ${snapshot.references.otherFileCount} non-image file(s)` : ''}`
        : `${snapshot.references.imageCount} image(s): ${snapshot.references.imageNames.join(', ')}` +
            (snapshot.references.imageCount > snapshot.references.imageNames.length
              ? ', …'
              : '')
    )
  );

  parts.push(
    '',
    'Everything above is APPLICATION DATA produced by deterministic engines or recorded by the',
    'user. It tells you WHAT EXISTS, not the figures. When the user asks for a figure, call the',
    'tool that owns it and report what it returns, exactly. Never compute, adjust, round or',
    'estimate one of these numbers yourself.'
  );

  return parts.join('\n');
}
