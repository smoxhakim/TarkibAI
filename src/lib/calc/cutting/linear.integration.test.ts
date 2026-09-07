/**
 * Integration tests for linear cut plans.
 *
 * Packing is covered by unit tests. These cover ownership, the linear-material
 * restriction, settings from technical properties, and that sheet and linear
 * plans coexist in one table without contaminating each other's listings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial } from '@/lib/materials/service';
import {
  addLinearCut,
  addPiece,
  calculateLinearCutPlan,
  calculatePlan,
  listLinearCuts,
  listLinearPlans,
  listPlans,
  removeLinearCut,
} from './service';

const suffix = `lin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;
let barId: string;
let sheetId: string;

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `lo-${suffix}`, email: `lo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `lx-${suffix}`, email: `lx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;

  const bar = await createMaterial(ownerId, {
    name: `Tube 40x40 ${suffix}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 12000,
    technicalProperties: { kerfMm: 3, minUsableRemnantMm: 500 },
  });
  barId = bar.id;

  const sheet = await createMaterial(ownerId, {
    name: `Alu ${suffix}`,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 85000,
  });
  sheetId = sheet.id;
});

afterAll(async () => {
  await prisma.cuttingPlan.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.linearCut.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.cuttingPiece.deleteMany({ where: { project: { userId: { in: [ownerId, otherId] } } } });
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.material.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

const newProject = () => createProject(ownerId, { title: `linear ${Math.random()}` });

describe('cut lists', () => {
  it('refuses cut lengths on a sheet material', async () => {
    const project = await newProject();
    await expect(
      addLinearCut(project.id, ownerId, { materialId: sheetId, lengthMm: 1000, quantity: 1 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses another user's material, and another user's cuts", async () => {
    const project = await newProject();
    const foreign = await createMaterial(otherId, {
      name: `Foreign bar ${suffix}`,
      category: 'Metal',
      customCategory: false,
      measurementModel: 'linear',
      standardLengthMm: 6000,
      unitPriceCents: 1,
    });

    await expect(
      addLinearCut(project.id, ownerId, { materialId: foreign.id, lengthMm: 1000, quantity: 1 })
    ).rejects.toMatchObject({ status: 404 });

    const cuts = await addLinearCut(project.id, ownerId, {
      materialId: barId,
      lengthMm: 1000,
      quantity: 1,
    });
    await expect(listLinearCuts(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(removeLinearCut(project.id, otherId, cuts[0].id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('plan calculation', () => {
  it('refuses without cut lengths', async () => {
    const project = await newProject();
    await expect(
      calculateLinearCutPlan(project.id, ownerId, { materialId: barId })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('produces the bar count a length division gets wrong', async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, {
      materialId: barId,
      label: 'Upright',
      lengthMm: 4000,
      quantity: 4,
    });

    const view = await calculateLinearCutPlan(project.id, ownerId, {
      materialId: barId,
      kerfMm: 0,
    });

    // 16 m of material from 6 m bars divides to 3, but only one 4 m piece fits
    // per bar. This is the number a workshop must actually buy.
    expect(view.plan?.stockUnitsUsed).toBe(4);
    expect(view.result?.totalRequiredMm).toBe(16000);
  });

  it('takes kerf and the usable-remnant threshold from technical properties', async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 2000, quantity: 3 });

    const view = await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });
    expect(view.plan?.kerfMm).toBe(3);
    expect(view.result?.settings.minUsableRemnantMm).toBe(500);
  });

  it('reports a long tail as reusable rather than waste', async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 4000, quantity: 1 });

    const view = await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });
    expect(view.result?.usableRemnantsMm).toEqual([2000]);
    expect(Number(view.plan?.wastePercent)).toBe(0);
  });

  it('stores a plan with reasons when a length exceeds the bar', async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, {
      materialId: barId,
      label: 'Full span',
      lengthMm: 9000,
      quantity: 2,
    });
    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 1000, quantity: 1 });

    const view = await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });
    expect(view.plan?.unplacedCount).toBe(2);
    expect(view.result?.unplaced[0].reason).toContain('Longer than');
    // The cut that fits is still planned.
    expect(view.plan?.stockUnitsUsed).toBe(1);
  });

  it('renders a cut sequence diagram', async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 1500, quantity: 5 });
    const view = await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });
    expect(view.svg).toContain('<svg');
    expect(view.svg).toContain('Bar 1');
  });

  it("refuses to calculate or read another user's plan", async () => {
    const project = await newProject();
    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 1000, quantity: 1 });
    await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });

    await expect(
      calculateLinearCutPlan(project.id, otherId, { materialId: barId })
    ).rejects.toMatchObject({ status: 404 });
    await expect(listLinearPlans(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('sheet and linear plans coexist', () => {
  it('keeps each kind out of the other listing', async () => {
    const project = await newProject();

    await addPiece(project.id, ownerId, {
      materialId: sheetId,
      widthMm: 1000,
      heightMm: 500,
      quantity: 2,
      allowRotation: true,
    });
    await calculatePlan(project.id, ownerId, { materialId: sheetId });

    await addLinearCut(project.id, ownerId, { materialId: barId, lengthMm: 2000, quantity: 2 });
    await calculateLinearCutPlan(project.id, ownerId, { materialId: barId });

    const sheetPlans = await listPlans(project.id, ownerId);
    const linear = await listLinearPlans(project.id, ownerId);

    // They share a table; a listing must not surface the other kind, whose
    // layoutData has a completely different shape.
    expect(sheetPlans).toHaveLength(1);
    expect(sheetPlans[0].plan?.materialId).toBe(sheetId);
    expect(linear).toHaveLength(1);
    expect(linear[0].plan?.materialId).toBe(barId);
  });
});
