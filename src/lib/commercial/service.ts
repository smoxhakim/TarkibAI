import { prisma } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess, hasProjectPermission } from '@/lib/projects/service';
import { assertWorkspaceAccess, assertWorkspacePermission, type WorkspaceId } from '@/lib/workspaces/access';
import { can } from '@/lib/workspaces/permissions';
import { formatStockSize } from '@/lib/materials/format';
import { listProjectMaterials } from '@/lib/materials/service';
import { recordAudit } from '@/lib/audit/service';
import type { Supplier } from '@/generated/prisma/client';
import { calculateProfitability, summariseOutcomes, type Profitability, type QuoteOutcome } from './profitability';
import { groupPurchases, type PurchaseGroup } from './purchasing';
import type { SupplierPayload } from './schema';

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export async function listSuppliers(
  workspaceId: WorkspaceId,
  options: { includeArchived?: boolean } = {}
): Promise<Supplier[]> {
  return prisma.supplier.findMany({
    where: { workspaceId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: 'asc' },
  });
}

/** A supplier the caller may change. Managing them is part of the library. */
async function assertSupplierAccess(supplierId: string, userId: string): Promise<Supplier> {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw notFound('Supplier');
  await assertWorkspacePermission(supplier.workspaceId, userId, 'material.manage');
  return supplier;
}

export async function createSupplier(
  workspaceId: WorkspaceId,
  userId: string,
  input: SupplierPayload
): Promise<Supplier> {
  await assertWorkspacePermission(workspaceId, userId, 'material.manage');
  return prisma.supplier.create({ data: { workspaceId, ...input } });
}

export async function updateSupplier(
  supplierId: string,
  userId: string,
  input: SupplierPayload
): Promise<Supplier> {
  await assertSupplierAccess(supplierId, userId);
  return prisma.supplier.update({ where: { id: supplierId }, data: input });
}

export async function setSupplierArchived(
  supplierId: string,
  userId: string,
  archived: boolean
): Promise<Supplier> {
  const supplier = await assertSupplierAccess(supplierId, userId);

  if (archived) {
    await recordAudit({
      userId,
      action: 'material.archived',
      summary: `Archived the supplier "${supplier.name}".`,
      detail: { supplierId },
    });
  }

  return prisma.supplier.update({
    where: { id: supplierId },
    data: { archivedAt: archived ? new Date() : null },
  });
}

/** Links a material to a supplier record, or clears the link. */
export async function setMaterialSupplier(
  materialId: string,
  userId: string,
  supplierId: string | null
): Promise<void> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw notFound('Material');
  await assertWorkspacePermission(material.workspaceId, userId, 'material.manage');

  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, workspaceId: material.workspaceId },
    });
    // Scoped to the same workspace, so a supplier id from another business
    // cannot be attached to this one's material.
    if (!supplier) throw notFound('Supplier');
  }

  await prisma.material.update({ where: { id: materialId }, data: { supplierId } });
}

/* -------------------------------------------------------------------------- */
/* Purchase planning                                                           */
/* -------------------------------------------------------------------------- */

export type PurchasePlan = {
  groups: PurchaseGroup[];
  /** True when the reader may see what the material costs. */
  showsPrices: boolean;
  /** Set when there is nothing to order yet, with the reason. */
  emptyReason: string | null;
};

/**
 * What to order for a project, grouped by supplier.
 *
 * Reads the purchase counts the material engine already produced; it never
 * recomputes one. A second place that decides how many bars to buy is a second
 * place that can disagree with the first.
 *
 * Prices are included only for a reader with `cost.view`. Production buys the
 * material and does not see what it costs (T18), so for them the list carries
 * quantities and nothing else — which is exactly what they need to place an
 * order against the business's own account.
 */
export async function getPurchasePlan(projectId: string, userId: string): Promise<PurchasePlan> {
  await assertProjectAccess(projectId, userId);
  const includePrices = await hasProjectPermission(projectId, userId, 'cost.view');

  const rows = await listProjectMaterials(projectId, userId);
  if (rows.length === 0) {
    return {
      groups: [],
      showsPrices: includePrices,
      emptyReason: 'No materials have been selected for this project yet.',
    };
  }

  const library = await prisma.material.findMany({
    where: { id: { in: rows.map((row) => row.materialId) } },
    include: { supplierRef: { select: { id: true, name: true } } },
  });
  const byId = new Map(library.map((material) => [material.id, material]));

  const groups = groupPurchases(
    rows.map((row) => {
      const material = byId.get(row.materialId);
      return {
        materialId: row.materialId,
        materialName: row.name,
        supplierId: material?.supplierRef?.id ?? null,
        supplierLabel: material?.supplierRef?.name ?? material?.supplier ?? null,
        stockSize: material
          ? formatStockSize({
              measurementModel: material.measurementModel,
              standardLengthMm: material.standardLengthMm,
              sheetWidthMm: material.sheetWidthMm,
              sheetHeightMm: material.sheetHeightMm,
              thicknessMm: material.thicknessMm === null ? null : Number(material.thicknessMm),
            })
          : null,
        unitsToPurchase: row.unitsToPurchase,
        // Snapshotted at calculation time, so the list matches the figures the
        // cost was built from rather than today's price.
        unitPriceCents: row.unitPriceCentsSnapshot ?? material?.unitPriceCents ?? null,
        unsupportedReason:
          row.unsupportedReason ??
          (row.calculatedAt === null ? 'This line has not been calculated yet.' : null),
        warnings: row.warnings.map((warning) => warning.message),
      };
    }),
    { includePrices }
  );

  return { groups, showsPrices: includePrices, emptyReason: null };
}

/* -------------------------------------------------------------------------- */
/* Profitability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A project's projected margin.
 *
 * Behind `cost.view`, because it exposes what the job is estimated to cost —
 * the same figure the cost panel is gated on, arrived at by subtraction.
 */
export async function getProjectProfitability(
  projectId: string,
  userId: string
): Promise<Profitability> {
  const project = await assertProjectAccess(projectId, userId);
  await assertWorkspacePermission(project.workspaceId, userId, 'cost.view');

  const [cost, quote, expenses] = await Promise.all([
    prisma.projectCost.findFirst({ where: { projectId }, orderBy: { computedAt: 'desc' } }),
    prisma.quote.findFirst({
      where: { projectId, status: 'issued' },
      orderBy: { issuedAt: 'desc' },
    }),
    prisma.projectExpense.findMany({ where: { projectId }, select: { amountCents: true } }),
  ]);

  return calculateProfitability({
    internalTotalCents: cost?.internalTotalCents ?? null,
    quotedSubtotalCents: quote?.subtotalCents ?? null,
    recordedExpensesCents: expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
  });
}

/* -------------------------------------------------------------------------- */
/* Workspace analytics                                                         */
/* -------------------------------------------------------------------------- */

export type WorkspaceAnalytics = {
  /** Live projects by workflow stage. Archived projects are excluded. */
  pipeline: { stage: string; count: number }[];
  outcomes: QuoteOutcome;
  /** Summed over projects that have both a cost and an issued quote. */
  projectedMarginCents: number;
  quotedSubtotalCents: number;
  /** How many projects the totals above are actually based on. */
  projectsCounted: number;
  /** Projects excluded because one half was missing, so the totals are honest. */
  projectsIncomplete: number;
  currency: string;
};

const PIPELINE_STAGES = [
  'intake',
  'spec_approved',
  'calculated',
  'quoted',
  'production_ready',
] as const;

/**
 * The business's own numbers.
 *
 * Behind `cost.view`: it is margin across every job, which is the most
 * sensitive figure the product holds.
 *
 * Every total names how many projects it is based on, and how many were left
 * out for want of a cost or a quote. A single "projected margin" over an
 * unstated subset is the kind of number that reads as a fact and is not one.
 */
export async function getWorkspaceAnalytics(
  workspaceId: WorkspaceId,
  userId: string
): Promise<WorkspaceAnalytics> {
  const access = await assertWorkspaceAccess(workspaceId, userId);
  if (!can(access.role, 'cost.view')) {
    throw badRequest('Your role in this workspace does not include cost visibility.');
  }

  const [projects, settings] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId, archivedAt: null },
      select: {
        id: true,
        status: true,
        costs: { orderBy: { computedAt: 'desc' }, take: 1, select: { internalTotalCents: true } },
        quotes: {
          where: { status: 'issued' },
          orderBy: { issuedAt: 'desc' },
          take: 1,
          select: { subtotalCents: true },
        },
      },
    }),
    prisma.costSettings.findUnique({ where: { workspaceId }, select: { currency: true } }),
  ]);

  const [issued, approved, changesRequested] = await Promise.all([
    prisma.quote.count({ where: { workspaceId, status: 'issued' } }),
    prisma.projectComment.count({
      where: { kind: 'approval', project: { workspaceId } },
    }),
    prisma.projectComment.count({
      where: { kind: 'revision_request', project: { workspaceId } },
    }),
  ]);

  const pipeline = PIPELINE_STAGES.map((stage) => ({
    stage,
    count: projects.filter((project) => project.status === stage).length,
  }));

  let projectedMarginCents = 0;
  let quotedSubtotalCents = 0;
  let projectsCounted = 0;
  let projectsIncomplete = 0;

  for (const project of projects) {
    const internal = project.costs[0]?.internalTotalCents ?? null;
    const quoted = project.quotes[0]?.subtotalCents ?? null;

    if (internal === null || quoted === null) {
      // Only projects with both halves are counted. Treating a missing cost as
      // zero would report the full quote as margin.
      if (internal !== null || quoted !== null) projectsIncomplete += 1;
      continue;
    }

    projectedMarginCents += quoted - internal;
    quotedSubtotalCents += quoted;
    projectsCounted += 1;
  }

  return {
    pipeline,
    outcomes: summariseOutcomes({ issued, approved, changesRequested }),
    projectedMarginCents,
    quotedSubtotalCents,
    projectsCounted,
    projectsIncomplete,
    currency: settings?.currency ?? 'MAD',
  };
}
