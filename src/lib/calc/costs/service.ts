import { prisma } from '@/lib/db';
import type { WorkspaceId } from '@/lib/workspaces/access';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess, assertProjectPermission } from '@/lib/projects/service';
import { asWorkspaceId, assertWorkspacePermission } from '@/lib/workspaces/access';
import type { CostSettings, ProjectCost } from '@/generated/prisma/client';
import {
  asComponentType,
  calculateProjectCost,
  toClientSafeCost,
  type ClientSafeCost,
  type CostSettingsInput,
} from './engine';
import type { CostSettingsPayload } from './schema';

/** Defaults for a user who has not configured costing yet. All zero: the system
 *  must not invent a margin or a labour rate on someone's behalf. */
const DEFAULT_SETTINGS = {
  laborType: 'percent',
  laborBp: 0,
  laborCents: 0,
  transportType: 'manual',
  transportBp: 0,
  transportCents: 0,
  installType: 'percent',
  installBp: 0,
  installCents: 0,
  marginBp: 0,
  taxBp: 0,
  currency: 'MAD',
} as const;

export async function getCostSettings(workspaceId: WorkspaceId): Promise<CostSettings> {
  const existing = await prisma.costSettings.findUnique({ where: { workspaceId } });
  if (existing) return existing;
  return prisma.costSettings.create({ data: { workspaceId, ...DEFAULT_SETTINGS } });
}

/**
 * The costing rules every calculation in the workspace is derived from.
 *
 * `cost.manage` — "the costing rules that produce them" — not `cost.view`.
 * Seeing a margin and setting the margin the whole business prices against are
 * different authorities, and the matrix keeps them apart: sales read costs and
 * do not set the rules.
 *
 * Asserted at the service rather than only in the route, so the permission
 * travels with the operation instead of with its one current caller.
 */
export async function updateCostSettings(
  workspaceId: WorkspaceId,
  userId: string,
  input: CostSettingsPayload
): Promise<CostSettings> {
  await assertWorkspacePermission(workspaceId, userId, 'cost.manage');

  return prisma.costSettings.upsert({
    where: { workspaceId },
    update: input,
    create: { workspaceId, ...input },
  });
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export async function listExpenses(projectId: string, userId: string) {
  // Expenses are internal cost inputs, so they follow cost visibility.
  await assertProjectPermission(projectId, userId, 'cost.view');
  return prisma.projectExpense.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}

export async function addExpense(
  projectId: string,
  userId: string,
  input: { label: string; amountCents: number }
) {
  await assertProjectPermission(projectId, userId, 'cost.view');
  await prisma.projectExpense.create({ data: { projectId, ...input } });
  return listExpenses(projectId, userId);
}

export async function removeExpense(projectId: string, userId: string, expenseId: string) {
  await assertProjectPermission(projectId, userId, 'cost.view');
  const row = await prisma.projectExpense.findUnique({ where: { id: expenseId } });
  if (!row || row.projectId !== projectId) throw notFound('Expense');
  await prisma.projectExpense.delete({ where: { id: row.id } });
}

/* -------------------------------------------------------------------------- */
/* Cost calculation                                                            */
/* -------------------------------------------------------------------------- */

export type CostView = {
  cost: ProjectCost | null;
  /** True when a material line was calculated after this cost was computed. */
  stale: boolean;
  /** Set when the cost cannot be computed yet, with the reason why. */
  blockedReason: string | null;
};

/** The most recent material calculation timestamp for a project, or null. */
async function latestMaterialCalculation(projectId: string): Promise<Date | null> {
  const row = await prisma.projectMaterial.findFirst({
    where: { projectId, calculatedAt: { not: null } },
    orderBy: { calculatedAt: 'desc' },
    select: { calculatedAt: true },
  });
  return row?.calculatedAt ?? null;
}

/**
 * The project's internal cost.
 *
 * Guarded by `cost.view`, and guarded by REFUSING rather than by redacting. A
 * role without it — a worker on the floor, a production manager ordering
 * material — never receives the row at all, so an internal column added later
 * cannot leak through a serialiser somebody forgot to update. The same
 * reasoning as the client-safe quote boundary, applied to a second audience
 * (PRD 23: cost visibility is a permission).
 */
/**
 * The project's cost and whether it is current. NO permission check.
 *
 * The one implementation of "is this cost stale", so the answer cannot differ
 * between the panel that displays it and the gate that refuses a document
 * because of it. Both callers below go through here.
 */
async function loadCostState(projectId: string): Promise<CostView> {
  const [cost, materialsCalculatedAt] = await Promise.all([
    prisma.projectCost.findFirst({ where: { projectId }, orderBy: { computedAt: 'desc' } }),
    latestMaterialCalculation(projectId),
  ]);

  if (!cost) {
    return {
      cost: null,
      stale: false,
      blockedReason: materialsCalculatedAt
        ? null
        : 'Calculate the project materials before costing it.',
    };
  }

  // A cost derived from superseded material numbers is not the project's cost.
  const stale =
    materialsCalculatedAt !== null &&
    cost.materialsCalculatedAt !== null &&
    materialsCalculatedAt > cost.materialsCalculatedAt;

  return { cost, stale, blockedReason: null };
}

export async function getProjectCost(projectId: string, userId: string): Promise<CostView> {
  await assertProjectPermission(projectId, userId, 'cost.view');
  return loadCostState(projectId);
}

/**
 * Whether the cost is present and current — with no amounts in it.
 *
 * # Why this is not permission-checked
 *
 * `cost.view` answers "may this person SEE the figures". It does not answer "is
 * this project safe to quote from", and the two were coupled: the integrity
 * report skipped the cost checks entirely for a caller without the permission,
 * and the quote gate read its blockers from that report. `cost.stale` therefore
 * did not exist for a production manager — the one role that holds `quote.view`
 * without `cost.view` — so they could issue a client a quote priced from
 * figures the system already knew were superseded.
 *
 * Safety validation has to see the real state whoever is asking. What keeps
 * that honest is the RETURN TYPE: three facts, no `ProjectCost` row, no
 * amounts. A caller cannot leak a figure it was never given, so this can be
 * read on behalf of somebody who may not see the cost without widening what
 * they may see.
 *
 * Never return this to a client as-is, and never add an amount to it.
 */
export type CostReadiness = {
  exists: boolean;
  /** Computed after a later material calculation than the one it was built on. */
  stale: boolean;
  /** Why no cost could be computed, when that is known. Carries no figure. */
  blockedReason: string | null;
};

export async function readCostReadiness(projectId: string): Promise<CostReadiness> {
  const { cost, stale, blockedReason } = await loadCostState(projectId);
  return { exists: cost !== null, stale, blockedReason };
}

/**
 * Computes and stores the project's cost.
 *
 * Refused until materials have been calculated: a cost built on nothing would
 * be a number with no basis, and the material total is the base every
 * percentage component is applied to.
 */
export async function computeProjectCost(
  projectId: string,
  userId: string,
  manualOverrides?: { laborCents?: number; transportCents?: number; installCents?: number }
): Promise<ProjectCost> {
  // Costing rules come from the workspace that owns the project, not from
  // whoever happens to be signed in: two members must reach the same price.
  const { project } = await assertProjectPermission(projectId, userId, 'cost.view');

  const materialLines = await prisma.projectMaterial.findMany({
    where: { projectId, calculatedAt: { not: null } },
    select: { totalCostCents: true, calculatedAt: true },
  });

  if (materialLines.length === 0) {
    throw badRequest(
      'Calculate the project materials before costing it. Every percentage component is applied to the material cost.'
    );
  }

  const materialsCostCents = materialLines.reduce((sum, line) => sum + (line.totalCostCents ?? 0), 0);
  const materialsCalculatedAt = materialLines.reduce<Date | null>((latest, line) => {
    if (!line.calculatedAt) return latest;
    return latest === null || line.calculatedAt > latest ? line.calculatedAt : latest;
  }, null);

  const [settings, expenses] = await Promise.all([
    getCostSettings(asWorkspaceId(project.workspaceId)),
    prisma.projectExpense.findMany({ where: { projectId } }),
  ]);

  // Component types are stored as plain strings; narrow them explicitly.
  const engineSettings: CostSettingsInput = {
    ...settings,
    laborType: asComponentType(settings.laborType, 'labor'),
    transportType: asComponentType(settings.transportType, 'transport'),
    installType: asComponentType(settings.installType, 'install'),
  };

  const breakdown = calculateProjectCost({
    settings: engineSettings,
    materialsCostCents,
    expensesCents: expenses.map((expense) => expense.amountCents),
    manualOverrides,
  });

  return prisma.projectCost.create({
    data: {
      projectId,
      ...breakdown,
      materialsCalculatedAt,
      // Snapshotted so the breakdown stays explicable after the user edits
      // their costing rules.
      settingsSnapshot: {
        laborType: settings.laborType,
        laborBp: settings.laborBp,
        laborCents: settings.laborCents,
        transportType: settings.transportType,
        transportBp: settings.transportBp,
        transportCents: settings.transportCents,
        installType: settings.installType,
        installBp: settings.installBp,
        installCents: settings.installCents,
        marginBp: settings.marginBp,
        taxBp: settings.taxBp,
        currency: settings.currency,
        manualOverrides: manualOverrides ?? null,
        expenses: expenses.map((e) => ({ label: e.label, amountCents: e.amountCents })),
      },
    },
  });
}

/**
 * The client-facing view of a project's cost.
 *
 * Deliberately the only exported path that a quote template may consume. It
 * returns constructed fields rather than a filtered ProjectCost, so an internal
 * column added later cannot leak by default.
 */
export async function getClientSafeCost(
  projectId: string,
  userId: string
): Promise<ClientSafeCost | null> {
  const { cost } = await getProjectCost(projectId, userId);
  if (!cost) return null;

  return toClientSafeCost({
    materialsCostCents: cost.materialsCostCents,
    laborCostCents: cost.laborCostCents,
    transportCostCents: cost.transportCostCents,
    installCostCents: cost.installCostCents,
    otherCostCents: cost.otherCostCents,
    internalTotalCents: cost.internalTotalCents,
    marginCents: cost.marginCents,
    clientSubtotalCents: cost.clientSubtotalCents,
    taxCents: cost.taxCents,
    clientTotalCents: cost.clientTotalCents,
  });
}
