/**
 * Integration tests for canvas persistence.
 *
 * Command semantics are covered by unit tests. These cover what the database
 * decides: ownership, seeding from an approved spec, divergence detection, and
 * that a failed batch leaves the stored scene untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { applyCommands, getScene, seedScene } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `vo-${suffix}`, email: `vo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `vx-${suffix}`, email: `vx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

async function approvedProject(patch: ProjectSpecPatch = COMPLETE_SPEC) {
  const project = await createProject(ownerId, { title: `canvas ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, patch);
  await approveSpec(project.id, ownerId);
  return project;
}

describe('ownership', () => {
  it("refuses to read, seed or command another user's canvas", async () => {
    const project = await approvedProject();
    await seedScene(project.id, ownerId);

    await expect(getScene(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(seedScene(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      applyCommands(project.id, otherId, [{ kind: 'remove_object', id: 'anything' }])
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('seeding', () => {
  it('refuses to seed before a specification is approved', async () => {
    const project = await createProject(ownerId, { title: 'Unapproved canvas' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);

    await expect(seedScene(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.canvasScene.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('builds a panel from the approved dimensions', async () => {
    const project = await approvedProject();
    const view = await seedScene(project.id, ownerId);

    expect(view.scene.objects).toHaveLength(1);
    expect(view.scene.objects[0].widthMm).toBe(8000);
    expect(view.scene.objects[0].heightMm).toBe(3000);
    expect(view.specVersionAtSeed).toBe(1);
    expect(view.diverged).toBe(false);
  });

  it('refuses when the approved spec has no usable dimensions', async () => {
    // A spec can be complete for approval yet lack a unit if older data exists;
    // there is nothing truthful to draw, so no placeholder is invented.
    const project = await approvedProject();
    await prisma.projectSpec.updateMany({
      where: { projectId: project.id },
      data: { data: { specVersion: 1, projectType: 'enseigne' } },
    });

    await expect(seedScene(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
  });

  it('reports why seeding is blocked instead of returning an empty scene silently', async () => {
    const project = await createProject(ownerId, { title: 'No spec' });
    const view = await getScene(project.id, ownerId);
    expect(view.scene.objects).toEqual([]);
    expect(view.seedBlockedReason).toContain('Approve the project specification');
  });
});

describe('divergence from the specification', () => {
  it('flags the canvas when a newer specification is approved', async () => {
    const project = await approvedProject();
    await seedScene(project.id, ownerId);
    expect((await getScene(project.id, ownerId)).diverged).toBe(false);

    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12 } });
    await approveSpec(project.id, ownerId);

    const view = await getScene(project.id, ownerId);
    // The spec is the source of truth; the canvas says it no longer matches
    // rather than presenting stale geometry as the project (PRD §9).
    expect(view.diverged).toBe(true);
    expect(view.scene.objects[0].widthMm).toBe(8000);
  });

  it('clears the flag after rebuilding from the newer specification', async () => {
    const project = await approvedProject();
    await seedScene(project.id, ownerId);
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12 } });
    await approveSpec(project.id, ownerId);

    const rebuilt = await seedScene(project.id, ownerId);
    expect(rebuilt.diverged).toBe(false);
    expect(rebuilt.scene.objects[0].widthMm).toBe(12000);
  });

  it('does not rewrite the specification when the canvas is edited', async () => {
    const project = await approvedProject();
    const seeded = await seedScene(project.id, ownerId);

    await applyCommands(project.id, ownerId, [
      { kind: 'update_object', id: seeded.scene.objects[0].id, changes: { widthMm: 9000 } },
    ]);

    // Canvas edits are layout detail, not agreed project facts.
    const spec = await prisma.projectSpec.findFirstOrThrow({
      where: { projectId: project.id, status: 'approved' },
      orderBy: { version: 'desc' },
    });
    expect((spec.data as { dimensions?: { width?: number } }).dimensions?.width).toBe(8);
  });
});

describe('commands', () => {
  it('persists add, update and remove', async () => {
    const project = await approvedProject();
    await seedScene(project.id, ownerId);

    const added = await applyCommands(project.id, ownerId, [
      {
        kind: 'add_object',
        object: {
          id: 'frame-1',
          type: 'frame',
          label: 'Steel frame',
          x: 0,
          y: 0,
          widthMm: 8000,
          heightMm: 3000,
          rotationDeg: 0,
          showDimensions: false,
        },
      },
    ]);
    expect(added.scene.objects).toHaveLength(2);

    const updated = await applyCommands(project.id, ownerId, [
      { kind: 'update_object', id: 'frame-1', changes: { label: 'Renamed' } },
    ]);
    expect(updated.scene.objects.find((o) => o.id === 'frame-1')?.label).toBe('Renamed');

    const removed = await applyCommands(project.id, ownerId, [
      { kind: 'remove_object', id: 'frame-1' },
    ]);
    expect(removed.scene.objects.map((o) => o.id)).not.toContain('frame-1');
  });

  it('leaves the stored scene untouched when a batch fails partway', async () => {
    const project = await approvedProject();
    const seeded = await seedScene(project.id, ownerId);
    const originalWidth = seeded.scene.objects[0].widthMm;

    await expect(
      applyCommands(project.id, ownerId, [
        { kind: 'update_object', id: seeded.scene.objects[0].id, changes: { widthMm: 5000 } },
        { kind: 'remove_object', id: 'does-not-exist' },
      ])
    ).rejects.toMatchObject({ status: 404 });

    // Commands are applied in memory first, so nothing is half-written.
    const after = await getScene(project.id, ownerId);
    expect(after.scene.objects[0].widthMm).toBe(originalWidth);
  });

  it('creates a scene on first command even without seeding', async () => {
    const project = await approvedProject();
    const view = await applyCommands(project.id, ownerId, [
      {
        kind: 'add_object',
        object: {
          type: 'note',
          label: 'Site access is tight',
          x: 0,
          y: 0,
          widthMm: 1000,
          heightMm: 500,
          rotationDeg: 0,
          showDimensions: false,
        },
      },
    ]);
    expect(view.scene.objects).toHaveLength(1);
  });
});
