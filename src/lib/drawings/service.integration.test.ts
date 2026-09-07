/**
 * Integration tests for technical drawings.
 *
 * Projection and rendering are covered by unit tests. These cover the
 * live-versus-issued distinction, version numbering, and that an issued drawing
 * stays exactly as it was when a workshop received it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { applyCommands, seedScene } from '@/lib/canvas/service';
import { issueDrawing, listIssuedDrawings, renderLiveDrawing } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `dw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const SPEC: ProjectSpecPatch = {
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
    prisma.user.create({ data: { clerkId: `wo-${suffix}`, email: `wo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `wx-${suffix}`, email: `wx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

async function projectWithCanvas() {
  const project = await createProject(ownerId, { title: `drawing ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, SPEC);
  await approveSpec(project.id, ownerId);
  const scene = await seedScene(project.id, ownerId);
  return { project, panelId: scene.scene.objects[0].id };
}

describe('live drawing', () => {
  it('reports an empty canvas rather than drawing nothing silently', async () => {
    const project = await createProject(ownerId, { title: 'No canvas' });
    const live = await renderLiveDrawing(project.id, ownerId);
    expect(live.sceneEmpty).toBe(true);
    expect(live.views.every((view) => !view.available)).toBe(true);
  });

  it('renders front and back without depth, and marks side and top unavailable', async () => {
    const { project } = await projectWithCanvas();
    const live = await renderLiveDrawing(project.id, ownerId);

    const byKind = Object.fromEntries(live.views.map((view) => [view.kind, view]));
    expect(byKind.front.available).toBe(true);
    expect(byKind.back.available).toBe(true);
    // A side view without depth would imply a thickness nobody supplied.
    expect(byKind.side.available).toBe(false);
    expect(byKind.side.unavailableReason).toContain('depth');
  });

  it('makes side and top available once a part has depth', async () => {
    const { project, panelId } = await projectWithCanvas();
    await applyCommands(project.id, ownerId, [
      { kind: 'update_object', id: panelId, changes: { depthMm: 40 } },
    ]);

    const live = await renderLiveDrawing(project.id, ownerId);
    const byKind = Object.fromEntries(live.views.map((view) => [view.kind, view]));
    expect(byKind.side.available).toBe(true);
    expect(byKind.top.available).toBe(true);
  });

  it('follows the canvas immediately, so it can never be stale', async () => {
    const { project, panelId } = await projectWithCanvas();
    const before = await renderLiveDrawing(project.id, ownerId);

    await applyCommands(project.id, ownerId, [
      { kind: 'update_object', id: panelId, changes: { widthMm: 12000 } },
    ]);

    const after = await renderLiveDrawing(project.id, ownerId);
    expect(after.svg).not.toBe(before.svg);
    expect(after.svg).toContain('12 m width');
  });

  it("refuses to render another user's project", async () => {
    const { project } = await projectWithCanvas();
    await expect(renderLiveDrawing(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('issuing a drawing', () => {
  it('refuses to issue from an empty canvas', async () => {
    const project = await createProject(ownerId, { title: 'Empty issue' });
    await expect(issueDrawing(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
  });

  it('numbers issues sequentially per project', async () => {
    const { project } = await projectWithCanvas();
    const first = await issueDrawing(project.id, ownerId);
    const second = await issueDrawing(project.id, ownerId, { label: 'Sent to workshop' });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.label).toBe('Sent to workshop');
  });

  it('stores the SVG so an issued drawing never changes afterwards', async () => {
    const { project, panelId } = await projectWithCanvas();
    const issued = await issueDrawing(project.id, ownerId);

    // The project moves on after the workshop got its copy.
    await applyCommands(project.id, ownerId, [
      { kind: 'update_object', id: panelId, changes: { widthMm: 12000 } },
    ]);

    const stored = await prisma.diagram.findUniqueOrThrow({ where: { id: issued.id } });
    // The record must still show what the workshop was actually given.
    expect(stored.svg).toContain('8 m width');
    expect(stored.svg).not.toContain('12 m width');

    // While the live drawing has moved on.
    const live = await renderLiveDrawing(project.id, ownerId);
    expect(live.svg).toContain('12 m width');
  });

  it('records the scene it was drawn from, for traceability', async () => {
    const { project } = await projectWithCanvas();
    const issued = await issueDrawing(project.id, ownerId);

    const stored = await prisma.diagram.findUniqueOrThrow({ where: { id: issued.id } });
    const snapshot = stored.sourceSnapshot as { scene?: { objects?: unknown[] } };
    expect(snapshot.scene?.objects).toHaveLength(1);
  });

  it('carries the not-certified statement on the stored sheet', async () => {
    const { project } = await projectWithCanvas();
    const issued = await issueDrawing(project.id, ownerId);
    const stored = await prisma.diagram.findUniqueOrThrow({ where: { id: issued.id } });
    // The printed copy is what reaches a workshop, so the caveat must be on it.
    expect(stored.svg).toContain('Not a certified engineering drawing');
  });

  it('refuses when none of the requested views can be drawn', async () => {
    const { project } = await projectWithCanvas();
    // No part has depth, so side and top alone cannot produce a sheet.
    await expect(
      issueDrawing(project.id, ownerId, { kinds: ['side', 'top'] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to issue or list on another user's project", async () => {
    const { project } = await projectWithCanvas();
    await issueDrawing(project.id, ownerId);

    await expect(issueDrawing(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(listIssuedDrawings(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
