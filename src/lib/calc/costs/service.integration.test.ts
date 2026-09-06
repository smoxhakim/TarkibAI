/**
 * Integration tests for the cost engine.
 *
 * The pure arithmetic is covered by unit tests. These cover the database-level
 * guarantees: the materials gate, snapshotting, staleness, isolation between
 * users, and — most importantly — that the client-safe path cannot surface an
 * internal figure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import {
  addExpense,
  computeProjectCost,
  getClientSafeCost,
  getCostSettings,
  getProjectCost,
  listExpenses,
  removeExpense,
  updateCostSettings,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `ko-${suffix}`, email: `ko-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `kx-${suffix}`, email: `kx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;

  // 30% labour, 500 fixed transport, 10% install, 25% margin, 20% TVA.
  await updateCostSettings(ownerId, {
    laborType: 'percent',
    laborBp: 3000,
    laborCents: 0,
    transportType: 'fixed',
    transportBp: 0,
    transportCents: 50000,
    installType: 'percent',
    installBp: 1000,
    installCents: 0,
    marginBp: 2500,
    taxBp: 2000,
    currency: 'MAD',
  });
});

afterAll(async () => {
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: { in: [ownerId, otherId] } } } });
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.material.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.costSettings.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

/** A project with materials calculated to a known cost of 100000 (5 x 20000). */
async function costedProject() {
  const project = await createProject(ownerId, { title: `cost ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(ownerId, {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 20000,
  });
  const rows = await selectProjectMaterial(project.id, ownerId, material.id, null);
  await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
    requiredQuantity: 25,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, ownerId);

  return { project, material };
}

describe('cost settings', () => {
  it('creates zeroed defaults rather than inventing a margin', async () => {
    const fresh = await prisma.user.create({
      data: { clerkId: `kd-${suffix}`, email: `kd-${suffix}@example.test` },
    });
    const settings = await getCostSettings(fresh.id);

    // Inventing a default margin would silently mis-price someone's first quote.
    expect(settings.marginBp).toBe(0);
    expect(settings.taxBp).toBe(0);
    expect(settings.laborBp).toBe(0);

    await prisma.costSettings.deleteMany({ where: { userId: fresh.id } });
    await prisma.user.delete({ where: { id: fresh.id } });
  });

  it('keeps settings private per user', async () => {
    const mine = await getCostSettings(ownerId);
    const theirs = await getCostSettings(otherId);
    expect(mine.marginBp).toBe(2500);
    expect(theirs.marginBp).toBe(0);
  });
});

describe('materials gate', () => {
  it('refuses to cost a project whose materials are not calculated', async () => {
    const project = await createProject(ownerId, { title: 'Uncosted' });
    await expect(computeProjectCost(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.projectCost.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('reports why costing is blocked instead of returning an empty result', async () => {
    const project = await createProject(ownerId, { title: 'Blocked' });
    const view = await getProjectCost(project.id, ownerId);
    expect(view.cost).toBeNull();
    expect(view.blockedReason).toContain('Calculate the project materials');
  });

  it("refuses to cost another user's project", async () => {
    const { project } = await costedProject();
    await expect(computeProjectCost(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(getProjectCost(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('cost calculation', () => {
  it('computes the full breakdown from the material total', async () => {
    const { project } = await costedProject();
    const cost = await computeProjectCost(project.id, ownerId);

    expect(cost.materialsCostCents).toBe(100000);
    expect(cost.laborCostCents).toBe(30000);
    expect(cost.transportCostCents).toBe(50000);
    expect(cost.installCostCents).toBe(10000);
    expect(cost.internalTotalCents).toBe(190000);
    expect(cost.marginCents).toBe(47500);
    expect(cost.clientSubtotalCents).toBe(237500);
    expect(cost.taxCents).toBe(47500);
    expect(cost.clientTotalCents).toBe(285000);
  });

  it('includes per-project expenses in the internal total', async () => {
    const { project } = await costedProject();
    await addExpense(project.id, ownerId, { label: 'Crane hire', amountCents: 80000 });

    const cost = await computeProjectCost(project.id, ownerId);
    expect(cost.otherCostCents).toBe(80000);
    expect(cost.internalTotalCents).toBe(270000);
  });

  it('snapshots the settings so the breakdown survives a later rule change', async () => {
    const { project } = await costedProject();
    const cost = await computeProjectCost(project.id, ownerId);

    await updateCostSettings(ownerId, {
      laborType: 'percent',
      laborBp: 9000,
      laborCents: 0,
      transportType: 'fixed',
      transportBp: 0,
      transportCents: 50000,
      installType: 'percent',
      installBp: 1000,
      installCents: 0,
      marginBp: 2500,
      taxBp: 2000,
      currency: 'MAD',
    });

    const stored = await prisma.projectCost.findUniqueOrThrow({ where: { id: cost.id } });
    const snapshot = stored.settingsSnapshot as { laborBp: number };
    expect(snapshot.laborBp).toBe(3000);
    expect(stored.laborCostCents).toBe(30000);

    // restore for other tests
    await updateCostSettings(ownerId, {
      laborType: 'percent',
      laborBp: 3000,
      laborCents: 0,
      transportType: 'fixed',
      transportBp: 0,
      transportCents: 50000,
      installType: 'percent',
      installBp: 1000,
      installCents: 0,
      marginBp: 2500,
      taxBp: 2000,
      currency: 'MAD',
    });
  });

  it('flags the cost stale when materials are recalculated afterwards', async () => {
    const { project } = await costedProject();
    await computeProjectCost(project.id, ownerId);
    expect((await getProjectCost(project.id, ownerId)).stale).toBe(false);

    await calculateProjectMaterials(project.id, ownerId);

    const view = await getProjectCost(project.id, ownerId);
    expect(view.stale).toBe(true);
    // The previous figures stay visible so the user can see what changed.
    expect(view.cost?.clientTotalCents).toBe(285000);
  });

  it('returns the most recent cost when recomputed', async () => {
    const { project } = await costedProject();
    await computeProjectCost(project.id, ownerId);
    await addExpense(project.id, ownerId, { label: 'Permit', amountCents: 10000 });
    const second = await computeProjectCost(project.id, ownerId);

    const view = await getProjectCost(project.id, ownerId);
    expect(view.cost?.id).toBe(second.id);
    expect(view.cost?.otherCostCents).toBe(10000);
  });
});

describe('expenses', () => {
  it("refuses to list, add or remove another user's expenses", async () => {
    const { project } = await costedProject();
    await addExpense(project.id, ownerId, { label: 'Private', amountCents: 5000 });
    const rows = await listExpenses(project.id, ownerId);

    await expect(listExpenses(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      addExpense(project.id, otherId, { label: 'Injected', amountCents: 1 })
    ).rejects.toMatchObject({ status: 404 });
    await expect(removeExpense(project.id, otherId, rows[0].id)).rejects.toMatchObject({
      status: 404,
    });

    expect(await listExpenses(project.id, ownerId)).toHaveLength(1);
  });
});

describe('client-safe boundary', () => {
  it('exposes only subtotal, tax and total', async () => {
    const { project } = await costedProject();
    await computeProjectCost(project.id, ownerId);

    const safe = await getClientSafeCost(project.id, ownerId);
    expect(safe).not.toBeNull();
    expect(Object.keys(safe!).sort()).toEqual(['subtotalCents', 'taxCents', 'totalCents']);
  });

  it('never carries an internal figure through the serialized payload', async () => {
    const { project } = await costedProject();
    // An expense value that is unmistakable if it leaks.
    await addExpense(project.id, ownerId, { label: 'Secret subcontractor', amountCents: 13579 });

    // Rates chosen so margin and tax differ. At 25% margin with 20% tax they are
    // mathematically identical — tax = (internal x 1.25) x 0.20 = internal x 0.25
    // — which would make a value-based leak assertion unsatisfiable on a
    // correct result.
    await updateCostSettings(ownerId, {
      laborType: 'percent',
      laborBp: 3000,
      laborCents: 0,
      transportType: 'fixed',
      transportBp: 0,
      transportCents: 50000,
      installType: 'percent',
      installBp: 1000,
      installCents: 0,
      marginBp: 3300,
      taxBp: 2000,
      currency: 'MAD',
    });

    const cost = await computeProjectCost(project.id, ownerId);
    expect(cost.marginCents).not.toBe(cost.taxCents);

    const safe = await getClientSafeCost(project.id, ownerId);
    const json = JSON.stringify(safe);

    expect(json).not.toContain('margin');
    expect(json).not.toContain('internal');
    expect(json).not.toContain('Secret subcontractor');
    expect(json).not.toContain('13579');
    expect(json).not.toContain(String(cost.internalTotalCents));
    expect(json).not.toContain(String(cost.marginCents));
    expect(json).not.toContain(String(cost.materialsCostCents));

    await updateCostSettings(ownerId, {
      laborType: 'percent',
      laborBp: 3000,
      laborCents: 0,
      transportType: 'fixed',
      transportBp: 0,
      transportCents: 50000,
      installType: 'percent',
      installBp: 1000,
      installCents: 0,
      marginBp: 2500,
      taxBp: 2000,
      currency: 'MAD',
    });
  });

  it('returns null rather than zeros when nothing has been costed', async () => {
    const project = await createProject(ownerId, { title: 'Never costed' });
    expect(await getClientSafeCost(project.id, ownerId)).toBeNull();
  });

  it("refuses a client-safe cost for another user's project", async () => {
    const { project } = await costedProject();
    await computeProjectCost(project.id, ownerId);
    await expect(getClientSafeCost(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
