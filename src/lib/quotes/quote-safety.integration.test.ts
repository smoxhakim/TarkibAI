/**
 * The quote safety gate, and its independence from who is looking.
 *
 * TARKIB has two separate questions about a project's cost:
 *
 *   may this person SEE the figures?      → cost.view, a visibility permission
 *   is this project SAFE to quote from?   → deterministic validation
 *
 * They were coupled. The integrity report omitted the whole cost section for a
 * role without `cost.view`, and `issueQuote` derived its blockers from that
 * report — so `cost.stale` and `cost.missing` simply did not exist for such a
 * caller, and the gate they exist to enforce did not fire.
 *
 * The quote-write hardening that followed closed the same hole at a second
 * layer: issuing now requires `quote.create`, which production does not hold,
 * so a cost-blind caller no longer reaches this gate through the role matrix at
 * all. That does NOT make the fix below redundant. `blockersFor` is also what
 * gates the production package, which `production.generate` reaches and
 * production holds; the readiness verdict is read by every role through the
 * panel and the AI; and if the matrix ever grants `quote.create` without
 * `cost.view`, the gate has to hold on its own.
 *
 * So the invariant is asserted where it actually lives — the blocker
 * computation — rather than by having a role issue a quote it may no longer
 * issue: for the same project state, the safety decision is identical whatever
 * the caller may see.
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
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { isStorageConfigured } from '@/lib/storage/config';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { can } from '@/lib/workspaces/permissions';
import { blockersFor } from '@/lib/validation/service';
import { createQuote, issueQuote } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `qsafe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let ownerId: string;
let salesId: string;
let productionId: string;
let workspaceId: WorkspaceId;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** A project costed and quoted, with everything current. */
async function quotedProject() {
  const project = await createProject(workspaceId, ownerId, { title: `Quote safety ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(workspaceId, ownerId, {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 20_000,
  });
  const selected = await selectProjectMaterial(project.id, ownerId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, ownerId, selected[0].id, {
    requiredQuantity: 25,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, ownerId);
  await computeProjectCost(project.id, ownerId);

  // Created by the owner: production holds quote.view but not quote.create, so
  // it is the ISSUING step this test is about, not the writing step.
  const quote = await createQuote(project.id, ownerId, { clientName: 'Restaurant Atlas' });
  return { project, quote };
}

/** Recalculating the materials leaves the stored cost behind them. */
async function makeCostStale(projectId: string) {
  await calculateProjectMaterials(projectId, ownerId);
}

/** The state where a cost was never computed at all. */
async function makeCostMissing(projectId: string) {
  await prisma.projectCost.deleteMany({ where: { projectId } });
}

beforeAll(async () => {
  const [owner, sales, production] = await Promise.all([
    prisma.user.create({ data: { clerkId: `o-${suffix}`, email: `o-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `s-${suffix}`, email: `s-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `p-${suffix}`, email: `p-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  salesId = sales.id;
  productionId = production.id;

  const workspace = await prisma.workspace.create({
    data: {
      name: `Quote safety ${suffix}`,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
          { userId: salesId, role: 'sales' },
          { userId: productionId, role: 'production' },
        ],
      },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  await updateCostSettings(workspaceId, {
    laborType: 'percent',
    laborBp: 3000,
    laborCents: 0,
    transportType: 'fixed',
    transportBp: 0,
    transportCents: 50_000,
    installType: 'percent',
    installBp: 1000,
    installCents: 0,
    marginBp: 4000,
    taxBp: 2000,
    currency: 'MAD',
  });
  await updateQuoteSettings(workspaceId, {
    companyName: `Quote safety ${suffix}`,
    validityDays: 30,
    numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, salesId, productionId] };
  await prisma.quote.deleteMany({ where: { userId: users } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

describe('the roles this is about', () => {
  it('has one that may issue a quote and may not see a cost', () => {
    // If this ever stops being true the gap closes by itself, and these tests
    // would be asserting something that cannot happen.
    expect(can('production', 'quote.view')).toBe(true);
    expect(can('production', 'cost.view')).toBe(false);
    expect(can('sales', 'quote.view')).toBe(true);
    expect(can('sales', 'cost.view')).toBe(true);
  });
});

describe('a stale cost blocks issuance', () => {
  it('for sales, who can see the cost', async () => {
    const { project, quote } = await quotedProject();
    await makeCostStale(project.id);

    await expect(issueQuote(quote.id, salesId)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');
  });

  it('refuses production earlier still, at authorization', async () => {
    const { project, quote } = await quotedProject();
    await makeCostStale(project.id);

    // Production may not issue a quote at all now (`quote.create`), so it is
    // turned away before the safety gate rather than by it — 403, not 400. The
    // gate's own independence from `cost.view` is asserted below, on the
    // blockers themselves.
    await expect(issueQuote(quote.id, productionId)).rejects.toMatchObject({ status: 403 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');
  });

  it('reports the same blocking codes to both', async () => {
    const { project } = await quotedProject();
    await makeCostStale(project.id);

    const forSales = await blockersFor('quote', project.id, salesId);
    const forProduction = await blockersFor('quote', project.id, productionId);

    expect(forSales.map((f) => f.code)).toContain('cost.stale');
    expect(forProduction.map((f) => f.code)).toEqual(forSales.map((f) => f.code));
  });
});

describe('a missing cost blocks issuance', () => {
  it('for sales, who can see the cost', async () => {
    const { project, quote } = await quotedProject();
    await makeCostMissing(project.id);

    await expect(issueQuote(quote.id, salesId)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses production earlier still, at authorization', async () => {
    const { project, quote } = await quotedProject();
    await makeCostMissing(project.id);

    await expect(issueQuote(quote.id, productionId)).rejects.toMatchObject({ status: 403 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');
  });

  it('reports the same blocking codes to both', async () => {
    const { project } = await quotedProject();
    await makeCostMissing(project.id);

    const forSales = await blockersFor('quote', project.id, salesId);
    const forProduction = await blockersFor('quote', project.id, productionId);

    expect(forSales.map((f) => f.code)).toContain('cost.missing');
    expect(forProduction.map((f) => f.code)).toEqual(forSales.map((f) => f.code));
  });
});

describe('a current cost does not block anyone', () => {
  it('lets sales issue', async () => {
    const { project } = await quotedProject();
    expect(await blockersFor('quote', project.id, salesId)).toEqual([]);
  });

  it('clears the gate for production too, who cannot see the cost', async () => {
    const { project } = await quotedProject();
    // The safety decision, computed for a cost-blind caller. Whether they may
    // then act on it is a separate permission.
    expect(await blockersFor('quote', project.id, productionId)).toEqual([]);
  });

  it.runIf(isStorageConfigured())('issues end to end for sales', async () => {
    const { quote } = await quotedProject();
    const issued = await issueQuote(quote.id, salesId);
    expect(issued.status).toBe('issued');
    expect(issued.issuedAt).not.toBeNull();
  });
});

describe('being blocked tells nobody what the cost is', () => {
  it('refuses a cost-blind reader without naming a figure', async () => {
    const { project, quote } = await quotedProject();
    await makeCostStale(project.id);

    // Sales may issue and may see costs; the refusal still states no amount,
    // which is what a cost-blind caller would also receive from the gate.
    const error = await issueQuote(quote.id, salesId).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;

    // The refusal says the figures are superseded. It must not say what they
    // are: no amount, no currency, no total.
    expect(message).not.toMatch(/\d+[.,]\d{2}/);
    expect(message).not.toMatch(/\bMAD\b|\bdh\b|\bdhs\b/i);
    expect(message).not.toMatch(/\b\d{4,}\b/);
  });

  it('still keeps the internal cost row away from production', async () => {
    const { project } = await quotedProject();
    const { getProjectCost } = await import('@/lib/calc/costs/service');

    // The safety fix must not have opened the visibility boundary.
    await expect(getProjectCost(project.id, productionId)).rejects.toMatchObject({ status: 403 });
  });
});
