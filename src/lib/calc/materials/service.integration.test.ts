/**
 * Integration tests for material calculation.
 *
 * The engine itself is covered exhaustively by unit tests. These cover what
 * only the database can show: the approval gate, persistence, the snapshot that
 * keeps an explanation truthful, stage advancement, and stale detection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  listProjectMaterials,
  selectProjectMaterial,
  updateMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `calc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

const TUBE = {
  name: `Tube 40x40 ${suffix}`,
  category: 'Metal',
  customCategory: false,
  measurementModel: 'linear' as const,
  standardLengthMm: 6000,
  unitPriceCents: 12000,
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `co-${suffix}`, email: `co-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `cx-${suffix}`, email: `cx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(async () => {
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: { in: [ownerId, otherId] } } } });
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.material.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

/** A project with an approved spec, one selected material, and a requirement. */
async function readyProject(requiredQuantity = 25) {
  const project = await createProject(ownerId, { title: `calc ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(ownerId, { ...TUBE, name: `${TUBE.name}-${Math.random()}` });
  const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'frame');
  await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
    requiredQuantity,
    requiredDimensions: 'perimeter 2x(8+3)',
  });

  return { project, material, lineId: rows[0].id };
}

describe('approval gate', () => {
  it('refuses to calculate before the specification is approved', async () => {
    const project = await createProject(ownerId, { title: 'Unapproved' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    const material = await createMaterial(ownerId, { ...TUBE, name: `gate-${suffix}` });
    const rows = await selectProjectMaterial(project.id, ownerId, material.id, null);
    await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
      requiredQuantity: 25,
      requiredDimensions: null,
    });

    await expect(calculateProjectMaterials(project.id, ownerId)).rejects.toMatchObject({ status: 400 });

    // Nothing may be written, and the stage must not advance.
    const after = await listProjectMaterials(project.id, ownerId);
    expect(after[0].calculatedAt).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('intake');
  });

  it('refuses when no materials are selected', async () => {
    const project = await createProject(ownerId, { title: 'No materials' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);

    await expect(calculateProjectMaterials(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to calculate another user's project", async () => {
    const { project } = await readyProject();
    await expect(calculateProjectMaterials(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('calculation and persistence', () => {
  it('persists the PRD worked example and advances the project stage', async () => {
    const { project, lineId } = await readyProject(25);

    const summary = await calculateProjectMaterials(project.id, ownerId);
    expect(summary.calculatedLines).toBe(1);
    expect(summary.totalMaterialCostCents).toBe(5 * 12000);

    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.id).toBe(lineId);
    expect(line.unitsToPurchase).toBe(5);
    expect(Number(line.totalPurchasedQuantity)).toBe(30);
    expect(Number(line.wasteQuantity)).toBe(5);
    expect(line.totalCostCents).toBe(60000);
    expect(line.calculatedAt).not.toBeNull();
    expect(line.staleReasons).toEqual([]);

    // The explanation must be stored, not recomputed from possibly-changed data.
    expect(line.steps.length).toBeGreaterThan(0);
    expect(line.steps.some((s) => s.label === 'Bars needed')).toBe(true);

    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
      'calculated'
    );
  });

  it('skips lines with no stated requirement instead of inventing one', async () => {
    const { project } = await readyProject(25);
    const extra = await createMaterial(ownerId, { ...TUBE, name: `no-req-${suffix}` });
    await selectProjectMaterial(project.id, ownerId, extra.id, null);

    const summary = await calculateProjectMaterials(project.id, ownerId);
    expect(summary.calculatedLines).toBe(1);
    expect(summary.skippedLines).toBe(1);

    const lines = await listProjectMaterials(project.id, ownerId);
    const skipped = lines.find((l) => l.materialId === extra.id);
    expect(skipped?.calculatedAt).toBeNull();
    expect(skipped?.totalCostCents).toBeNull();
  });

  it('snapshots the price so later edits do not rewrite a finished calculation', async () => {
    const { project, material } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);

    await updateMaterial(material.id, ownerId, { ...TUBE, name: material.name, unitPriceCents: 99000 });

    const [line] = await listProjectMaterials(project.id, ownerId);
    // The stored result still reflects the price that produced it.
    expect(line.unitPriceCentsSnapshot).toBe(12000);
    expect(line.totalCostCents).toBe(60000);
    // And the current library price is shown separately.
    expect(line.unitPriceCents).toBe(99000);
  });

  it('records a reason and no numbers when the engine cannot support a line', async () => {
    const project = await createProject(ownerId, { title: 'Unsupported' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);

    const material = await createMaterial(ownerId, { ...TUBE, name: `broken-${suffix}` });
    // Force an unsupported state the API layer would normally prevent.
    await prisma.material.update({ where: { id: material.id }, data: { standardLengthMm: null } });

    const rows = await selectProjectMaterial(project.id, ownerId, material.id, null);
    await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
      requiredQuantity: 25,
      requiredDimensions: null,
    });

    const summary = await calculateProjectMaterials(project.id, ownerId);
    expect(summary.unsupportedLines).toBe(1);

    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.unsupportedReason).toContain('standard stock length');
    expect(line.unitsToPurchase).toBeNull();
    expect(line.totalCostCents).toBeNull();
  });

  it('is idempotent — recalculating unchanged inputs gives the same numbers', async () => {
    const { project } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);
    const [first] = await listProjectMaterials(project.id, ownerId);

    await calculateProjectMaterials(project.id, ownerId);
    const [second] = await listProjectMaterials(project.id, ownerId);

    expect(second.unitsToPurchase).toBe(first.unitsToPurchase);
    expect(second.totalCostCents).toBe(first.totalCostCents);
    expect(second.staleReasons).toEqual([]);
  });
});

describe('stale detection', () => {
  it('flags a calculation when the material is edited afterwards', async () => {
    const { project, material } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);

    await updateMaterial(material.id, ownerId, { ...TUBE, name: material.name, unitPriceCents: 15000 });

    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.staleReasons).toContain('material_changed');
    // The old numbers stay visible so the user can see what changed.
    expect(line.totalCostCents).toBe(60000);
  });

  it('flags a calculation when the requirement is edited afterwards', async () => {
    const { project, lineId } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);

    await updateProjectMaterialRequirement(project.id, ownerId, lineId, {
      requiredQuantity: 40,
      requiredDimensions: null,
    });

    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.staleReasons).toContain('requirement_changed');
  });

  it('flags a calculation when a newer specification version is approved', async () => {
    const { project } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);

    // Changing the approved dimensions means the project is no longer the one
    // those quantities were derived for (PRD §24).
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12 } });
    await approveSpec(project.id, ownerId);

    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.staleReasons).toContain('spec_changed');
  });

  it('clears stale flags after recalculating', async () => {
    const { project, material } = await readyProject(25);
    await calculateProjectMaterials(project.id, ownerId);
    await updateMaterial(material.id, ownerId, { ...TUBE, name: material.name, unitPriceCents: 15000 });

    expect((await listProjectMaterials(project.id, ownerId))[0].staleReasons.length).toBeGreaterThan(0);

    await calculateProjectMaterials(project.id, ownerId);
    const [line] = await listProjectMaterials(project.id, ownerId);
    expect(line.staleReasons).toEqual([]);
    expect(line.totalCostCents).toBe(5 * 15000);
  });
});
