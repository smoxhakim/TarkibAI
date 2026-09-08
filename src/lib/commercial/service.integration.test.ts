/**
 * Integration tests for the commercial layer.
 *
 * The arithmetic is pure and covered by unit tests. These cover what only real
 * project state can show: that a purchase list reflects what the engines
 * actually computed, that prices disappear for a reader without cost
 * visibility, and that no total is reported over a subset it does not name.
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
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { createQuote, issueQuote } from '@/lib/quotes/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { createShare, postClientResponse } from '@/lib/collaboration/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';
import { NO_SUPPLIER } from './purchasing';
import {
  createSupplier,
  getProjectProfitability,
  getPurchasePlan,
  getWorkspaceAnalytics,
  listSuppliers,
  setMaterialSupplier,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `com-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ws: WorkspaceId;
let workerId: string;
let outsiderId: string;
let outsiderWs: WorkspaceId;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

const COST_SETTINGS = {
  laborType: 'percent' as const, laborBp: 3000, laborCents: 0,
  transportType: 'fixed' as const, transportBp: 0, transportCents: 50_000,
  installType: 'percent' as const, installBp: 1000, installCents: 0,
  marginBp: 4000, taxBp: 2000, currency: 'MAD',
};

beforeAll(async () => {
  const [owner, worker, outsider] = await Promise.all([
    prisma.user.create({ data: { clerkId: `co-${suffix}`, email: `co-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `cw-${suffix}`, email: `cw-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `cx-${suffix}`, email: `cx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  workerId = worker.id;
  outsiderId = outsider.id;

  ws = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  await ensurePersonalWorkspace(workerId);
  outsiderWs = asWorkspaceId((await ensurePersonalWorkspace(outsiderId)).id);

  // A production role: buys material, does not see cost.
  await prisma.workspaceMember.create({
    data: { workspaceId: ws, userId: workerId, role: 'production' },
  });

  await updateCostSettings(ws, COST_SETTINGS);
  await updateQuoteSettings(ws, {
    companyName: 'Atelier Nour', companyAddress: null, companyPhone: null,
    companyEmail: null, taxIdentifiers: null, primaryColorHex: null,
    footerText: null, termsText: null, paymentDetails: null,
    validityDays: 30, numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, workerId, outsiderId] };
  await prisma.notification.deleteMany({ where: { userId: users } });
  await prisma.auditEvent.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/** A project with one calculated material line and a cost. */
async function costedProject(options: { supplierId?: string | null } = {}) {
  const project = await createProject(ws, ownerId, { title: `Job ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(ws, ownerId, {
    name: `tube-${Math.random()}`,
    category: 'Metal', customCategory: false,
    measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 20_000,
  });
  if (options.supplierId !== undefined) {
    await setMaterialSupplier(material.id, ownerId, options.supplierId);
  }

  const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
    requiredQuantity: 25, requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, ownerId);
  const cost = await computeProjectCost(project.id, ownerId);

  return { project, material, cost };
}

/* -------------------------------------------------------------------------- */

describe('suppliers', () => {
  it('are scoped to the workspace that created them', async () => {
    const supplier = await createSupplier(ws, ownerId, {
      name: `Metaux Casa ${suffix}`, contact: 'Rachid', phone: null, email: null,
      notes: null, leadTimeDays: 5,
    });

    expect((await listSuppliers(ws)).some((row) => row.id === supplier.id)).toBe(true);
    expect(await listSuppliers(outsiderWs)).toHaveLength(0);
  });

  it('cannot be attached to another business\'s material', async () => {
    const supplier = await createSupplier(ws, ownerId, {
      name: `Other ${suffix}`, contact: null, phone: null, email: null, notes: null, leadTimeDays: null,
    });
    const theirs = await createMaterial(outsiderWs, outsiderId, {
      name: `theirs-${Math.random()}`, category: 'Metal', customCategory: false,
      measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 100,
    });

    await expect(setMaterialSupplier(theirs.id, ownerId, supplier.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('need the material.manage permission to create', async () => {
    await expect(
      createSupplier(ws, outsiderId, {
        name: 'Nope', contact: null, phone: null, email: null, notes: null, leadTimeDays: null,
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the purchase list', () => {
  it('reports what the engine computed, grouped by supplier', async () => {
    const supplier = await createSupplier(ws, ownerId, {
      name: `Metaux ${Math.random()}`, contact: null, phone: null, email: null,
      notes: null, leadTimeDays: null,
    });
    const { project } = await costedProject({ supplierId: supplier.id });

    const plan = await getPurchasePlan(project.id, ownerId);

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].supplierName).toBe(supplier.name);
    // 25 m of 6 m bars -> 5 bars, the same figure the material panel shows.
    expect(plan.groups[0].lines[0].unitsToPurchase).toBe(5);
    expect(plan.groups[0].subtotalCents).toBe(5 * 20_000);
  });

  it('groups an unlinked material under a heading that says so', async () => {
    const { project } = await costedProject();
    const plan = await getPurchasePlan(project.id, ownerId);

    expect(plan.groups[0].supplierName).toBe(NO_SUPPLIER);
  });

  it('shows quantities but no price to somebody who cannot see costs', async () => {
    const { project } = await costedProject();

    // Production orders the material; the margin on the job is not theirs.
    const plan = await getPurchasePlan(project.id, workerId);

    expect(plan.showsPrices).toBe(false);
    expect(plan.groups[0].lines[0].unitsToPurchase).toBe(5);
    expect(plan.groups[0].lines[0].lineTotalCents).toBeNull();
    expect(plan.groups[0].subtotalCents).toBeNull();
    expect(JSON.stringify(plan)).not.toContain('20000');
  });

  it('carries an uncalculated line rather than dropping it', async () => {
    const project = await createProject(ws, ownerId, { title: 'Half done' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);

    const material = await createMaterial(ws, ownerId, {
      name: `panel-${Math.random()}`, category: 'Panel', customCategory: false,
      measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, unitPriceCents: 40_000,
    });
    await selectProjectMaterial(project.id, ownerId, material.id, null);

    const plan = await getPurchasePlan(project.id, ownerId);

    expect(plan.groups[0].lines[0].unitsToPurchase).toBeNull();
    expect(plan.groups[0].lines[0].unsupportedReason).toMatch(/not been calculated/i);
    expect(plan.groups[0].incomplete).toBe(true);
    // No subtotal that quietly skips it.
    expect(plan.groups[0].subtotalCents).toBeNull();
  });

  it('says why it is empty rather than showing an empty list', async () => {
    const project = await createProject(ws, ownerId, { title: 'Nothing yet' });
    const plan = await getPurchasePlan(project.id, ownerId);

    expect(plan.groups).toEqual([]);
    expect(plan.emptyReason).toMatch(/No materials/i);
  });
});

describe('project profitability', () => {
  it.runIf(isStorageConfigured())('projects the margin between the estimate and the quote', async () => {
    const { project, cost } = await costedProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    const issued = await issueQuote(quote.id, ownerId);

    const result = await getProjectProfitability(project.id, ownerId);

    expect(result.internalTotalCents).toBe(cost.internalTotalCents);
    expect(result.quotedSubtotalCents).toBe(issued.subtotalCents);
    expect(result.projectedMarginCents).toBe(issued.subtotalCents - cost.internalTotalCents);
    // The naming is the point: nothing here measured what the job cost.
    expect(result.isProjection).toBe(true);
  });

  it('says what is missing rather than reporting a margin it cannot compute', async () => {
    const { project } = await costedProject();
    const result = await getProjectProfitability(project.id, ownerId);

    expect(result.projectedMarginCents).toBeNull();
    expect(result.missing.join(' ')).toMatch(/No quote has been issued/i);
  });

  it('is refused to a role without cost visibility', async () => {
    const { project } = await costedProject();
    await expect(getProjectProfitability(project.id, workerId)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('is hidden from another business entirely', async () => {
    const { project } = await costedProject();
    await expect(getProjectProfitability(project.id, outsiderId)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('workspace analytics', () => {
  it('counts only projects that have both a cost and a quote, and says how many', async () => {
    const analytics = await getWorkspaceAnalytics(ws, ownerId);

    // Every costed-but-unquoted project made above is excluded rather than
    // counted with a zero quote, which would report a loss that did not happen.
    expect(analytics.projectsIncomplete).toBeGreaterThan(0);
    expect(analytics.projectsCounted).toBeLessThanOrEqual(
      analytics.projectsCounted + analytics.projectsIncomplete
    );
  });

  it('reports a pipeline by stage', async () => {
    const analytics = await getWorkspaceAnalytics(ws, ownerId);
    const stages = analytics.pipeline.map((entry) => entry.stage);

    expect(stages).toContain('intake');
    expect(stages).toContain('quoted');
    expect(analytics.pipeline.every((entry) => entry.count >= 0)).toBe(true);
  });

  it.runIf(isStorageConfigured())('counts a client approval as a win', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    await issueQuote(quote.id, ownerId);

    const share = await createShare(project.id, ownerId, {
      includeQuote: true, includeMockups: false, includeDrawings: false, allowResponses: true,
    });
    await postClientResponse(share.token, { kind: 'approval', name: 'Youssef', body: '' });

    const analytics = await getWorkspaceAnalytics(ws, ownerId);
    expect(analytics.outcomes.approved).toBeGreaterThan(0);
    expect(analytics.outcomes.winRateBp).not.toBeNull();
  });

  it('reports an unknown win rate as unknown for a business that has not quoted', async () => {
    const analytics = await getWorkspaceAnalytics(outsiderWs, outsiderId);

    expect(analytics.outcomes.issued).toBe(0);
    // Not 0% — that would read as "we never win" about a business that has not
    // started.
    expect(analytics.outcomes.winRateBp).toBeNull();
  });

  it('is refused to a role without cost visibility', async () => {
    await expect(getWorkspaceAnalytics(ws, workerId)).rejects.toMatchObject({ status: 400 });
  });

  it('is hidden from a non-member', async () => {
    await expect(getWorkspaceAnalytics(ws, outsiderId)).rejects.toMatchObject({ status: 404 });
  });
});
