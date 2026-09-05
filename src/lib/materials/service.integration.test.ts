/**
 * Integration tests for the material library.
 *
 * A user's material library holds their suppliers and their purchase prices —
 * private business data (PRD §22). The isolation tests here matter as much as
 * the lifecycle ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import {
  createMaterial,
  deleteMaterial,
  getMaterial,
  listCategories,
  listMaterials,
  listProjectMaterials,
  removeProjectMaterial,
  selectProjectMaterial,
  setMaterialArchived,
  updateMaterial,
} from './service';
import type { CreateMaterialInput } from './schema';

const suffix = `mat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const sheetInput: CreateMaterialInput = {
  name: 'Alucobond 3mm noir',
  category: 'Panel',
  customCategory: false,
  measurementModel: 'sheet',
  sheetWidthMm: 2440,
  sheetHeightMm: 1220,
  thicknessMm: 3,
  unitPriceCents: 85000,
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `mo-${suffix}`, email: `mo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `mx-${suffix}`, email: `mx-${suffix}@example.test` } }),
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

describe('library isolation', () => {
  it("never returns another user's materials or prices", async () => {
    await createMaterial(ownerId, { ...sheetInput, name: `Owner secret ${suffix}` });

    const otherLibrary = await listMaterials(otherId, { includeArchived: true });
    expect(otherLibrary.map((m) => m.name)).not.toContain(`Owner secret ${suffix}`);
  });

  it("refuses to read, edit, archive or delete another user's material", async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Private ${suffix}` });

    await expect(getMaterial(material.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateMaterial(material.id, otherId, { ...sheetInput, unitPriceCents: 1 })
    ).rejects.toMatchObject({ status: 404 });
    await expect(setMaterialArchived(material.id, otherId, true)).rejects.toMatchObject({ status: 404 });
    await expect(deleteMaterial(material.id, otherId)).rejects.toMatchObject({ status: 404 });

    const untouched = await getMaterial(material.id, ownerId);
    expect(untouched.unitPriceCents).toBe(85000);
    expect(untouched.archivedAt).toBeNull();
  });
});

describe('search and filtering', () => {
  it('matches on name, supplier and notes, case-insensitively', async () => {
    await createMaterial(ownerId, {
      ...sheetInput,
      name: `Plexi opale ${suffix}`,
      category: 'Acrylic',
      supplier: 'Sonasid',
      notes: 'commande spéciale',
    });

    const byName = await listMaterials(ownerId, { search: 'PLEXI OPALE', includeArchived: false });
    expect(byName.some((m) => m.name.includes('Plexi opale'))).toBe(true);

    const bySupplier = await listMaterials(ownerId, { search: 'sonasid', includeArchived: false });
    expect(bySupplier.length).toBeGreaterThan(0);

    const byNotes = await listMaterials(ownerId, { search: 'spéciale', includeArchived: false });
    expect(byNotes.length).toBeGreaterThan(0);
  });

  it('filters by category and measurement model', async () => {
    await createMaterial(ownerId, {
      name: `Tube ${suffix}`,
      category: 'Metal',
      customCategory: false,
      measurementModel: 'linear',
      standardLengthMm: 6000,
      unitPriceCents: 12000,
    });

    const metal = await listMaterials(ownerId, { category: 'Metal', includeArchived: false });
    expect(metal.every((m) => m.category === 'Metal')).toBe(true);

    const linear = await listMaterials(ownerId, { measurementModel: 'linear', includeArchived: false });
    expect(linear.every((m) => m.measurementModel === 'linear')).toBe(true);
  });

  it('lists only categories the user actually has', async () => {
    const categories = await listCategories(ownerId);
    expect(categories).toContain('Panel');
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe('archiving and deletion', () => {
  it('hides archived materials by default and restores them', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Archivable ${suffix}` });

    await setMaterialArchived(material.id, ownerId, true);
    const visible = await listMaterials(ownerId, { includeArchived: false });
    expect(visible.map((m) => m.id)).not.toContain(material.id);

    const all = await listMaterials(ownerId, { includeArchived: true });
    expect(all.map((m) => m.id)).toContain(material.id);

    await setMaterialArchived(material.id, ownerId, false);
    expect((await getMaterial(material.id, ownerId)).archivedAt).toBeNull();
  });

  it('deletes a material that no project uses', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Unused ${suffix}` });
    await deleteMaterial(material.id, ownerId);
    await expect(getMaterial(material.id, ownerId)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to delete a material a project depends on', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `In use ${suffix}` });
    const project = await createProject(ownerId, { title: 'Uses material' });
    await selectProjectMaterial(project.id, ownerId, material.id, 'façade');

    // Deleting would orphan any quote or production document that referenced it.
    await expect(deleteMaterial(material.id, ownerId)).rejects.toMatchObject({
      status: 409,
      code: 'material_in_use',
    });
    expect(await getMaterial(material.id, ownerId)).toBeTruthy();
  });

  it('clears dimensions that no longer apply when the model changes', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Switcher ${suffix}` });

    const updated = await updateMaterial(material.id, ownerId, {
      name: `Switcher ${suffix}`,
      category: 'Metal',
      customCategory: false,
      measurementModel: 'linear',
      standardLengthMm: 6000,
      unitPriceCents: 12000,
    });

    // Stale sheet dimensions on a bar would feed nonsense into the cutting engine.
    expect(updated.standardLengthMm).toBe(6000);
    expect(updated.sheetWidthMm).toBeNull();
    expect(updated.sheetHeightMm).toBeNull();
  });
});

describe('project selection', () => {
  it('records a selection with no calculated values', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Selectable ${suffix}` });
    const project = await createProject(ownerId, { title: 'Selection' });

    const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'façade');
    expect(rows).toHaveLength(1);

    // A selection is not a calculation. Zero-filling these would be a fabricated
    // quantity and cost (PRD §5.3).
    expect(rows[0].requiredQuantity).toBeNull();
    expect(rows[0].unitsToPurchase).toBeNull();
    expect(rows[0].totalCostCents).toBeNull();
    expect(rows[0].calculatedAt).toBeNull();
    expect(rows[0].role).toBe('façade');
  });

  it('refuses to select the same material twice', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Once ${suffix}` });
    const project = await createProject(ownerId, { title: 'Once only' });

    await selectProjectMaterial(project.id, ownerId, material.id, null);
    await expect(selectProjectMaterial(project.id, ownerId, material.id, null)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to select another user's material into your project", async () => {
    const foreign = await createMaterial(otherId, { ...sheetInput, name: `Foreign ${suffix}` });
    const project = await createProject(ownerId, { title: 'Cross user' });

    // Otherwise a project could reference someone else's private pricing.
    await expect(selectProjectMaterial(project.id, ownerId, foreign.id, null)).rejects.toMatchObject({
      status: 404,
    });
    expect(await listProjectMaterials(project.id, ownerId)).toEqual([]);
  });

  it('refuses to select an archived material', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Archived pick ${suffix}` });
    await setMaterialArchived(material.id, ownerId, true);
    const project = await createProject(ownerId, { title: 'Archived pick' });

    await expect(selectProjectMaterial(project.id, ownerId, material.id, null)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses to list or remove another user's project selections", async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Guarded ${suffix}` });
    const project = await createProject(ownerId, { title: 'Guarded' });
    const rows = await selectProjectMaterial(project.id, ownerId, material.id, null);

    await expect(listProjectMaterials(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(removeProjectMaterial(project.id, otherId, rows[0].id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await listProjectMaterials(project.id, ownerId)).toHaveLength(1);
  });

  it('removes a selection without touching the library material', async () => {
    const material = await createMaterial(ownerId, { ...sheetInput, name: `Removable ${suffix}` });
    const project = await createProject(ownerId, { title: 'Removable' });
    const rows = await selectProjectMaterial(project.id, ownerId, material.id, null);

    await removeProjectMaterial(project.id, ownerId, rows[0].id);
    expect(await listProjectMaterials(project.id, ownerId)).toEqual([]);
    expect(await getMaterial(material.id, ownerId)).toBeTruthy();
  });
});
