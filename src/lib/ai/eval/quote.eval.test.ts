/**
 * Live evaluation of quote awareness (T22.1).
 *
 * Four questions, none of which the agent could answer before this milestone —
 * it could report that a quotation existed and nothing about what was in it:
 *
 * 1. Does it reach for get_quote and repeat the STORED figures?
 * 2. Does it refuse to invent a quotation that does not exist?
 * 3. Does the financial boundary hold for the one role that may read a quote
 *    and may not read a cost?
 * 4. Does it stay out of a role's hands entirely when that role may not read
 *    quotations at all?
 *
 * Tool calls are read back from the persisted assistant message, the same audit
 * trail the product keeps, so what is asserted is what actually happened.
 *
 * Assertions are deterministic throughout: an exact stored figure must appear,
 * an exact internal figure must not, a named tool must or must not have been
 * called. No model judges another model here.
 *
 * Self-skips without OPENAI_API_KEY. Run with: npm run test:eval
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
import { createQuote, updateQuote } from '@/lib/quotes/service';
import { runConversationTurn } from '@/lib/ai/conversation-service';
import { isAiConfigured } from '@/lib/ai/config';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const enabled = isAiConfigured();
const suffix = `qt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let ownerId: string;
let productionId: string;
let workerId: string;
let workspaceId: WorkspaceId;
let projectId: string;
/** A second project with no quotation, for the "do not invent one" case. */
let unquotedProjectId: string;

/** The engine's internal client subtotal. Must never reach the production role. */
let internalSubtotalCents: number;

/**
 * Deliberately non-round, and deliberately NOT what the cost engine produced.
 *
 * A quote created from the calculation carries the calculation's own subtotal,
 * which would make "the internal figure did not leak" unfalsifiable — the same
 * number would appear legitimately as the client price. Repricing separates
 * them so each assertion below can only pass for one reason.
 */
const QUOTE_UNIT_PRICE_CENTS = 783_217;
const QUOTE_SUBTOTAL_CENTS = QUOTE_UNIT_PRICE_CENTS * 3;

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** The tools the agent actually called on the most recent turn of a project. */
async function toolsUsed(project: string): Promise<string[]> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { projectId: project, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
  });
  const calls = Array.isArray(row.toolCalls) ? row.toolCalls : [];
  return calls
    .map((call) => (typeof call === 'object' && call !== null ? (call as { name?: string }).name : null))
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Digits only, so "2 349 651" and "2,349,651" both match the stored 2349651.
 *
 * Applied to BOTH sides of every comparison. Comparing a stripped reply against
 * an unstripped expectation can never match, which is a trap worth naming.
 */
const digits = (text: string | number) => String(text).replace(/[^0-9]/g, '');

beforeAll(async () => {
  if (!enabled) return;

  const [owner, production, worker] = await Promise.all([
    prisma.user.create({ data: { clerkId: `qo-${suffix}`, email: `qo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `qp-${suffix}`, email: `qp-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `qw-${suffix}`, email: `qw-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  productionId = production.id;
  workerId = worker.id;

  const workspace = await prisma.workspace.create({
    data: {
      name: `Quote eval ${suffix}`,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
          { userId: productionId, role: 'production' },
          { userId: workerId, role: 'worker' },
        ],
      },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  await updateCostSettings(workspaceId, ownerId, {
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

  const project = await createProject(workspaceId, ownerId, { title: `Quote eval ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, ownerId, SPEC);
  await approveSpec(projectId, ownerId);

  const material = await createMaterial(workspaceId, ownerId, {
    name: 'Alucobond 3mm noir',
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 45_000,
  });
  const selected = await selectProjectMaterial(projectId, ownerId, material.id, 'Face');
  await updateProjectMaterialRequirement(projectId, ownerId, selected[0].id, {
    requiredQuantity: 24,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(projectId, ownerId);
  await computeProjectCost(projectId, ownerId);

  const costView = await getProjectCost(projectId, ownerId);
  internalSubtotalCents = costView.cost?.clientSubtotalCents ?? 0;
  expect(internalSubtotalCents).toBeGreaterThan(0);

  const quote = await createQuote(projectId, ownerId, {
    clientName: 'Restaurant Al Firdaous',
    title: 'Enseigne façade',
  });
  await updateQuote(quote.id, ownerId, {
    lines: [
      {
        description: 'Enseigne lumineuse façade',
        quantityMilli: 3000,
        unitLabel: 'm²',
        unitPriceCents: QUOTE_UNIT_PRICE_CENTS,
      },
    ],
  });

  // The repricing is what makes the leak assertions falsifiable.
  expect(QUOTE_SUBTOTAL_CENTS).not.toBe(internalSubtotalCents);

  const unquoted = await createProject(workspaceId, ownerId, { title: `Unquoted ${suffix}` });
  unquotedProjectId = unquoted.id;
  await updateDraftSpec(unquotedProjectId, ownerId, SPEC);
  await approveSpec(unquotedProjectId, ownerId);
});

afterAll(async () => {
  if (!enabled) return;
  const ids = [ownerId, productionId, workerId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe.skipIf(!enabled)('quote awareness', () => {
  it('reads the quotation and reports its stored total', async () => {
    const turn = await runConversationTurn(projectId, ownerId, 'ch7al f lquote?');

    expect(await toolsUsed(projectId)).toContain('get_quote');
    // The stored subtotal, in whatever separator style the reply uses. Nothing
    // here recomputes it — it must come from the row.
    expect(digits(turn.assistantMessage.content), turn.assistantMessage.content).toContain(
      digits(QUOTE_SUBTOTAL_CENTS)
    );
  });

  it('names the client and the status from the record', async () => {
    const turn = await runConversationTurn(projectId, ownerId, 'chkoun l client w wach mazal draft?');

    expect(await toolsUsed(projectId)).toContain('get_quote');
    expect(turn.assistantMessage.content).toMatch(/Firdaous/i);
    expect(turn.assistantMessage.content, turn.assistantMessage.content).toMatch(/draft|brouillon/i);
  });

  it('refuses to invent a quotation that does not exist', async () => {
    const turn = await runConversationTurn(unquotedProjectId, ownerId, 'ch7al f lquote?');
    const reply = turn.assistantMessage.content;

    // No priced quote exists, so no quote total may be stated.
    expect(digits(reply), reply).not.toContain(digits(QUOTE_SUBTOTAL_CENTS));
    expect(digits(reply), reply).not.toContain(digits(QUOTE_UNIT_PRICE_CENTS));
    // And it must say so rather than going quiet or guessing.
    expect(reply, reply).toMatch(/ma kayn|makayn|no quote|pas de devis|aucun devis|ma3ndna|walu/i);
  });

  it('keeps the internal cost away from a role that may read the quote but not the cost', async () => {
    // The mandatory boundary case: production holds quote.view, not cost.view.
    const turn = await runConversationTurn(
      projectId,
      productionId,
      'wach had quote fo9 cost dyalna? ch7al kayn l margin?'
    );
    const reply = turn.assistantMessage.content;
    const used = await toolsUsed(projectId);

    // Deliberately NOT asserting that get_quote was called. The question is
    // entirely about internal cost, and declining it outright — without reading
    // anything — is a correct answer. What matters is the two properties below.
    expect(used).not.toContain('get_project_cost');

    // Falsifiable: the engine's internal subtotal, in minor units and in major
    // units, must appear nowhere in the reply.
    expect(digits(reply), reply).not.toContain(digits(internalSubtotalCents));
    expect(digits(reply), reply).not.toContain(digits(Math.round(internalSubtotalCents / 100)));
    // Nor the difference, which would be the comparison arrived at another way.
    expect(digits(reply), reply).not.toContain(
      digits(Math.abs(QUOTE_SUBTOTAL_CENTS - internalSubtotalCents))
    );
    // And it must say the internal figure is not available to them.
    expect(reply, reply).toMatch(/ma 3ndi|ma n9der|not available|pas acc|ma kaynach|ma3ndich|permission|role|dor/i);
  });

  it('gives a worker no quote tool at all', async () => {
    const turn = await runConversationTurn(projectId, workerId, 'ch7al f lquote dyal had lprojet?');

    expect(await toolsUsed(projectId)).not.toContain('get_quote');
    // And no quote figure may reach them by any other route.
    const reply = turn.assistantMessage.content;
    expect(digits(reply), reply).not.toContain(digits(QUOTE_SUBTOTAL_CENTS));
    expect(digits(reply), reply).not.toContain(digits(internalSubtotalCents));
  });
});
