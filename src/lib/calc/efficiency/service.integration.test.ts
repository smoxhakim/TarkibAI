/**
 * Integration tests for material efficiency recommendations.
 *
 * The comparison arithmetic is covered by unit tests. These cover what the
 * database decides: that only the user's own library is considered, that
 * applying a switch really moves the project's pieces, and that a stale plan is
 * not left behind describing stock the project no longer uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial, selectProjectMaterial } from '@/lib/materials/service';
import { addPiece, calculatePlan } from '@/lib/calc/cutting/service';
import { applyMaterialSwitch, getRecommendations } from './service';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `eff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;
let standardId: string;
let cheaperId: string;
let barId: string;

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `eo-${suffix}`, email: `eo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `ex-${suffix}`, email: `ex-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);

  const standard = await createMaterial(ownerWs, ownerId, {
    name: `Alucobond standard ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 85000,
  });
  standardId = standard.id;

  const cheaper = await createMaterial(ownerWs, ownerId, {
    name: `Alucobond budget ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 50000,
  });
  cheaperId = cheaper.id;

  const bar = await createMaterial(ownerWs, ownerId, {
    name: `Tube ${suffix}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 12000,
  });
  barId = bar.id;
});

afterAll(async () => {
  await prisma.cuttingPlan.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.cuttingPiece.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.linearCut.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: { in: [ownerId, otherId] } } } });
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.material.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: [ownerId, otherId] } } } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

async function projectWithPieces() {
  const project = await createProject(ownerWs, ownerId, { title: `eff ${Math.random()}` });
  await addPiece(project.id, ownerId, {
    materialId: standardId,
    label: 'Face',
    widthMm: 1200,
    heightMm: 600,
    quantity: 4,
    allowRotation: true,
  });
  return project;
}

describe('scope', () => {
  it('explains why there is nothing to compare on an empty project', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Empty' });
    const result = await getRecommendations(project.id, ownerId);
    expect(result.recommendations).toHaveLength(0);
    expect(result.emptyReason).toContain('Add the pieces or cut lengths');
  });

  it("never considers another user's materials", async () => {
    const foreignCheap = await createMaterial(otherWs, otherId, {
      name: `Foreign bargain ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      // Absurdly cheap, so it would dominate if it were ever considered.
      unitPriceCents: 1,
    });

    const project = await projectWithPieces();
    const result = await getRecommendations(project.id, ownerId);

    const names = result.recommendations.map((r) => r.alternative.name);
    expect(names).not.toContain(`Foreign bargain ${suffix}`);
    await prisma.material.delete({ where: { id: foreignCheap.id } });
  });

  it("refuses to read another user's recommendations", async () => {
    const project = await projectWithPieces();
    await expect(getRecommendations(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });

  it('ignores archived materials', async () => {
    const archived = await createMaterial(ownerWs, ownerId, {
      name: `Archived bargain ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      unitPriceCents: 100,
    });
    await prisma.material.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    const project = await projectWithPieces();
    const result = await getRecommendations(project.id, ownerId);
    // Archived stock is not something the user still buys.
    expect(result.recommendations.map((r) => r.alternative.name)).not.toContain(
      `Archived bargain ${suffix}`
    );

    await prisma.material.delete({ where: { id: archived.id } });
  });
});

describe('recommendations', () => {
  it('finds the cheaper sheet in the library and reports a real saving', async () => {
    const project = await projectWithPieces();
    const result = await getRecommendations(project.id, ownerId);

    const match = result.recommendations.find((r) => r.alternative.materialId === cheaperId);
    expect(match).toBeTruthy();
    expect(match!.savingCents).toBeGreaterThan(0);
    // The saving is the difference between two real cutting runs.
    expect(match!.current.totalCostCents - match!.alternative.totalCostCents).toBe(
      match!.savingCents
    );
  });

  it('never recommends a switch that costs more', async () => {
    const project = await projectWithPieces();
    const result = await getRecommendations(project.id, ownerId);
    for (const recommendation of result.recommendations) {
      expect(recommendation.savingCents).toBeGreaterThan(0);
    }
  });
});

describe('applying a recommendation', () => {
  it('moves the pieces and clears the stale plan', async () => {
    const project = await projectWithPieces();
    await calculatePlan(project.id, ownerId, { materialId: standardId });
    expect(
      await prisma.cuttingPlan.count({ where: { projectId: project.id, materialId: standardId } })
    ).toBe(1);

    await applyMaterialSwitch(project.id, ownerId, standardId, cheaperId);

    const pieces = await prisma.cuttingPiece.findMany({ where: { projectId: project.id } });
    expect(pieces.every((piece) => piece.materialId === cheaperId)).toBe(true);

    // The old plan described stock the project no longer uses.
    expect(
      await prisma.cuttingPlan.count({ where: { projectId: project.id, materialId: standardId } })
    ).toBe(0);
  });

  it('clears calculated figures on the project material line', async () => {
    const project = await projectWithPieces();
    const rows = await selectProjectMaterial(project.id, ownerId, standardId, null);
    await prisma.projectMaterial.update({
      where: { id: rows[0].id },
      data: { unitsToPurchase: 4, totalCostCents: 340000, calculatedAt: new Date() },
    });

    await applyMaterialSwitch(project.id, ownerId, standardId, cheaperId);

    const line = await prisma.projectMaterial.findFirstOrThrow({ where: { projectId: project.id } });
    // Figures computed for the old material would be wrong for the new one.
    expect(line.materialId).toBe(cheaperId);
    expect(line.totalCostCents).toBeNull();
    expect(line.calculatedAt).toBeNull();
  });

  it('refuses to swap between different measurement models', async () => {
    const project = await projectWithPieces();
    await expect(
      applyMaterialSwitch(project.id, ownerId, standardId, barId)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to switch to another user's material", async () => {
    const foreign = await createMaterial(otherWs, otherId, {
      name: `Foreign ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      unitPriceCents: 1,
    });
    const project = await projectWithPieces();

    await expect(
      applyMaterialSwitch(project.id, ownerId, standardId, foreign.id)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to apply on another user's project", async () => {
    const project = await projectWithPieces();
    await expect(
      applyMaterialSwitch(project.id, otherId, standardId, cheaperId)
    ).rejects.toMatchObject({ status: 404 });
  });
});
