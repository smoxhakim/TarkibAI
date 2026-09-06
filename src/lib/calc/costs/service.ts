import { prisma } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
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

export async function getCostSettings(userId: string): Promise<CostSettings> {
  const existing = await prisma.costSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.costSettings.create({ data: { userId, ...DEFAULT_SETTINGS } });
}

export async function updateCostSettings(
  userId: string,
  input: CostSettingsPayload
): Promise<CostSettings> {
  return prisma.costSettings.upsert({
    where: { userId },
    update: input,
    create: { userId, ...input },
  });
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export async function listExpenses(projectId: string, userId: string) {
  await assertProjectAccess(projectId, userId);
  return prisma.projectExpense.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}

export async function addExpense(
  projectId: string,
  userId: string,
  input: { label: string; amountCents: number }
) {
  await assertProjectAccess(projectId, userId);
  await prisma.projectExpense.create({ data: { projectId, ...input } });
  return listExpenses(projectId, userId);
}

export async function removeExpense(projectId: string, userId: string, expenseId: string) {
  await assertProjectAccess(projectId, userId);
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

export async function getProjectCost(projectId: string, userId: string): Promise<CostView> {
  await assertProjectAccess(projectId, userId);

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
  await assertProjectAccess(projectId, userId);

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
    getCostSettings(userId),
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
