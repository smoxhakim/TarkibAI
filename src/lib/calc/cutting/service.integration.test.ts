/**
 * Integration tests for cutting plans.
 *
 * Nesting itself is covered exhaustively by unit tests. These cover ownership,
 * the sheet-material restriction, settings resolution from the material, and
 * that an incomplete plan is stored with its reasons rather than thrown away.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial } from '@/lib/materials/service';
import { addPiece, calculatePlan, listPieces, listPlans, removePiece } from './service';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `cut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;
let sheetMaterialId: string;
let linearMaterialId: string;

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `xo-${suffix}`, email: `xo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `xx-${suffix}`, email: `xx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);

  const sheetMaterial = await createMaterial(ownerWs, ownerId, {
    name: `Alucobond ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 85000,
    technicalProperties: { kerfMm: 4, edgeMarginMm: 10 },
  });
  sheetMaterialId = sheetMaterial.id;

  const linearMaterial = await createMaterial(ownerWs, ownerId, {
    name: `Tube ${suffix}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 12000,
  });
  linearMaterialId = linearMaterial.id;
});

afterAll(async () => {
  await prisma.cuttingPlan.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.cuttingPiece.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.material.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: [ownerId, otherId] } } } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

const newProject = () => createProject(ownerWs, ownerId, { title: `cutting ${Math.random()}` });

describe('pieces', () => {
  it('adds and lists pieces for a sheet material', async () => {
    const project = await newProject();
    const pieces = await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      label: 'Face',
      widthMm: 1000,
      heightMm: 600,
      quantity: 3,
      allowRotation: true,
    });
    expect(pieces).toHaveLength(1);
    expect(pieces[0].quantity).toBe(3);
  });

  it('refuses pieces for a non-sheet material', async () => {
    const project = await newProject();
    // Linear stock optimisation is a separate problem with different rules.
    await expect(
      addPiece(project.id, ownerId, {
        materialId: linearMaterialId,
        widthMm: 1000,
        heightMm: 600,
        quantity: 1,
        allowRotation: true,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to use another user's material", async () => {
    const project = await newProject();
    const foreign = await createMaterial(otherWs, otherId, {
      name: `Foreign ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      unitPriceCents: 1,
    });

    await expect(
      addPiece(project.id, ownerId, {
        materialId: foreign.id,
        widthMm: 100,
        heightMm: 100,
        quantity: 1,
        allowRotation: true,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to list or remove another user's pieces", async () => {
    const project = await newProject();
    const pieces = await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      widthMm: 500,
      heightMm: 500,
      quantity: 1,
      allowRotation: true,
    });

    await expect(listPieces(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(removePiece(project.id, otherId, pieces[0].id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('plan calculation', () => {
  it('refuses without pieces rather than producing an empty plan', async () => {
    const project = await newProject();
    await expect(
      calculatePlan(project.id, ownerId, { materialId: sheetMaterialId })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('takes kerf and edge margin from the material technical properties', async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      widthMm: 1000,
      heightMm: 600,
      quantity: 2,
      allowRotation: true,
    });

    const { plan } = await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });
    // That extensible field on Material was added in T3 for exactly this.
    expect(plan?.kerfMm).toBe(4);
    expect(plan?.edgeMarginMm).toBe(10);
  });

  it('honours a per-plan override of kerf and margin', async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      widthMm: 1000,
      heightMm: 600,
      quantity: 2,
      allowRotation: true,
    });

    const { plan } = await calculatePlan(project.id, ownerId, {
      materialId: sheetMaterialId,
      kerfMm: 0,
      edgeMarginMm: 0,
    });
    expect(plan?.kerfMm).toBe(0);
    expect(plan?.edgeMarginMm).toBe(0);
  });

  it('stores the layout, sheet count and waste, and renders a diagram', async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      label: 'Face',
      widthMm: 1200,
      heightMm: 600,
      quantity: 4,
      allowRotation: true,
    });

    const view = await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });
    expect(view.plan?.stockUnitsUsed).toBeGreaterThan(0);
    expect(Number(view.plan?.wastePercent)).toBeGreaterThanOrEqual(0);
    expect(view.svg).toContain('<svg');
    expect(view.result?.sheets[0].pieces.length).toBeGreaterThan(0);
  });

  it('stores a plan with its reasons when a piece cannot be placed', async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      label: 'Full facade',
      widthMm: 8000,
      heightMm: 3000,
      quantity: 1,
      allowRotation: true,
    });
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      label: 'Small',
      widthMm: 400,
      heightMm: 400,
      quantity: 2,
      allowRotation: true,
    });

    const view = await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });
    // Silently dropping the oversized piece would be far worse than saying so.
    expect(view.plan?.unplacedCount).toBe(1);
    expect(view.result?.unplaced[0].reason).toContain('Larger than the usable sheet area');
    // The pieces that do fit are still planned.
    expect(view.plan?.stockUnitsUsed).toBe(1);
  });

  it('replaces the previous plan for the same material rather than duplicating', async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      widthMm: 800,
      heightMm: 400,
      quantity: 2,
      allowRotation: true,
    });

    await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });
    await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });

    expect(
      await prisma.cuttingPlan.count({ where: { projectId: project.id, materialId: sheetMaterialId } })
    ).toBe(1);
  });

  it("refuses to calculate or read another user's plan", async () => {
    const project = await newProject();
    await addPiece(project.id, ownerId, {
      materialId: sheetMaterialId,
      widthMm: 500,
      heightMm: 500,
      quantity: 1,
      allowRotation: true,
    });
    await calculatePlan(project.id, ownerId, { materialId: sheetMaterialId });

    await expect(
      calculatePlan(project.id, otherId, { materialId: sheetMaterialId })
    ).rejects.toMatchObject({ status: 404 });
    await expect(listPlans(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
