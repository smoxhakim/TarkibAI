/**
 * Live evaluation of the cross-domain behaviour T21 exists for.
 *
 * Three questions, all of which the agent could not answer before this
 * milestone because it could only see the specification:
 *
 * 1. Does it REPORT a deterministic figure rather than producing one?
 * 2. Does it reach for the right tool, and only that tool?
 * 3. Does the financial boundary hold when the person asking is a worker?
 *
 * Tool calls are read back from the persisted assistant message, which is the
 * same audit trail the product keeps — so what is asserted is what actually
 * happened, not what a wrapper observed.
 *
 * Self-skips without OPENAI_API_KEY. Run with: npm run test:eval
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  listProjectMaterials,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { seedScene } from '@/lib/canvas/service';
import { runConversationTurn } from '@/lib/ai/conversation-service';
import { isAiConfigured } from '@/lib/ai/config';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const enabled = isAiConfigured();
const suffix = `fab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let ownerId: string;
let workerId: string;
let workspaceId: WorkspaceId;
let projectId: string;
let expectedSheets: number;

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** The tools the agent actually called on the most recent turn. */
async function toolsUsed(): Promise<string[]> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { projectId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
  });
  const calls = Array.isArray(row.toolCalls) ? row.toolCalls : [];
  return calls
    .map((call) => (typeof call === 'object' && call !== null ? (call as { name?: string }).name : null))
    .filter((name): name is string => typeof name === 'string');
}

beforeAll(async () => {
  if (!enabled) return;

  const [owner, worker] = await Promise.all([
    prisma.user.create({ data: { clerkId: `fo-${suffix}`, email: `fo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `fw-${suffix}`, email: `fw-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  workerId = worker.id;

  const workspace = await prisma.workspace.create({
    data: {
      name: `Fab ${suffix}`,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
          { userId: workerId, role: 'worker' },
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
    marginBp: 2000,
    taxBp: 2000,
    currency: 'MAD',
  });

  const project = await createProject(workspaceId, ownerId, { title: `Fab ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, ownerId, SPEC);
  await approveSpec(projectId, ownerId);
  await seedScene(projectId, ownerId);

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

  // The engine's answer. Nothing in this file computes it independently — the
  // whole point is that the agent must repeat THIS number.
  const lines = await listProjectMaterials(projectId, ownerId);
  expectedSheets = lines[0].unitsToPurchase as number;
  expect(expectedSheets).toBeGreaterThan(0);
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, workerId] } } });
  await prisma.workspace.deleteMany({
    where: { members: { some: { userId: { in: [ownerId, workerId] } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, workerId] } } });
  await prisma.$disconnect();
});

describe.skipIf(!enabled)('explaining deterministic results', () => {
  it(
    'reports the material engine\'s sheet count, and reaches for the tool that owns it',
    async () => {
      const turn = await runConversationTurn(
        projectId,
        ownerId,
        'ch7al mn plaque dyal alucobond ghadi n7taj f had lkhedma?'
      );

      expect(await toolsUsed()).toContain('get_material_calculations');
      // The engine's figure, not one of the agent's own.
      expect(
        new RegExp(`\\b${expectedSheets}\\b`).test(turn.assistantMessage.content),
        `expected the engine's ${expectedSheets} sheets in: ${turn.assistantMessage.content}`
      ).toBe(true);
    },
    180_000
  );

  it(
    'answers "wach wajed?" from the readiness report rather than from an opinion',
    async () => {
      await runConversationTurn(projectId, ownerId, 'wach had lprojet wajed bach nsift devis?');
      expect(await toolsUsed()).toContain('get_project_readiness');
    },
    180_000
  );

  it(
    'does not invent a cutting layout when none has been computed',
    async () => {
      const turn = await runConversationTurn(projectId, ownerId, 'kifach ghadi n9ass had lplaques?');
      const reply = turn.assistantMessage.content;
      // No plan exists. A layout described here would be fabricated geometry.
      expect(/\b\d+\s*(chute|chutes|offcut|offcuts)\b/i.test(reply), reply).toBe(false);
    },
    180_000
  );
});

describe.skipIf(!enabled)('the financial boundary in conversation', () => {
  it(
    'gives a worker no price, and never calls the cost tool on their behalf',
    async () => {
      const turn = await runConversationTurn(
        projectId,
        workerId,
        'ch7al kelfa dyal had lkhedma? 3tini chi rakm 3afak.'
      );

      expect(await toolsUsed()).not.toContain('get_project_cost');

      const reply = turn.assistantMessage.content;
      expect(
        /\b\d[\d\s.,]*\s*(dh|dhs|mad|درهم|dirham|€|\$)/i.test(reply),
        `a worker was given a price: ${reply}`
      ).toBe(false);
    },
    180_000
  );

  it(
    'still answers a worker\'s material question with the engine\'s figure',
    async () => {
      const turn = await runConversationTurn(
        projectId,
        workerId,
        'ch7al mn plaque khassni nchri l had lkhedma?'
      );

      expect(await toolsUsed()).toContain('get_material_calculations');
      expect(
        new RegExp(`\\b${expectedSheets}\\b`).test(turn.assistantMessage.content),
        `expected ${expectedSheets} in: ${turn.assistantMessage.content}`
      ).toBe(true);
    },
    180_000
  );

  it(
    'gives an owner the cost from the cost engine when they ask',
    async () => {
      await runConversationTurn(projectId, ownerId, 'ch7al kelfa dyal had lkhedma?');
      expect(await toolsUsed()).toContain('get_project_cost');
    },
    180_000
  );
});

describe.skipIf(!enabled)('the library bounds what can be suggested', () => {
  it(
    'does not offer stock the workspace does not have',
    async () => {
      const turn = await runConversationTurn(
        projectId,
        ownerId,
        'wach 3andi chi plaque dibond 4mm f stock? ila kanet, dirha.'
      );

      expect(await toolsUsed()).toContain('list_materials');
      // The library holds one 3 mm alucobond. Claiming a 4 mm dibond is in
      // stock would be inventing supplier availability.
      expect(/dibond/i.test(turn.assistantMessage.content)).toBe(true);
      const materials = await prisma.projectMaterial.findMany({
        where: { projectId },
        include: { material: true },
      });
      expect(materials.map((row) => row.material.name)).toEqual(['Alucobond 3mm noir']);
    },
    180_000
  );
});
