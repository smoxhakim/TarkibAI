/**
 * The agent's first quotation WRITE (T22.3), against real rows.
 *
 * Creating a quotation is not free even as a draft: it takes the next number in
 * the business's quote sequence, and an abandoned draft leaves a gap a client
 * may one day ask about. So the tool is split in two and the split is enforced
 * by the server rather than by the prompt:
 *
 *  - `confirmed: false` PREVIEWS. It writes nothing, and the application — not
 *    the model — shows the user a confirmation code.
 *  - `confirmed: true` CREATES, and only if the most recent PERSISTED assistant
 *    turn previewed exactly this quotation, nothing has been created from that
 *    preview since, and the user's message this turn is that code and nothing
 *    else.
 *
 * The invariant every test here defends: NO explicit confirmation, NO quotation.
 * "wakha", "ok", a question, a refusal, a change of details, a replay, a double
 * submit or a model that simply decides to send `confirmed: true` must all end
 * with the same count of quotations they started with.
 *
 * Turns are persisted after the agent finishes, so a preview from the current
 * turn is invisible to the commit. These tests drive the tool the way one turn
 * of `runConversationTurn` does — toolbox built with the user's message — and
 * write the persisted turn the way it does, then count quotations.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject, updateProject } from '@/lib/projects/service';
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
import { withConfirmationLock } from './confirmation';
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

/**
 * The toolbox exactly as one turn of `runConversationTurn` builds it: for this
 * person, carrying the message they sent to start the turn, and collecting the
 * lines the application appends to the reply.
 */
async function turn(
  projectId: string,
  role: WorkspaceRole,
  userMessage?: string,
  notices: string[] = []
) {
  const access = await resolveProjectAiAccess(projectId, userIds[role]);
  return buildToolbox(access, { userMessage, notices });
}

async function createQuoteTool(
  projectId: string,
  role: WorkspaceRole,
  userMessage?: string,
  notices?: string[]
) {
  const tool = (await turn(projectId, role, userMessage, notices)).find(
    (entry) => entry.name === 'create_quote'
  );
  if (!tool) throw new Error(`${role} has no create_quote`);
  return tool;
}

/** The code in the confirmation line the application appended. */
function shownCode(notices: string[]): string {
  const match = notices.join('\n').match(/reply with only this code: (\d{6})\./);
  if (!match) throw new Error(`No confirmation code was shown: ${JSON.stringify(notices)}`);
  return match[1];
}

/**
 * Persists a turn the way `runConversationTurn` does: the user's message, then
 * the assistant's text plus the tool calls the agent made. `at` is explicit so
 * two turns never share a timestamp and "most recent" is unambiguous.
 */
async function persistTurn(projectId: string, calls: { name: string; arguments: unknown }[], at: Date) {
  await prisma.chatMessage.create({
    data: { projectId, role: 'user', content: 'x', createdAt: new Date(at.getTime() - 1) },
  });
  await prisma.chatMessage.create({
    data: { projectId, role: 'assistant', content: 'y', toolCalls: calls as object, createdAt: at },
  });
}

/**
 * A whole preview turn: the agent previews, the application shows a code, and
 * the turn is persisted. Returns the code the user was shown.
 */
async function previewTurn(
  projectId: string,
  role: WorkspaceRole = 'sales',
  details: Record<string, unknown> = CLIENT,
  at: Date = new Date()
): Promise<string> {
  const notices: string[] = [];
  await (await createQuoteTool(projectId, role, 'dir lia quote', notices)).execute({
    ...details,
    confirmed: false,
  });
  await persistTurn(projectId, [{ name: 'create_quote', arguments: { ...details, confirmed: false } }], at);
  return shownCode(notices);
}

/** The next turn: the user sent `message`, and the model confirms `details`. */
async function confirmTurn(
  projectId: string,
  message: string | undefined,
  role: WorkspaceRole = 'sales',
  details: Record<string, unknown> = CLIENT
): Promise<Created> {
  const tool = await createQuoteTool(projectId, role, message);
  return (await tool.execute({ ...details, confirmed: true })) as Created;
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

  it('refuses a borrowed tool at the service — preview and commit — and creates nothing', async () => {
    // Composed for sales, run as production: the grant is present, the identity
    // is not allowed. Even with a genuine code in the message, the permission
    // is asserted before anything else runs.
    const project = await costedProject();
    const code = await previewTurn(project);
    const salesAccess = await resolveProjectAiAccess(project, userIds.sales);
    const smuggled = buildToolbox(
      { ...salesAccess, userId: userIds.production },
      { userMessage: code, notices: [] }
    ).find((tool) => tool.name === 'create_quote')!;

    await expect(smuggled.execute({ ...CLIENT, confirmed: false })).rejects.toMatchObject({ status: 403 });
    await expect(smuggled.execute({ ...CLIENT, confirmed: true })).rejects.toMatchObject({ status: 403 });
    expect(await quoteCount(project)).toBe(0);
  });

  it('will not confirm a preview that was shown to somebody else', async () => {
    // The chat is shared by the project's members. The code is bound to the
    // person it was shown to, so a colleague — even the owner — sending it
    // creates nothing; they would have to preview it themselves.
    const project = await costedProject();
    const code = await previewTurn(project, 'sales');

    const result = await confirmTurn(project, code, 'owner');

    expect(result.created).toBe(false);
    expect(result.refused).toBe('code_mismatch');
    expect(await quoteCount(project)).toBe(0);
  });

  it('cannot be pointed at another workspace', async () => {
    await expect(resolveProjectAiAccess(outsiderProjectId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a toolbox forged for another workspace\'s project, with a code or without', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);
    const ownAccess = await resolveProjectAiAccess(project, userIds.sales);
    const forged = buildToolbox(
      { ...ownAccess, projectId: outsiderProjectId },
      { userMessage: code, notices: [] }
    ).find((tool) => tool.name === 'create_quote')!;

    await expect(forged.execute({ ...CLIENT, confirmed: false })).rejects.toMatchObject({ status: 404 });
    await expect(forged.execute({ ...CLIENT, confirmed: true })).rejects.toMatchObject({ status: 404 });
    expect(await quoteCount(outsiderProjectId)).toBe(0);
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Preview writes nothing                                                      */
/* -------------------------------------------------------------------------- */

describe('previewing a quotation', () => {
  it.each(canCreate)('writes nothing for %s, and has the application show a code', async (role) => {
    const project = await costedProject();
    const notices: string[] = [];
    const tool = await createQuoteTool(project, role, 'dir lia quote', notices);

    const result = (await tool.execute({ ...CLIENT, confirmed: false })) as Created;

    expect(result.created).toBe(false);
    expect(result.preview?.clientName).toBe(CLIENT.clientName);
    expect(result.preview?.status).toBe('draft');
    expect(result.note).toMatch(/NOTHING HAS BEEN CREATED/);
    // The application's own line names what the code creates.
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(CLIENT.clientName);
    expect(notices[0]).toContain(CLIENT.title);
    expect(notices[0]).toMatch(/DRAFT/);
    expect(notices[0]).toMatch(/Any other reply creates nothing/);
    expect(await quoteCount(project)).toBe(0);
  });

  it('never hands the code to the model', async () => {
    // A model that does not know the code cannot wrap it in a sentence that
    // misdescribes what sending it does.
    const project = await costedProject();
    const notices: string[] = [];
    const result = await (await createQuoteTool(project, 'sales', 'dir lia quote', notices)).execute({
      ...CLIENT,
      confirmed: false,
    });

    const code = shownCode(notices);
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`\\b${code}\\b`));
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

  it('names the title the quotation will really carry when none was given', async () => {
    const project = await costedProject();
    const { title } = await prisma.project.findUniqueOrThrow({ where: { id: project } });
    const notices: string[] = [];
    const result = (await (await createQuoteTool(project, 'sales', 'x', notices)).execute({
      clientName: CLIENT.clientName,
      confirmed: false,
    })) as Created;

    expect(result.preview?.title).toBe(title);
    expect(notices[0]).toContain(title);
  });

  it('says so when there is no cost to price from, and offers nothing', async () => {
    const { id: project } = await createProject(workspaceId, userIds.owner, {
      title: `Uncosted ${suffix}`,
    });
    const notices: string[] = [];
    const result = (await (await createQuoteTool(project, 'sales', 'x', notices)).execute({
      ...CLIENT,
      confirmed: false,
    })) as Created;

    expect(result.created).toBe(false);
    expect(result.preview).toBeNull();
    expect(result.blockedReason).toBeTruthy();
    expect(notices).toEqual([]);
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 1. Explicit confirmation creates exactly one                                */
/* -------------------------------------------------------------------------- */

describe('an explicit confirmation', () => {
  it.each(canCreate)('— the code, sent by %s in the next turn — creates exactly one draft', async (role) => {
    const project = await costedProject();
    const code = await previewTurn(project, role);

    const result = await confirmTurn(project, code, role);

    expect(result.created).toBe(true);
    expect(result.note).toMatch(/DRAFT/);
    expect(await quoteCount(project)).toBe(1);
  });

  it.each([
    ['with spaces around it', (code: string) => `  ${code}  `],
    ['split by a space', (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`],
    ['with a trailing full stop', (code: string) => `${code}.`],
    [
      'typed in Arabic-Indic digits',
      (code: string) => code.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit))),
    ],
  ])('is accepted %s', async (_label, format) => {
    const project = await costedProject();
    const code = await previewTurn(project);

    const result = await confirmTurn(project, format(code));

    expect(result.created).toBe(true);
    expect(await quoteCount(project)).toBe(1);
  });

  it('leaves the number, status and figures to the quote service', async () => {
    const project = await costedProject();
    const cost = await getProjectCost(project, userIds.owner);
    const code = await previewTurn(project);

    const result = await confirmTurn(project, code);

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
    expect(stored.userId).toBe(userIds.sales);
  });

  it('matches a preview that differed only in whitespace', async () => {
    // The service's own schema trims, so the comparison — and the code — do too.
    const project = await costedProject();
    const code = await previewTurn(project, 'sales', {
      clientName: `  ${CLIENT.clientName}  `,
      title: CLIENT.title,
    });

    const result = await confirmTurn(project, code);
    expect(result.created).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 2–4. Acknowledgement, clarification, rejection create nothing                */
/* -------------------------------------------------------------------------- */

describe('a reply that is not the code', () => {
  // Each one follows a genuine preview, and in each one the model sends
  // `confirmed: true` anyway — the worst case. The server alone must refuse.
  it.each([
    // 2. Acknowledgement. "wakha" is the case the Darija module warns about.
    ['acknowledgement', 'wakha'],
    ['acknowledgement', 'ok'],
    ['acknowledgement', 'okay'],
    ['acknowledgement', 'iyeh'],
    ['acknowledgement', 'oui'],
    ['acknowledgement', 'iyeh, dirha. confirm.'],
    // 3. Clarification — including one that quotes the code.
    ['clarification', 'chhal ghadi ykoun TVA?'],
    ['clarification', 'wach {code} howa l code?'],
    ['clarification', '{code}?'],
    // 4. Rejection — including one that quotes the code.
    ['rejection', 'la'],
    ['rejection', 'la, ma bghitch daba. ma tdir walu.'],
    ['rejection', 'la, ma tdirch {code}'],
    // Unrelated.
    ['an unrelated message', 'chno lmaterial li khtarina?'],
  ])('— %s: "%s" — creates nothing', async (_kind, template) => {
    const project = await costedProject();
    const code = await previewTurn(project);

    const result = await confirmTurn(project, template.replace('{code}', code));

    expect(result.created).toBe(false);
    expect(result.refused).toBe('not_confirmed');
    expect(result.note).toMatch(/NOTHING WAS CREATED/);
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the turn carries no user message at all', async () => {
    // A toolbox built without the user's words — a harness, a future caller
    // that forgets to pass them — fails closed.
    const project = await costedProject();
    await previewTurn(project);

    const result = await confirmTurn(project, undefined);

    expect(result.refused).toBe('not_confirmed');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the model confirms in the same turn it previewed, even if the user sent a code', async () => {
    // Nothing from this turn is persisted yet, so there is no preview to
    // confirm against — the agent cannot ask and answer its own question.
    const project = await costedProject();
    const notices: string[] = [];
    const tool = await createQuoteTool(project, 'sales', '123456', notices);

    await tool.execute({ ...CLIENT, confirmed: false });
    const result = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;

    expect(result.created).toBe(false);
    expect(result.refused).toBe('no_preview');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing with no preview at all, whatever the user sent', async () => {
    const project = await costedProject();
    const result = await confirmTurn(project, '123456');

    expect(result.created).toBe(false);
    expect(result.refused).toBe('no_preview');
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Changed details invalidate the confirmation                               */
/* -------------------------------------------------------------------------- */

describe('a confirmation after something changed', () => {
  it('creates nothing when the model commits a different client than it previewed', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);

    const result = await confirmTurn(project, code, 'sales', {
      clientName: 'Somebody Else Entirely',
    });

    expect(result.created).toBe(false);
    expect(result.refused).toBe('changed');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the price changed after the preview', async () => {
    // The user agreed to a quotation priced from ONE cost calculation. A
    // recalculation in between — here, more material — is a different price.
    const project = await costedProject();
    const before = await getProjectCost(project, userIds.owner);
    const code = await previewTurn(project);

    const [selected] = await prisma.projectMaterial.findMany({ where: { projectId: project } });
    await updateProjectMaterialRequirement(project, userIds.owner, selected.id, {
      requiredQuantity: 40,
      requiredDimensions: null,
    });
    await calculateProjectMaterials(project, userIds.owner);
    await computeProjectCost(project, userIds.owner);
    const after = await getProjectCost(project, userIds.owner);
    expect(after.cost?.clientSubtotalCents).not.toBe(before.cost?.clientSubtotalCents);

    const result = await confirmTurn(project, code);

    expect(result.created).toBe(false);
    expect(result.refused).toBe('code_mismatch');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the title it would carry changed after the preview', async () => {
    // No title was given, so the quotation takes the project's. Renaming the
    // project changes what the client would read.
    const project = await costedProject();
    const code = await previewTurn(project, 'sales', { clientName: CLIENT.clientName });

    await updateProject(project, userIds.owner, { title: `Renamed ${suffix}` });

    const result = await confirmTurn(project, code, 'sales', { clientName: CLIENT.clientName });

    expect(result.refused).toBe('code_mismatch');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the code was mistyped', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);
    const wrong = `${code.slice(0, 5)}${(Number(code[5]) + 1) % 10}`;

    const result = await confirmTurn(project, wrong);

    expect(result.refused).toBe('code_mismatch');
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Old previews cannot be replayed                                          */
/* -------------------------------------------------------------------------- */

describe('replaying an old confirmation', () => {
  it('creates nothing when the user changed the subject in between', async () => {
    // Confirmation has to be immediate: an intervening turn with no preview
    // makes the earlier preview stale.
    const project = await costedProject();
    const t0 = Date.now();
    const code = await previewTurn(project, 'sales', CLIENT, new Date(t0));
    await persistTurn(project, [{ name: 'get_project_readiness', arguments: {} }], new Date(t0 + 10));

    const result = await confirmTurn(project, code);

    expect(result.refused).toBe('no_preview');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when an earlier preview\'s code is sent against a later preview', async () => {
    const project = await costedProject();
    const t0 = Date.now();
    const oldCode = await previewTurn(project, 'sales', { clientName: 'Old Client' }, new Date(t0));
    await previewTurn(project, 'sales', CLIENT, new Date(t0 + 10));

    // The model commits what is on screen now; the user sent the old code.
    const current = await confirmTurn(project, oldCode);
    // The model commits the old preview; it is no longer the previous turn's.
    const old = await confirmTurn(project, oldCode, 'sales', { clientName: 'Old Client' });

    expect(current.refused).toBe('code_mismatch');
    expect(old.refused).toBe('changed');
    expect(await quoteCount(project)).toBe(0);
  });

  it('creates nothing when the code is sent again after the quotation was created', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);
    expect((await confirmTurn(project, code)).created).toBe(true);

    // The turn that created it is now the most recent persisted turn.
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: true } }], new Date());

    const again = await confirmTurn(project, code);

    expect(again.created).toBe(false);
    expect(again.refused).toBe('already_committed');
    expect(await quoteCount(project)).toBe(1);
  });

  it('creates nothing from a preview a refused confirmation already spent', async () => {
    // Turn 2: the user said "wakha" and the model confirmed anyway — refused.
    // Turn 3: the user now sends the code. The preview is two turns back, and
    // turn 2 already tried to act on it: the agent has to preview again.
    const project = await costedProject();
    const t0 = Date.now();
    const code = await previewTurn(project, 'sales', CLIENT, new Date(t0));
    expect((await confirmTurn(project, 'wakha')).refused).toBe('not_confirmed');
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: true } }], new Date(t0 + 10));

    const result = await confirmTurn(project, code);

    expect(result.refused).toBe('already_committed');
    expect(await quoteCount(project)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. A duplicate confirmation creates no duplicate                            */
/* -------------------------------------------------------------------------- */

describe('a duplicate confirmation', () => {
  it('creates only once when the model confirms twice in one turn', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);
    const tool = await createQuoteTool(project, 'sales', code);

    const first = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;
    const second = (await tool.execute({ ...CLIENT, confirmed: true })) as Created;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.alreadyCreated).toBe(first.quote?.number);
    expect(await quoteCount(project)).toBe(1);
  });

  it('creates only once when a second request arrives before the first turn is persisted', async () => {
    // A double submit: the first turn created the quotation but has not been
    // persisted yet, so its recorded call is not there to find. The quotation
    // itself is.
    const project = await costedProject();
    const code = await previewTurn(project);

    const first = await confirmTurn(project, code);
    const second = await confirmTurn(project, code);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.refused).toBe('already_committed');
    expect(await quoteCount(project)).toBe(1);
  });

  it('creates only once when two requests confirm at the same moment', async () => {
    // Two tabs, a double click, a retried request: both carry the code, both
    // read the preview as unspent. The lock makes one of them go second.
    const project = await costedProject();
    const code = await previewTurn(project);
    const [a, b] = await Promise.all([createQuoteTool(project, 'sales', code), createQuoteTool(project, 'sales', code)]);

    const results = (await Promise.all([
      a.execute({ ...CLIENT, confirmed: true }),
      b.execute({ ...CLIENT, confirmed: true }),
    ])) as Created[];

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.find((result) => !result.created)?.refused).toBe('already_committed');
    expect(await quoteCount(project)).toBe(1);
  });

  it('serialises confirmations on one project behind a database lock', async () => {
    // The lock itself, without the quote service in the way: two critical
    // sections on the same key run one after the other, never interleaved.
    const key = `lock-${suffix}`;
    const events: string[] = [];
    const section = (name: string) => async () => {
      events.push(`${name}:in`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      events.push(`${name}:out`);
    };

    await Promise.all([
      withConfirmationLock(key, 'create_quote', section('a')),
      withConfirmationLock(key, 'create_quote', section('b')),
    ]);

    const first = events[0].split(':')[0];
    const second = first === 'a' ? 'b' : 'a';
    expect(events).toEqual([`${first}:in`, `${first}:out`, `${second}:in`, `${second}:out`]);
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

  it('rejects a price, a status, a project or a code it has no business sending', async () => {
    // Consent is read from the user's message. There is no argument through
    // which the model could supply it — or a price, a status or a project.
    const project = await costedProject();
    const tool = await createQuoteTool(project, 'sales');
    for (const extra of [
      { unitPriceCents: 1 },
      { totalCents: 1 },
      { status: 'issued' },
      { number: 'Q-2099-0001' },
      { projectId: outsiderProjectId },
      { confirmationCode: '123456' },
      { userMessage: '123456' },
    ]) {
      await expect(tool.execute({ ...CLIENT, confirmed: false, ...extra })).rejects.toThrow();
      await expect(tool.execute({ ...CLIENT, confirmed: true, ...extra })).rejects.toThrow();
    }
    expect(await quoteCount(project)).toBe(0);
  });

  it('requires the confirmation flag to be stated', async () => {
    const project = await costedProject();
    await expect((await createQuoteTool(project, 'sales')).execute({ ...CLIENT })).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Money                                                                   */
/* -------------------------------------------------------------------------- */

describe('the financial boundary', () => {
  it('returns client-facing figures and no internal cost — nor shows one to the user', async () => {
    const project = await costedProject();
    const cost = await getProjectCost(project, userIds.owner);
    const notices: string[] = [];

    const preview = await (await createQuoteTool(project, 'sales', 'x', notices)).execute({
      ...CLIENT,
      confirmed: false,
    });
    await persistTurn(project, [{ name: 'create_quote', arguments: { ...CLIENT, confirmed: false } }], new Date());
    const created = await confirmTurn(project, shownCode(notices));
    expect(created.created).toBe(true);

    // The internal total (before margin) and the margin itself are not what a
    // quotation is; neither belongs in what the agent is handed, nor in the
    // line the application shows.
    const internal = cost.cost!.internalTotalCents;
    const margin = cost.cost!.marginCents;
    expect(internal).not.toBe(cost.cost!.clientSubtotalCents);
    for (const payload of [preview, created]) {
      const text = JSON.stringify(payload);
      expect(text).not.toMatch(/internalTotalCents|marginCents|materialsCostCents|laborCostCents/);
      expect(text).not.toContain(`:${internal},`);
      expect(text).not.toContain(`:${margin},`);
    }
    expect(notices.join('\n')).not.toContain(String(internal));
    expect(notices.join('\n')).not.toContain(String(margin));
  });
});

/* -------------------------------------------------------------------------- */
/* T22.1 and T22.2 still read what T22.3 writes                                */
/* -------------------------------------------------------------------------- */

describe('reading back', () => {
  it('lets get_quote read the draft the agent created', async () => {
    const project = await costedProject();
    const code = await previewTurn(project);
    const created = await confirmTurn(project, code);

    const read = (await (await turn(project, 'production'))
      .find((tool) => tool.name === 'get_quote')!
      .execute({})) as { quote: { number: string; status: string; hasDocument: boolean } };

    expect(read.quote.number).toBe(created.quote?.number);
    expect(read.quote.status).toBe('draft');
    // Nothing was issued, so there is no document to send.
    expect(read.quote.hasDocument).toBe(false);
  });
});
