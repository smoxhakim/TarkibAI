/**
 * The project snapshot against real project state.
 *
 * Rendering is unit-tested; what only a database can show is that the snapshot
 * actually SEES what the engines recorded — a calculated line, a seeded canvas,
 * a computed cost — and that it is assembled per caller, so a role without
 * cost or quote visibility never has those rows read on its behalf at all.
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
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { seedScene } from '@/lib/canvas/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { resolveProjectAiAccess } from '../access';
import { buildProjectContext, renderProjectState } from './project-context';

const suffix = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let workerId: string;
let workspaceId: WorkspaceId;
let projectId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

async function contextFor(userId: string) {
  const access = await resolveProjectAiAccess(projectId, userId);
  return buildProjectContext(access, await getSpec(projectId, userId));
}

beforeAll(async () => {
  const [owner, worker] = await Promise.all([
    prisma.user.create({ data: { clerkId: `cto-${suffix}`, email: `cto-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `ctw-${suffix}`, email: `ctw-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  workerId = worker.id;

  const workspace = await prisma.workspace.create({
    data: {
      name: `Context ${suffix}`,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
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

  const project = await createProject(workspaceId, ownerId, { title: `Context ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, ownerId, COMPLETE_SPEC);
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
    requiredQuantity: 18,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(projectId, ownerId);
  await computeProjectCost(projectId, ownerId);
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, workerId] } } });
  await prisma.workspace.deleteMany({
    where: { members: { some: { userId: { in: [ownerId, workerId] } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, workerId] } } });
  await prisma.$disconnect();
});

describe('what the snapshot sees', () => {
  it('reflects the approved specification, the seeded canvas and the calculated line', async () => {
    const { snapshot } = await contextFor(ownerId);

    expect(snapshot.spec.status).toBe('approved');
    expect(snapshot.spec.complete).toBe(true);
    expect(snapshot.design.objectCount).toBeGreaterThan(0);
    expect(snapshot.design.diverged).toBe(false);

    expect(snapshot.materials.selectedCount).toBe(1);
    expect(snapshot.materials.calculatedCount).toBe(1);
    expect(snapshot.materials.lines[0].name).toBe('Alucobond 3mm noir');
    // The engine's answer, not one the snapshot worked out.
    expect(snapshot.materials.lines[0].unitsToPurchase).toBeGreaterThan(0);
  });

  it('reports a computed cost as computed and current', async () => {
    const { snapshot } = await contextFor(ownerId);
    expect(snapshot.cost).toEqual({ computed: true, stale: false, blockedReason: null });
  });

  it('carries no figures of its own — the tools own those', async () => {
    const text = renderProjectState((await contextFor(ownerId)).snapshot);
    // The material total is 45 000 cents a sheet; nothing like it may appear.
    expect(text).not.toContain('45000');
    expect(text).not.toContain('450');
  });
});

describe('the snapshot is assembled per caller', () => {
  it('gives a worker no cost and no quote section at all', async () => {
    const { snapshot, grants } = await contextFor(workerId);

    expect(grants.viewCost).toBe(false);
    expect(snapshot.cost).toBeNull();
    expect(snapshot.quotes).toBeNull();
  });

  it('still gives the worker the purchase count they need to do the job', async () => {
    const { snapshot } = await contextFor(workerId);
    expect(snapshot.materials.lines[0].unitsToPurchase).toBeGreaterThan(0);
  });

  it('tells the worker explicitly that cost is out of bounds', async () => {
    const text = renderProjectState((await contextFor(workerId)).snapshot);
    expect(text).toContain('NOT VISIBLE TO THIS USER');
    expect(text).not.toMatch(/Cost: computed/);
  });

  it('gives the owner both sections', async () => {
    const { snapshot } = await contextFor(ownerId);
    expect(snapshot.cost).not.toBeNull();
    expect(snapshot.quotes).not.toBeNull();
  });
});
