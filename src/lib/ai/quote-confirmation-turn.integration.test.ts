/**
 * Quote confirmation through the real conversation turn, with a SCRIPTED model.
 *
 * The tool tests build the toolbox directly. They cannot catch the one wiring
 * this whole mechanism depends on: that `runConversationTurn` hands the
 * user's own message to the toolbox, and appends the application's
 * confirmation line to the reply the user reads. So here the OpenAI client is
 * replaced with a script — deterministic, no network, no credits — and the
 * turns go through the same code path the route uses.
 *
 * The script is the WORST-CASE model: it sends `confirmed: true` whenever the
 * scenario says so, whatever the user wrote. Only the server stands between it
 * and a quotation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost } from '@/lib/calc/costs/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { runConversationTurn } from './conversation-service';

/** What the scripted model will say next, and every request it was sent. */
const model = vi.hoisted(() => ({
  replies: [] as unknown[],
  requests: [] as { messages: { role: string; content: unknown }[] }[],
}));

vi.mock('openai', () => ({
  default: class ScriptedOpenAI {
    chat = {
      completions: {
        create: async (request: { messages: { role: string; content: unknown }[] }) => {
          model.requests.push(structuredClone({ messages: request.messages }));
          const message = model.replies.shift();
          if (!message) throw new Error('The scripted model ran out of replies.');
          return { choices: [{ message }] };
        },
      },
    };
  },
}));

const suffix = `qct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CLIENT = { clientName: 'Restaurant Al Firdaous', title: 'Enseigne façade' };
const originalKey = process.env.OPENAI_API_KEY;

let ownerId: string;
let salesId: string;
let workspaceId: WorkspaceId;
let projectId: string;
let callCount = 0;

/** The model calls create_quote once, then replies with `text`. */
function modelCallsCreateQuote(confirmed: boolean, text: string) {
  callCount += 1;
  model.replies.push(
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call-${callCount}`,
          type: 'function',
          function: { name: 'create_quote', arguments: JSON.stringify({ ...CLIENT, confirmed }) },
        },
      ],
    },
    { role: 'assistant', content: text }
  );
}

function codeIn(reply: string): string {
  const match = reply.match(/reply with only this code: (\d{6})\./);
  if (!match) throw new Error(`No confirmation code in the reply: ${reply}`);
  return match[1];
}

const quoteCount = () => prisma.quote.count({ where: { projectId } });

beforeAll(async () => {
  // Checked by `isAiConfigured`; the client that would use it is the script.
  process.env.OPENAI_API_KEY = 'scripted-model-no-network';

  const [owner, sales] = await Promise.all([
    prisma.user.create({ data: { clerkId: `o-${suffix}`, email: `o-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `s-${suffix}`, email: `s-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  salesId = sales.id;

  const workspace = await prisma.workspace.create({
    data: {
      name: `Quote turn ${suffix}`,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
          { userId: salesId, role: 'sales' },
        ],
      },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  const material = await createMaterial(workspaceId, ownerId, {
    name: `Alucobond ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 45_000,
  });

  const project = await createProject(workspaceId, ownerId, { title: `Quote turn ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, ownerId, {
    projectType: 'enseigne',
    dimensions: { width: 8, height: 3, unit: 'm' },
    quantity: 1,
    materials: [{ name: 'alucobond noir' }],
    lighting: { type: 'led' },
    mounting: { method: 'steel frame' },
    site: { environment: 'outdoor' },
  });
  await approveSpec(projectId, ownerId);
  const selected = await selectProjectMaterial(projectId, ownerId, material.id, 'Face');
  await updateProjectMaterialRequirement(projectId, ownerId, selected[0].id, {
    requiredQuantity: 18,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(projectId, ownerId);
  await computeProjectCost(projectId, ownerId);
});

afterAll(async () => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;

  const ids = [ownerId, salesId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('a quotation confirmed through the conversation', () => {
  // One conversation, in order: each step depends on the turns before it.
  let code: string;

  it('previews: nothing is created, and the APPLICATION shows the code', async () => {
    modelCallsCreateQuote(false, 'Hak chno ghadi ytcreat.');
    const turn = await runConversationTurn(projectId, salesId, 'dir lia quote l Restaurant Al Firdaous');

    expect(await quoteCount()).toBe(0);
    // The model's text first, then the application's line — persisted as one reply.
    expect(turn.assistantMessage.content.startsWith('Hak chno ghadi ytcreat.')).toBe(true);
    expect(turn.assistantMessage.content).toContain(`"${CLIENT.clientName}"`);
    code = codeIn(turn.assistantMessage.content);

    // The tool result the model read did not carry the code.
    const toolResults = model.requests
      .at(-1)!
      .messages.filter((message) => message.role === 'tool')
      .map((message) => String(message.content));
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults.join('\n')).not.toMatch(new RegExp(`\\b${code}\\b`));
  });

  it('"wakha" creates nothing, even when the model confirms', async () => {
    modelCallsCreateQuote(true, 'Safi.');
    await runConversationTurn(projectId, salesId, 'wakha');

    expect(await quoteCount()).toBe(0);
  });

  it('the refused confirmation spent that preview, so the code alone does not revive it', async () => {
    modelCallsCreateQuote(true, 'Safi.');
    await runConversationTurn(projectId, salesId, code);

    expect(await quoteCount()).toBe(0);
  });

  it('a fresh preview shows the same code for the same quotation', async () => {
    modelCallsCreateQuote(false, 'Hak l preview mra khra.');
    const turn = await runConversationTurn(projectId, salesId, 'bghit dik l quote');

    // Same person, same details, same cost calculation: the same code.
    expect(codeIn(turn.assistantMessage.content)).toBe(code);
    expect(await quoteCount()).toBe(0);
  });

  it('the code, sent as the next message, creates exactly one draft', async () => {
    modelCallsCreateQuote(true, 'Tcreat l quote.');
    await runConversationTurn(projectId, salesId, code);

    expect(await quoteCount()).toBe(1);
    const stored = await prisma.quote.findFirstOrThrow({ where: { projectId } });
    expect(stored.status).toBe('draft');
    expect(stored.clientName).toBe(CLIENT.clientName);
    expect(stored.userId).toBe(salesId);
  });

  it('sending the code again creates no second one', async () => {
    modelCallsCreateQuote(true, 'Deja tcreat.');
    await runConversationTurn(projectId, salesId, code);

    expect(await quoteCount()).toBe(1);
  });

  it('left nothing of the script unused', () => {
    expect(model.replies).toEqual([]);
  });
});
