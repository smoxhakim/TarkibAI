/**
 * The agent's first quotation WRITE (T22.3), against real rows.
 *
 * Creating a quotation is not free even as a draft: it takes the next number in
 * the business's quote sequence, and an abandoned draft leaves a gap a client
 * may one day ask about. So the tool is split in two and the split is enforced
 * by the server rather than by the prompt:
 *
 *  - `confirmed: false` PREVIEWS. It writes nothing.
 *  - `confirmed: true` CREATES, and only if the most recent PERSISTED assistant
 *    turn previewed exactly this quotation and did not already create it.
 *
 * Turns are persisted after the agent finishes, so a preview from the current
 * turn is invisible to the commit — the agent cannot ask and answer its own
 * question. These tests write the persisted turn the way `runConversationTurn`
 * does, then drive the tool, then count quotations.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
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
import { computeProjectCost, getProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { resolveProjectAiAccess } from '../access';
import { buildToolbox } from './index';

const suffix = `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
let materialId: string;
let outsiderId: string;
let outsiderProjectId: string;

const canCreate = WORKSPACE_ROLES.filter((role) => can(role, 'quote.create'));
const cannotCreate = WORKSPACE_ROLES.filter((role) => !can(role, 'quote.create'));

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

const CLIENT = { clientName: 'Restaurant Al Firdaous', title: 'Enseigne façade' };

type Created = {
  created: boolean;
  refused?: string;
  alreadyCreated?: string;
  preview?: Record<string, unknown> | null;
  blockedReason?: string | null;
  quote?: {
    number: string;
    status: string;
    clientName: string;
    subtotalCents: number;
    totalCents: number;
    lines: { unitPriceCents: number }[];
  };
  note: string;
};

/** A project with a computed cost, so a quotation can actually be priced. */
async function costedProject(): Promise<string> {
  const project = await createProject(workspaceId, userIds.owner, {
    title: `Quote creation ${Math.random()}`,
  });
  await updateDraftSpec(project.id, userIds.owner, SPEC);
  await approveSpec(project.id, userIds.owner);
  const selected = await selectProjectMaterial(project.id, userIds.owner, materialId, 'Face');
  await updateProjectMaterialRequirement(project.id, userIds.owner, selected[0].id, {
    requiredQuantity: 18,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, userIds.owner);
  await computeProjectCost(project.id, userIds.owner);
  return project.id;
}

/** The toolbox exactly as one turn of `runConversationTurn` would build it. */
async function turn(projectId: string, role: WorkspaceRole) {
  const access = await resolveProjectAiAccess(projectId, userIds[role]);
  return buildToolbox(access);
}

async function createQuoteTool(projectId: string, role: WorkspaceRole) {
  const tool = (await turn(projectId, role)).find((entry) => entry.name === 'create_quote');
  if (!tool) throw new Error(`${role} has no create_quote`);
  return tool;
}

/**
 * Persists an assistant turn the way `runConversationTurn` does: text plus the
 * tool calls the agent made. `at` is explicit so two turns never share a
 * timestamp and "most recent" is unambiguous.
 */
async function persistTurn(projectId: string, calls: { name: string; arguments: unknown }[], at: Date) {
  await prisma.chatMessage.create({
    data: { projectId, role: 'user', content: 'x', createdAt: new Date(at.getTime() - 1) },
  });
  await prisma.chatMessage.create({
    data: { projectId, role: 'assistant', content: 'y', toolCalls: calls as object, createdAt: at },
  });
}

const quoteCount = (projectId: string) => prisma.quote.count({ where: { projectId } });

beforeAll(async () => {
  const users = await Promise.all(
    WORKSPACE_ROLES.map((role) =>
      prisma.user.create({
        data: { clerkId: `${role}-${suffix}`, email: `${role}-${suffix}@example.test` },
      })
    )
  );
  WORKSPACE_ROLES.forEach((role, index) => {
    userIds[role] = users[index].id;
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Quote creation ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

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

  const material = await createMaterial(workspaceId, userIds.owner, {
    name: `Alucobond ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 45_000,
  });
  materialId = material.id;

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const otherWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });
  const otherProject = await createProject(asWorkspaceId(otherWorkspace.id), outsiderId, {
    title: `Other ${suffix}`,
  });
  outsiderProjectId = otherProject.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Who may create                                                              */
/* -------------------------------------------------------------------------- */

describe('the permission creating a quotation takes', () => {
  it('is quote.create, which production and the worker do not hold', () => {
    expect(can('sales', 'quote.create')).toBe(true);
    expect(can('production', 'quote.create')).toBe(false);
    expect(can('worker', 'quote.create')).toBe(false);
    expect(can('designer', 'quote.create')).toBe(false);
  });

  it('never grants creation to a role that cannot see the cost it is priced from', () => {
    // `createQuote` reads the project cost, which needs `cost.view`. That is an
    // existing coupling in the quote service, and it is only harmless while
    // every role that may create a quote may also see cost. Asserted so a
    // matrix change that broke it would fail here, not in production.
    for (const role of WORKSPACE_ROLES) {
      if (can(role, 'quote.create')) expect(can(role, 'cost.view'), role).toBe(true);
    }
  });

  it.each(cannotCreate)('is not given to %s at all', async (role) => {
    const project = await costedProject();
    const names = (await turn(project, role)).map((tool) => tool.name);
    expect(names).not.toContain('create_quote');
  });

  it('refuses a borrowed tool at the service, and creates nothing', async () => {
    // Composed for sales, run as production: the grant is present, the identity
    // is not allowed. The service must refuse regardless of the toolbox.
    const project = await costedProject();
    const salesAccess = await resolveProjectAiAccess(project, userIds.sales);
    const smuggled = buildToolbox({ ...salesAccess, userId: userIds.production }).find(
      (tool) => tool.name === 'create_quote'
    );

    await expect(smuggled!.execute({ ...CLIENT, confirmed: false })).rejects.toMatchObject({
      status: 403,
    });
    expect(await quoteCount(project)).toBe(0);
  });

  it('cannot be pointed at another workspace', async () => {
    await expect(resolveProjectAiAccess(outsiderProjectId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Preview writes nothing                                                      */
/* -------------------------------------------------------------------------- */

describe('previewing a quotation', () => {
  it.each(canCreate)('writes nothing for %s', async (role) => {
    const project = await costedProject();
    const tool = await createQuoteTool(project, role);

    const result = (await tool.execute({ ...CLIENT, confirmed: false })) as Created;

    expect(result.created).toBe(false);
    expect(result.preview?.clientName).toBe(CLIENT.clientName);
    expect(result.preview?.status).toBe('draft');
    expect(result.note).toMatch(/NOTHING HAS BEEN CREATED/);
    expect(await quoteCount(project)).toBe(0);
  });

  it('shows the subtotal it will be priced at, straight from the cost engine', async () => {
    const project = await costedProject();
    const cost = await getProjectCost(project, userIds.owner);
    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: false,
    })) as Created;

    expect(result.preview?.pricedAtSubtotalCents).toBe(cost.cost?.clientSubtotalCents);
  });

  it('says so when there is no cost to price from, and offers nothing', async () => {
    const { id: project } = await createProject(workspaceId, userIds.owner, {
      title: `Uncosted ${suffix}`,
    });
    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: false,
    })) as Created;

    expect(result.created).toBe(false);
    expect(result.preview).toBeNull();
    expect(result.blockedReason).toBeTruthy();
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Creation requires a confirmed preview from the previous turn                */
/* -------------------------------------------------------------------------- */

describe('creating a quotation', () => {
  it('is refused with no preview at all, and writes nothing', async () => {
    const project = await costedProject();
    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;

    expect(result.created).toBe(false);
    expect(result.refused).toBe('no_preview');
    expect(result.note).toMatch(/NOTHING WAS CREATED/);
    expect(await quoteCount(project)).toBe(0);
  });

  it('is refused when the preview was made in the SAME turn', async () => {
    // The agent previews and then immediately confirms without the user ever
    // replying. Nothing from this turn is persisted yet, so there is no preview
    // to confirm against — which is exactly the point.
    const project = await costedProject();
    const tool = await createQuoteTool(project, 'sales');

    await tool.execute({ ...CLIENT, confirmed: false });
    const result = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;

    expect(result.created).toBe(false);
    expect(result.refused).toBe('no_preview');
    expect(await quoteCount(project)).toBe(0);
  });

  it.each(canCreate)(
    'creates exactly one draft for %s after a preview in the previous turn',
    async (role) => {
      const project = await costedProject();
      await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());

      const result = (await (await createQuoteTool(project, role)).execute({
        ...CLIENT,
        confirmed: true,
      })) as Created;

      expect(result.created).toBe(true);
      expect(await quoteCount(project)).toBe(1);
      expect(result.note).toMatch(/DRAFT/);
    }
  );

  it('leaves the number, status and figures to the quote service', async () => {
    const project = await costedProject();
    const cost = await getProjectCost(project, userIds.owner);
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());

    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;

    // Numbered by the workspace sequence, never by the model.
    expect(result.quote?.number).toMatch(/^Q-\d{4}-\d{4}$/);
    // Creation is never issuing.
    expect(result.quote?.status).toBe('draft');
    // Priced at the engine's client subtotal, as one line.
    expect(result.quote?.subtotalCents).toBe(cost.cost?.clientSubtotalCents);
    expect(result.quote?.lines).toHaveLength(1);
    expect(result.quote?.lines[0].unitPriceCents).toBe(cost.cost?.clientSubtotalCents);
    // And the stored row agrees with what the tool reported.
    const stored = await prisma.quote.findFirstOrThrow({ where: { projectId: project } });
    expect(stored.number).toBe(result.quote?.number);
    expect(stored.totalCents).toBe(result.quote?.totalCents);
    expect(stored.status).toBe('draft');
  });

  it('is refused when the details differ from the preview the user saw', async () => {
    const project = await costedProject();
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());

    const result = (await (await createQuoteTool(project, 'sales')).execute({
      clientName: 'Somebody Else Entirely',
      confirmed: true,
    })) as Created;

    expect(result.created).toBe(false);
    expect(result.refused).toBe('changed');
    expect(await quoteCount(project)).toBe(0);
  });

  it('matches a preview that differed only in whitespace', async () => {
    // The service's own schema trims, so the comparison does too.
    const project = await costedProject();
    await persistTurn(
      project,
      [{ name: 'create_quote', arguments: { clientName: `  ${CLIENT.clientName}  `, title: CLIENT.title, confirmed: false } }],
      new Date()
    );

    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;
    expect(result.created).toBe(true);
  });

  it('creates only once when the model confirms twice in one turn', async () => {
    const project = await costedProject();
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());
    const tool = await createQuoteTool(project, 'sales');

    const first = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;
    const second = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.alreadyCreated).toBe(first.quote?.number);
    expect(await quoteCount(project)).toBe(1);
  });

  it('is refused in a later turn once that preview has been acted on', async () => {
    const project = await costedProject();
    const t0 = Date.now();
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date(t0));
    await (await createQuoteTool(project, 'sales')).execute({ ...CLIENT, confirmed: true });

    // The turn that created it is now the most recent persisted turn.
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: true } }], new Date(t0 + 10));

    const again = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;

    expect(again.created).toBe(false);
    expect(again.refused).toBe('already_committed');
    expect(await quoteCount(project)).toBe(1);
  });

  it('is refused when the user changed the subject in between', async () => {
    // Confirmation has to be immediate: an intervening turn with no preview
    // makes the earlier preview stale.
    const project = await costedProject();
    const t0 = Date.now();
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date(t0));
    await persistTurn(project, [{ name: 'get_project_readiness', arguments: {} }], new Date(t0 + 10));

    const result = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;

    expect(result.refused).toBe('no_preview');
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

describe('what the model may send', () => {
  it('rejects a quotation with no client', async () => {
    const project = await costedProject();
    const tool = await createQuoteTool(project, 'sales');
    await expect(tool.execute({ confirmed: false })).rejects.toThrow();
    await expect(tool.execute({ clientName: '   ', confirmed: false })).rejects.toThrow();
    expect(await quoteCount(project)).toBe(0);
  });

  it('rejects a price, a status or a project it has no business sending', async () => {
    const project = await costedProject();
    const tool = await createQuoteTool(project, 'sales');
    for (const extra of [
      { unitPriceCents: 1 },
      { totalCents: 1 },
      { status: 'issued' },
      { number: 'Q-2099-0001' },
      { projectId: outsiderProjectId },
    ]) {
      await expect(tool.execute({ ...CLIENT, confirmed: false, ...extra })).rejects.toThrow();
    }
    expect(await quoteCount(project)).toBe(0);
  });

  it('requires the confirmation flag to be stated', async () => {
    const project = await costedProject();
    await expect((await createQuoteTool(project, 'sales')).execute({ ...CLIENT })).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

describe('the financial boundary', () => {
  it('returns client-facing figures and no internal cost', async () => {
    const project = await costedProject();
    const cost = await getProjectCost(project, userIds.owner);
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());

    const preview = await (await createQuoteTool(project, 'sales')).execute({ ...CLIENT, confirmed: false });
    const created = await (await createQuoteTool(project, 'sales')).execute({ ...CLIENT, confirmed: true });

    // The internal total (before margin) and the margin itself are not what a
    // quotation is; neither belongs in what the agent is handed here.
    const internal = cost.cost!.internalTotalCents;
    const margin = cost.cost!.marginCents;
    expect(internal).not.toBe(cost.cost!.clientSubtotalCents);
    for (const payload of [preview, created]) {
      const text = JSON.stringify(payload);
      expect(text).not.toMatch(/internalTotalCents|marginCents|materialsCostCents|laborCostCents/);
      expect(text).not.toContain(`:${internal},`);
      expect(text).not.toContain(`:${margin},`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* T22.1 and T22.2 still read what T22.3 writes                                */
/* -------------------------------------------------------------------------- */

describe('reading back', () => {
  it('lets get_quote read the draft the agent created', async () => {
    const project = await costedProject();
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());
    const created = (await (await createQuoteTool(project, 'sales')).execute({
      ...CLIENT,
      confirmed: true,
    })) as Created;

    const read = (await (await turn(project, 'production'))
      .find((tool) => tool.name === 'get_quote')!
      .execute({})) as { quote: { number: string; status: string; hasDocument: boolean } };

    expect(read.quote.number).toBe(created.quote?.number);
    expect(read.quote.status).toBe('draft');
    // Nothing was issued, so there is no document to send.
    expect(read.quote.hasDocument).toBe(false);
  });
});
