import { prisma } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess, assertProjectPermission } from '@/lib/projects/service';
import { parseScene } from '@/lib/canvas/schema';
import type { Prisma, ProjectVersion } from '@/generated/prisma/client';
import {
  readCanvasSnapshot,
  readCostSnapshot,
  readMaterialsSnapshot,
  readReferenceSnapshot,
  readSpecSnapshot,
  type SnapshotCanvasObject,
  type SnapshotCost,
  type SnapshotMaterial,
  type SnapshotReferences,
  type VersionSnapshot,
} from './snapshot';
import { diffSnapshots, type VersionDiff } from './diff';
import { recordAudit } from '@/lib/audit/service';

/** Why a version was recorded. */
export const VERSION_REASONS = [
  'spec_approved',
  'design_approved',
  'quote_issued',
  'production_generated',
  'manual',
  'restored',
] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  spec_approved: 'Specification approved',
  design_approved: 'Design approved',
  quote_issued: 'Quote issued',
  production_generated: 'Production package generated',
  manual: 'Saved by you',
  restored: 'Restored from an earlier version',
};

/** A database client or an open transaction — snapshots are often taken inside one. */
type Db = Prisma.TransactionClient | typeof prisma;

/* -------------------------------------------------------------------------- */
/* Capturing                                                                   */
/* -------------------------------------------------------------------------- */

/** Decimal columns become strings so JSON cannot round away a digit. */
const decimal = (value: unknown): string | null =>
  value === null || value === undefined ? null : value.toString();

/**
 * Reads the project's current state into snapshot form.
 *
 * Everything is copied as it stands. Nothing is recomputed, so a version stays
 * reviewable even after the engines that produced its numbers have changed.
 */
export async function captureSnapshot(
  projectId: string,
  db: Db = prisma
): Promise<{
  spec: Record<string, unknown>;
  specVersion: number | null;
  specApproved: boolean;
  canvas: SnapshotCanvasObject[] | null;
  materials: SnapshotMaterial[];
  cost: SnapshotCost | null;
  references: SnapshotReferences;
}> {
  const [specRow, scene, materialRows, costRow, projectRow, drawings, quotes, documents] = await Promise.all([
    db.projectSpec.findFirst({ where: { projectId }, orderBy: { version: 'desc' } }),
    db.canvasScene.findUnique({ where: { projectId } }),
    db.projectMaterial.findMany({
      where: { projectId },
      include: { material: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.projectCost.findFirst({ where: { projectId }, orderBy: { computedAt: 'desc' } }),
    db.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } }),
    db.diagram.findMany({ where: { projectId }, select: { version: true }, orderBy: { version: 'asc' } }),
    db.quote.findMany({
      where: { projectId, status: 'issued' },
      select: { number: true },
      orderBy: { sequence: 'asc' },
    }),
    db.document.findMany({
      where: { projectId, type: 'production' },
      select: { version: true },
      orderBy: { version: 'asc' },
    }),
  ]);

  return {
    spec: readSpecSnapshot(specRow?.data ?? {}),
    specVersion: specRow?.version ?? null,
    specApproved: specRow?.status === 'approved',

    // Null rather than an empty list when the project has no canvas at all: an
    // absent scene and an emptied scene are different facts, and the diff says
    // so instead of reporting every object as removed.
    canvas: scene ? parseScene(scene.data).objects.map((object) => ({
      id: object.id,
      type: object.type,
      label: object.label ?? null,
      x: object.x,
      y: object.y,
      widthMm: object.widthMm,
      heightMm: object.heightMm,
      depthMm: object.depthMm ?? null,
    })) : null,

    materials: materialRows.map((row) => ({
      materialId: row.materialId,
      name: row.material.name,
      role: row.role,
      requiredQuantity: decimal(row.requiredQuantity),
      unitsToPurchase: row.unitsToPurchase,
      totalPurchasedQuantity: decimal(row.totalPurchasedQuantity),
      wastePercent: decimal(row.wastePercent),
      unsupportedReason: row.unsupportedReason,
    })),

    cost: costRow
      ? {
          materialsCostCents: costRow.materialsCostCents,
          laborCostCents: costRow.laborCostCents,
          transportCostCents: costRow.transportCostCents,
          installCostCents: costRow.installCostCents,
          otherCostCents: costRow.otherCostCents,
          internalTotalCents: costRow.internalTotalCents,
          marginCents: costRow.marginCents,
          clientSubtotalCents: costRow.clientSubtotalCents,
          taxCents: costRow.taxCents,
          clientTotalCents: costRow.clientTotalCents,
          computedAt: costRow.computedAt.toISOString(),
          currency: projectRow
            ? (await db.costSettings.findUnique({
                where: { workspaceId: projectRow.workspaceId },
                select: { currency: true },
              }))?.currency ?? null
            : null,
        }
      : null,

    references: {
      specVersion: specRow?.version ?? null,
      specApproved: specRow?.status === 'approved',
      drawingVersions: drawings.map((drawing) => drawing.version),
      quoteNumbers: quotes.map((quote) => quote.number),
      productionVersions: documents.map((document) => document.version),
    },
  };
}

/**
 * Records a version of the project as it stands.
 *
 * Takes an optional transaction client so a version can be written in the same
 * transaction as the thing that caused it — an approved specification must
 * never exist without the snapshot that records it.
 */
export async function recordVersion(
  projectId: string,
  input: { reason: VersionReason; label: string; note?: string | null },
  db: Db = prisma
): Promise<ProjectVersion> {
  const snapshot = await captureSnapshot(projectId, db);

  const last = await db.projectVersion.findFirst({
    where: { projectId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });

  return db.projectVersion.create({
    data: {
      projectId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      label: input.label,
      reason: input.reason,
      note: input.note?.trim() || null,
      specSnapshot: snapshot.spec as object,
      canvasSnapshot: snapshot.canvas as unknown as object,
      materialsSnapshot: snapshot.materials as unknown as object,
      costSnapshot: snapshot.cost as unknown as object,
      referenceSnapshot: snapshot.references as unknown as object,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export type VersionView = {
  id: string;
  versionNumber: number;
  label: string;
  reason: string;
  reasonLabel: string;
  note: string | null;
  createdAt: Date;
  snapshot: VersionSnapshot;
  /** Documents that name this version as the state they came from. */
  producedQuoteNumbers: string[];
  producedPackageVersions: number[];
};

function toSnapshot(version: ProjectVersion): VersionSnapshot {
  return {
    spec: readSpecSnapshot(version.specSnapshot),
    canvas: readCanvasSnapshot(version.canvasSnapshot),
    materials: readMaterialsSnapshot(version.materialsSnapshot),
    cost: readCostSnapshot(version.costSnapshot),
    references: readReferenceSnapshot(version.referenceSnapshot),
  };
}

function reasonLabel(reason: string): string {
  return VERSION_REASON_LABELS[reason as VersionReason] ?? reason;
}

export async function listVersions(projectId: string, userId: string): Promise<VersionView[]> {
  await assertProjectAccess(projectId, userId);

  const versions = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { versionNumber: 'desc' },
    include: {
      quotes: { select: { number: true, status: true } },
      documents: { select: { version: true } },
    },
  });

  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    label: version.label,
    reason: version.reason,
    reasonLabel: reasonLabel(version.reason),
    note: version.note,
    createdAt: version.createdAt,
    snapshot: toSnapshot(version),
    producedQuoteNumbers: version.quotes.map((quote) => quote.number),
    producedPackageVersions: version.documents.map((document) => document.version),
  }));
}

async function loadVersion(versionId: string, userId: string): Promise<ProjectVersion> {
  const version = await prisma.projectVersion.findUnique({ where: { id: versionId } });
  if (!version) throw notFound('Version');
  await assertProjectAccess(version.projectId, userId);
  return version;
}

export async function getVersion(versionId: string, userId: string): Promise<VersionView> {
  const version = await loadVersion(versionId, userId);
  const [quotes, documents] = await Promise.all([
    prisma.quote.findMany({ where: { projectVersionId: versionId }, select: { number: true } }),
    prisma.document.findMany({ where: { projectVersionId: versionId }, select: { version: true } }),
  ]);

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    label: version.label,
    reason: version.reason,
    reasonLabel: reasonLabel(version.reason),
    note: version.note,
    createdAt: version.createdAt,
    snapshot: toSnapshot(version),
    producedQuoteNumbers: quotes.map((quote) => quote.number),
    producedPackageVersions: documents.map((document) => document.version),
  };
}

export type ComparisonView = {
  from: { id: string; versionNumber: number; label: string; createdAt: Date };
  to: { id: string; versionNumber: number; label: string; createdAt: Date } | null;
  /** Null when comparing the newest version against the project as it stands. */
  toIsCurrent: boolean;
  diff: VersionDiff;
};

/**
 * Compares two versions, or a version against the project as it stands now.
 *
 * Comparing against the present is the question a user usually has — "what has
 * moved since we approved this?" — and it needs no version to have been
 * recorded for the current state.
 */
export async function compareVersions(
  projectId: string,
  userId: string,
  input: { fromId: string; toId?: string | null }
): Promise<ComparisonView> {
  await assertProjectAccess(projectId, userId);

  const from = await loadVersion(input.fromId, userId);
  if (from.projectId !== projectId) throw notFound('Version');

  if (!input.toId) {
    const current = await captureSnapshot(projectId);
    return {
      from: { id: from.id, versionNumber: from.versionNumber, label: from.label, createdAt: from.createdAt },
      to: null,
      toIsCurrent: true,
      diff: diffSnapshots(toSnapshot(from), {
        spec: current.spec,
        canvas: current.canvas,
        materials: current.materials,
        cost: current.cost,
        references: current.references,
      }),
    };
  }

  if (input.toId === input.fromId) {
    throw badRequest('Choose two different versions to compare.');
  }

  const to = await loadVersion(input.toId, userId);
  if (to.projectId !== projectId) throw notFound('Version');

  return {
    from: { id: from.id, versionNumber: from.versionNumber, label: from.label, createdAt: from.createdAt },
    to: { id: to.id, versionNumber: to.versionNumber, label: to.label, createdAt: to.createdAt },
    toIsCurrent: false,
    diff: diffSnapshots(toSnapshot(from), toSnapshot(to)),
  };
}

/* -------------------------------------------------------------------------- */
/* Restoring                                                                   */
/* -------------------------------------------------------------------------- */

export type RestorePreview = {
  version: { id: string; versionNumber: number; label: string };
  /** What restoring would change, against the project as it stands. */
  diff: VersionDiff;
  /** Consequences the user should read before confirming. */
  consequences: string[];
  blockers: string[];
};

const RESTORE_CONSEQUENCES = [
  'The restored specification becomes a new DRAFT. It is not approved, and approving it is a separate step.',
  'Material calculations and costs are not restored. They will be marked stale, because their numbers came from the specification you are moving away from.',
  'Quotes and production packages already issued are untouched. They keep the state they were built from.',
  'Nothing is deleted. A new version records the restore, and the version you restored from stays where it is.',
];

/** Shows what restoring would do, without doing it. */
export async function previewRestore(versionId: string, userId: string): Promise<RestorePreview> {
  const version = await loadVersion(versionId, userId);
  const current = await captureSnapshot(version.projectId);
  const snapshot = toSnapshot(version);

  const blockers: string[] = [];
  if (Object.keys(snapshot.spec).length === 0) {
    blockers.push('This version has no specification snapshot, so there is nothing to restore.');
  }

  return {
    version: { id: version.id, versionNumber: version.versionNumber, label: version.label },
    diff: diffSnapshots(
      {
        spec: current.spec,
        canvas: current.canvas,
        materials: current.materials,
        cost: current.cost,
        references: current.references,
      },
      snapshot
    ),
    consequences: RESTORE_CONSEQUENCES,
    blockers,
  };
}

/**
 * Restores a version's specification and canvas.
 *
 * Append-only. The restored specification is written as a NEW draft rather than
 * over the approved record, and a new version records that the restore
 * happened. Rewriting history would break the one promise the version system
 * makes: that a document can be traced to the state that produced it.
 *
 * Calculations are deliberately not restored. Their numbers were derived from
 * the specification being moved away from; writing them back would present
 * figures that no longer follow from the project. They go stale instead, which
 * the material and cost panels already detect and report.
 *
 * # Why `project.edit`
 *
 * Reading the timeline is open to every member — a worker must be able to see
 * what the job used to be. Restoring is a WRITE, and a broad one: it writes a
 * new draft `ProjectSpec`, discards the current `CanvasScene`, and puts the
 * project back to `intake`.
 *
 * It crosses two domains, because the canvas it overwrites is `design.edit`
 * territory while the specification it writes is `project.edit`. One capability
 * can govern it safely because `design.edit ⊆ project.edit` is asserted in the
 * matrix, and the specification is the artefact being restored — the canvas
 * follows it, exactly as the transaction below says.
 */
export async function restoreVersion(versionId: string, userId: string): Promise<ProjectVersion> {
  const version = await loadVersion(versionId, userId);
  // Before the snapshot is read and before the empty-snapshot guard, so a
  // member without the permission cannot tell a restorable version from one
  // with nothing in it. `loadVersion` has already made another workspace's
  // version a 404; this is the 403 for a colleague who may look and not act.
  await assertProjectPermission(version.projectId, userId, 'project.edit');

  const snapshot = toSnapshot(version);

  if (Object.keys(snapshot.spec).length === 0) {
    throw badRequest('This version has no specification snapshot, so there is nothing to restore.');
  }

  const recorded = await prisma.$transaction(async (tx) => {
    const latestSpec = await tx.projectSpec.findFirst({
      where: { projectId: version.projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    await tx.projectSpec.create({
      data: {
        projectId: version.projectId,
        version: (latestSpec?.version ?? 0) + 1,
        status: 'draft',
        data: snapshot.spec as object,
      },
    });

    // The canvas follows the specification. Leaving the current design against
    // a restored specification would put the two out of step with nothing
    // saying so.
    if (snapshot.canvas !== null) {
      const scene = { sceneVersion: 1, objects: snapshot.canvas };
      await tx.canvasScene.upsert({
        where: { projectId: version.projectId },
        update: { data: scene as unknown as object },
        create: { projectId: version.projectId, data: scene as unknown as object },
      });
    }

    // The project is back to an unapproved specification, so it is back at
    // intake. Later stages describe state that no longer holds.
    await tx.project.update({
      where: { id: version.projectId },
      data: { status: 'intake' },
    });

    return recordVersion(
      version.projectId,
      {
        reason: 'restored',
        label: `Restored from version ${version.versionNumber}`,
        note: version.label,
      },
      tx
    );
  });

  await recordAudit({
    userId,
    projectId: version.projectId,
    action: 'version.restored',
    summary: `Restored the project from version ${version.versionNumber} (${version.label}).`,
    detail: { restoredFromVersionId: version.id, newVersionId: recorded.id },
  });

  return recorded;
}
