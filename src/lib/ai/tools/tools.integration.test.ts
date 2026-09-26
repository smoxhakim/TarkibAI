/**
 * The AI tool surface against real rows and real roles.
 *
 * The unit tests assert which tools each role is GIVEN. These assert what
 * happens when they run: that a tool refuses the permission it claims to need
 * even if it is reached anyway, that money is genuinely absent from a
 * cost-blind result rather than merely undocumented, and that a tool cannot
 * step outside the project and workspace it was bound to.
 *
 * One workspace with five members, one per role, so every assertion is about
 * the role rather than about which fixture happened to be used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, getProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { createQuote, updateQuote } from '@/lib/quotes/service';
import { seedScene } from '@/lib/canvas/service';
import { listProposals } from '@/lib/design/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import type { WorkspaceRole } from '@/lib/workspaces/permissions';
import { resolveProjectAiAccess } from '../access';
import { buildToolbox } from './index';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ROLES = ['owner', 'designer', 'sales', 'production', 'worker'] as const;
const userIds: Record<WorkspaceRole, string> = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
let projectId: string;
let outsiderId: string;
let outsiderProjectId: string;

/**
 * The internal calculated client subtotal, captured from the cost engine in
 * `beforeAll`.
 *
 * The leak assertions below look for THIS EXACT NUMBER in a cost-blind
 * payload. Asserting only that `calculatedSubtotalCents` is null would pass
 * against an implementation that leaked the same figure under a different key.
 */
let internalSubtotalCents: number;

/**
 * The quote's own client-facing subtotal, deliberately set to something the
 * cost engine did not produce.
 *
 * If the quote were left priced from the calculation, its subtotal would EQUAL
 * the internal figure and "the internal figure is absent" would be
 * unfalsifiable — the same number would appear legitimately as the client
 * price. A distinct, non-round price keeps the two separable.
 */
const QUOTE_UNIT_PRICE_CENTS = 783_217;
const QUOTE_SUBTOTAL_CENTS = QUOTE_UNIT_PRICE_CENTS * 3;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** Runs one tool as one role, or fails loudly if that role never had it. */
async function run(role: WorkspaceRole, name: string, args: unknown = {}) {
  const access = await resolveProjectAiAccess(projectId, userIds[role]);
  const tool = buildToolbox(access).find((entry) => entry.name === name);
  if (!tool) throw new Error(`${role} has no tool named ${name}`);
  return tool.execute(args);
}

beforeAll(async () => {
  const users = await Promise.all(
    ROLES.map((role) =>
      prisma.user.create({
        data: { clerkId: `${role}-${suffix}`, email: `${role}-${suffix}@example.test` },
      })
    )
  );
  ROLES.forEach((role, index) => {
    userIds[role] = users[index].id;
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Tools ${suffix}`,
      members: { create: ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const outsiderWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });

  await updateCostSettings(workspaceId, userIds.owner, {
    laborType: 'percent',
    laborBp: 3000,
    laborCents: 0,
    transportType: 'fixed',
    transportBp: 0,
    transportCents: 50_000,
    installType: 'percent',
    installBp: 1000,
    installCents: 0,
    marginBp: 2000,
    taxBp: 2000,
    currency: 'MAD',
  });

  const project = await createProject(workspaceId, userIds.owner, { title: `Tools ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, userIds.owner, COMPLETE_SPEC);
  await approveSpec(projectId, userIds.owner);
  await seedScene(projectId, userIds.owner);

  const material = await createMaterial(workspaceId, userIds.owner, {
    name: 'Alucobond 3mm noir',
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 45_000,
  });
  const selected = await selectProjectMaterial(projectId, userIds.owner, material.id, 'Face');
  await updateProjectMaterialRequirement(projectId, userIds.owner, selected[0].id, {
    requiredQuantity: 18,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(projectId, userIds.owner);
  await computeProjectCost(projectId, userIds.owner);

  // Captured before the quote is repriced, so it is the engine's own figure.
  const costView = await getProjectCost(projectId, userIds.owner);
  internalSubtotalCents = costView.cost?.clientSubtotalCents ?? 0;

  const quote = await createQuote(projectId, userIds.owner, {
    clientName: `Client ${suffix}`,
    title: 'Enseigne façade',
  });
  await updateQuote(quote.id, userIds.owner, {
    lines: [
      {
        description: 'Enseigne lumineuse façade',
        quantityMilli: 3000,
        unitLabel: 'm²',
        unitPriceCents: QUOTE_UNIT_PRICE_CENTS,
      },
    ],
  });

  const outsiderProject = await createProject(asWorkspaceId(outsiderWorkspace.id), outsiderId, {
    title: `Outsider ${suffix}`,
  });
  outsiderProjectId = outsiderProject.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('binding to the project and the caller', () => {
  it('refuses to build a toolbox for a project in another workspace', async () => {
    await expect(resolveProjectAiAccess(outsiderProjectId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveProjectAiAccess(projectId, outsiderId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reads the project it was bound to, whatever the model sends as arguments', async () => {
    const access = await resolveProjectAiAccess(projectId, userIds.owner);
    const tool = buildToolbox(access).find((entry) => entry.name === 'get_project_spec')!;

    // The model has no way to name a project; an id in the arguments is
    // rejected by the schema rather than honoured.
    await expect(tool.execute({ projectId: outsiderProjectId })).rejects.toThrow();

    const result = (await tool.execute({})) as { spec: { projectType?: string } };
    expect(result.spec.projectType).toBe('enseigne');
  });

  it('searches only the workspace the caller is acting in', async () => {
    const outsiderWorkspace = await prisma.workspace.findFirstOrThrow({
      where: { members: { some: { userId: outsiderId } } },
    });
    await createMaterial(asWorkspaceId(outsiderWorkspace.id), outsiderId, {
      name: 'Secret competitor panel',
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 3050,
      sheetHeightMm: 1500,
      unitPriceCents: 99_000,
    });

    const result = (await run('owner', 'list_materials', { search: 'Secret' })) as {
      materials: unknown[];
    };
    expect(result.materials).toEqual([]);
  });
});

describe('writing tools', () => {
  it('lets an editor record what the user stated', async () => {
    await run('sales', 'update_project_spec', { finishNotes: 'mat noir' });
    const view = await getSpec(projectId, userIds.owner);
    expect(view.spec.finishNotes).toBe('mat noir');
  });

  it('gives a worker no way to write to the specification', async () => {
    const access = await resolveProjectAiAccess(projectId, userIds.worker);
    const names = buildToolbox(access).map((tool) => tool.name);
    expect(names).not.toContain('update_project_spec');
    expect(names).not.toContain('propose_design_change');
  });

  it('refuses the permission even if the tool is reached another way', async () => {
    // Built for an owner, executed by a worker: the assertion inside the tool is
    // what stands between a refactor and a bypass.
    const ownerAccess = await resolveProjectAiAccess(projectId, userIds.owner);
    const ownerTool = buildToolbox(ownerAccess).find(
      (entry) => entry.name === 'update_project_spec'
    )!;
    const smuggled = buildToolbox({ ...ownerAccess, userId: userIds.worker, role: 'owner' }).find(
      (entry) => entry.name === 'update_project_spec'
    )!;

    expect(ownerTool).toBeTruthy();
    await expect(smuggled.execute({ notes: 'by a worker' })).rejects.toMatchObject({ status: 403 });
  });

  it('leaves a design proposal pending and changes nothing', async () => {
    const before = await listProposals(projectId, userIds.owner);
    const result = (await run('designer', 'propose_design_change', {
      summary: 'zid 50cm f l3ard.',
      commands: [
        {
          kind: 'update_object',
          id: (
            (await run('designer', 'get_canvas')) as { objects: { id: string }[] }
          ).objects[0].id,
          changes: { widthMm: 8500 },
        },
      ],
    })) as { status: string };

    expect(result.status).toBe('pending');
    expect((await listProposals(projectId, userIds.owner)).length).toBe(before.length + 1);
  });
});

describe('the financial boundary', () => {
  it('gives the cost tool to sales and withholds it from production and worker', async () => {
    const sales = (await run('sales', 'get_project_cost')) as {
      currency: string;
      cost: { internalTotalCents: number; marginCents: number };
    };
    expect(sales.currency).toBe('MAD');
    expect(sales.cost.internalTotalCents).toBeGreaterThan(0);

    for (const role of ['production', 'worker', 'designer'] as const) {
      const access = await resolveProjectAiAccess(projectId, userIds[role]);
      expect(buildToolbox(access).map((tool) => tool.name), role).not.toContain('get_project_cost');
    }
  });

  it('returns purchase counts to production with no money anywhere in the payload', async () => {
    const result = (await run('production', 'get_material_calculations')) as {
      lines: {
        unitsToPurchase: number | null;
        unitPriceCents: number | null;
        unitPriceCentsSnapshot: number | null;
        totalCostCents: number | null;
      }[];
    };

    // The quantity they need to do their job survives.
    expect(result.lines[0].unitsToPurchase).toBeGreaterThan(0);

    // Every monetary field is null, and — the assertion that actually matters —
    // no price VALUE appears anywhere in the serialised result.
    expect(result.lines[0].unitPriceCents).toBeNull();
    expect(result.lines[0].unitPriceCentsSnapshot).toBeNull();
    expect(result.lines[0].totalCostCents).toBeNull();
    expect(JSON.stringify(result)).not.toContain('45000');
  });

  it('gives an owner the same line with its money intact', async () => {
    const result = (await run('owner', 'get_material_calculations')) as {
      lines: { totalCostCents: number | null }[];
    };
    expect(result.lines[0].totalCostCents).toBeGreaterThan(0);
  });

  it('keeps the calculation steps for a cost-blind role, because they carry no money', async () => {
    const result = (await run('worker', 'get_material_calculations')) as {
      lines: { steps: { label: string }[] }[];
    };
    expect(result.lines[0].steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.lines[0].steps)).not.toContain('Cents');
  });

  it('strips the money out of an efficiency recommendation for a cost-blind role', async () => {
    const result = (await run('worker', 'get_material_recommendations')) as {
      recommendations: {
        savingCents: number | null;
        current: { totalCostCents: number | null };
        alternative: { totalCostCents: number | null };
        summary: string;
      }[];
      showsPrices: boolean;
      emptyReason: string | null;
    };

    expect(result.showsPrices).toBe(false);
    for (const recommendation of result.recommendations) {
      expect(recommendation.savingCents).toBeNull();
      expect(recommendation.current.totalCostCents).toBeNull();
      expect(recommendation.alternative.totalCostCents).toBeNull();
      // The engine's own summary quotes both totals, so it must have been
      // replaced rather than forwarded.
      expect(recommendation.summary).not.toMatch(/\d+\.\d{2}/);
    }
  });
});

describe('reading computed state', () => {
  it('reports readiness and blockers rather than an opinion', async () => {
    const result = (await run('owner', 'get_project_readiness')) as {
      readiness: { quote: { ready: boolean }; production: { ready: boolean } };
      findings: { code: string }[];
    };
    expect(typeof result.readiness.quote.ready).toBe('boolean');
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('returns no cutting plan when none has been computed, rather than an empty layout', async () => {
    const result = (await run('owner', 'get_cutting_plans')) as {
      sheetPlans: unknown[];
      linearPlans: unknown[];
    };
    expect(result.sheetPlans).toEqual([]);
    expect(result.linearPlans).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Quotations (T22.1)                                                         */
/* -------------------------------------------------------------------------- */

describe('the quote tool', () => {
  it('returns the stored quotation to a role that may read one', async () => {
    const result = (await run('sales', 'get_quote')) as {
      quote: {
        number: string;
        status: string;
        currency: string;
        subtotalCents: number;
        totalCents: number;
        lines: { description: string; unitPriceCents: number; lineTotalCents: number }[];
      };
    };

    // Figures come from the stored rows, not from anything the tool computes.
    expect(result.quote.number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(result.quote.subtotalCents).toBe(QUOTE_SUBTOTAL_CENTS);
    expect(result.quote.lines).toHaveLength(1);
    expect(result.quote.lines[0].unitPriceCents).toBe(QUOTE_UNIT_PRICE_CENTS);
    expect(result.quote.lines[0].lineTotalCents).toBe(QUOTE_SUBTOTAL_CENTS);
    expect(result.quote.currency).toBe('MAD');
  });

  it('gives production the client figures and NOT the internal comparison', async () => {
    // The mandatory case: quote.view yes, cost.view no.
    const result = (await run('production', 'get_quote')) as {
      quote: { subtotalCents: number };
      calculatedSubtotalCents: number | null;
      divergence: unknown;
      note: string;
    };

    // The client-facing price is theirs to see.
    expect(result.quote.subtotalCents).toBe(QUOTE_SUBTOTAL_CENTS);

    // The internal figure is not, in any form.
    expect(result.calculatedSubtotalCents).toBeNull();
    expect(result.divergence).toBeNull();

    // Falsifiable: the engine's own number must appear nowhere in the payload.
    expect(internalSubtotalCents).toBeGreaterThan(0);
    expect(internalSubtotalCents).not.toBe(QUOTE_SUBTOTAL_CENTS);
    expect(JSON.stringify(result)).not.toContain(String(internalSubtotalCents));

    // And the model is told not to reason its way to one.
    expect(result.note).toMatch(/margin/i);
  });

  it('gives an owner the internal comparison, because they may see cost', async () => {
    const result = (await run('owner', 'get_quote')) as {
      calculatedSubtotalCents: number | null;
      divergence: { differenceCents: number; direction: string } | null;
    };

    expect(result.calculatedSubtotalCents).toBe(internalSubtotalCents);
    // The quote was repriced away from the calculation, so a divergence exists
    // and the engine — not the model — computed it.
    expect(result.divergence).not.toBeNull();
    expect(result.divergence?.differenceCents).toBe(
      Math.abs(QUOTE_SUBTOTAL_CENTS - internalSubtotalCents)
    );
  });

  it('is never handed to a role without quote.view', async () => {
    for (const role of ['designer', 'worker'] as const) {
      const access = await resolveProjectAiAccess(projectId, userIds[role]);
      expect(buildToolbox(access).map((tool) => tool.name), role).not.toContain('get_quote');
    }
  });

  it('refuses the permission even if the tool is reached another way', async () => {
    // A worker's toolbox has no quote tool, so borrow an authorised one and run
    // it as the worker. The service must refuse regardless of composition.
    const salesAccess = await resolveProjectAiAccess(projectId, userIds.sales);
    const tool = buildToolbox(salesAccess).find((entry) => entry.name === 'get_quote');
    expect(tool).toBeDefined();

    const smuggled = buildToolbox({ ...salesAccess, userId: userIds.worker }).find(
      (entry) => entry.name === 'get_quote'
    );
    // The toolbox is built from the ROLE, which is still sales here, so the
    // tool exists — and the service still refuses the worker underneath it.
    await expect(smuggled!.execute({})).rejects.toMatchObject({ status: 403 });
  });

  it('cannot be pointed at another workspace, whatever the model sends', async () => {
    await expect(resolveProjectAiAccess(outsiderProjectId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects any argument at all', async () => {
    await expect(run('sales', 'get_quote', { quoteId: 'anything' })).rejects.toThrow();
    await expect(run('sales', 'get_quote', { projectId: outsiderProjectId })).rejects.toThrow();
  });

  it('says plainly when a project has no quotation', async () => {
    const bare = await createProject(workspaceId, userIds.owner, { title: `Unquoted ${suffix}` });
    const access = await resolveProjectAiAccess(bare.id, userIds.sales);
    const tool = buildToolbox(access).find((entry) => entry.name === 'get_quote');

    const result = (await tool!.execute({})) as { quote: null; note: string };
    expect(result.quote).toBeNull();
    expect(result.note).toMatch(/no quotation exists/i);
  });
});
