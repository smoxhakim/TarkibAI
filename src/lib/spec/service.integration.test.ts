/**
 * Integration tests for the specification service.
 *
 * These cover the guarantees that matter most in T1: that a spec cannot be
 * approved while incomplete, that approval snapshots a version, that an
 * approved spec is never mutated in place, and that none of it is reachable
 * across user boundaries.
 *
 * Run with: npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from './service';
import type { ProjectSpecPatch } from './schema';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;

const COMPLETE: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame on wall' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `o-${suffix}`, email: `o-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `x-${suffix}`, email: `x-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: [ownerId, otherId] } } } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

describe('draft specification', () => {
  it('starts empty and reports every required field as missing', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Empty spec' });
    const view = await getSpec(project.id, ownerId);
    expect(view.version).toBe(0);
    expect(view.complete).toBe(false);
    expect(view.missing.length).toBeGreaterThan(0);
  });

  it('accumulates patches across turns without losing earlier facts', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Accumulating' });

    await updateDraftSpec(project.id, ownerId, { projectType: 'enseigne' });
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 8, unit: 'm' } });
    const view = await updateDraftSpec(project.id, ownerId, { dimensions: { height: 3 } });

    expect(view.spec.projectType).toBe('enseigne');
    expect(view.spec.dimensions).toEqual({ width: 8, height: 3, unit: 'm' });
    // All three turns edit ONE draft row rather than creating a version each time.
    expect(view.version).toBe(1);
  });

  it("refuses to read or write another user's specification", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Private spec' });
    await updateDraftSpec(project.id, ownerId, { projectType: 'totem' });

    await expect(getSpec(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateDraftSpec(project.id, otherId, { projectType: 'hijacked' })
    ).rejects.toMatchObject({ status: 404 });

    const untouched = await getSpec(project.id, ownerId);
    expect(untouched.spec.projectType).toBe('totem');
  });
});

describe('approval', () => {
  it('refuses to approve an incomplete specification', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Incomplete' });
    await updateDraftSpec(project.id, ownerId, { projectType: 'enseigne' });

    await expect(approveSpec(project.id, ownerId)).rejects.toMatchObject({ status: 400 });

    // And the project must not have advanced a stage.
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.status).toBe('intake');
  });

  it('refuses to approve when no specification exists at all', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Nothing yet' });
    await expect(approveSpec(project.id, ownerId)).rejects.toMatchObject({ status: 400 });
  });

  it('approves a complete spec, snapshots a version, and advances the project stage', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Approvable' });
    await updateDraftSpec(project.id, ownerId, COMPLETE);

    const approved = await approveSpec(project.id, ownerId);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeInstanceOf(Date);

    const versions = await prisma.projectVersion.findMany({ where: { projectId: project.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    // The snapshot must capture the spec as approved, so documents generated
    // later can name the exact state that produced them.
    expect((versions[0].specSnapshot as { projectType?: string }).projectType).toBe('enseigne');

    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.status).toBe('spec_approved');
  });

  it('refuses to approve the same version twice', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Double approve' });
    await updateDraftSpec(project.id, ownerId, COMPLETE);
    await approveSpec(project.id, ownerId);

    await expect(approveSpec(project.id, ownerId)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.projectVersion.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("refuses to approve another user's specification", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Not yours' });
    await updateDraftSpec(project.id, ownerId, COMPLETE);

    await expect(approveSpec(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.projectVersion.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('opens a NEW draft version after approval instead of mutating the approved one', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Edit after approval' });
    await updateDraftSpec(project.id, ownerId, COMPLETE);
    await approveSpec(project.id, ownerId);

    const edited = await updateDraftSpec(project.id, ownerId, { quantity: 4 });
    expect(edited.version).toBe(2);
    expect(edited.status).toBe('draft');
    expect(edited.spec.quantity).toBe(4);
    // The approved record must still say what was agreed.
    const approvedRow = await prisma.projectSpec.findFirstOrThrow({
      where: { projectId: project.id, status: 'approved' },
    });
    expect((approvedRow.data as { quantity?: number }).quantity).toBe(1);
  });

  it('numbers subsequent approvals sequentially', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Two approvals' });
    await updateDraftSpec(project.id, ownerId, COMPLETE);
    await approveSpec(project.id, ownerId);
    await updateDraftSpec(project.id, ownerId, { quantity: 9 });
    await approveSpec(project.id, ownerId);

    const versions = await prisma.projectVersion.findMany({
      where: { projectId: project.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
  });
});
