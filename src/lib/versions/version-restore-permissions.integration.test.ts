/**
 * Who may restore a project to an earlier version.
 *
 * `restoreVersion` wrote a new draft `ProjectSpec`, discarded the current
 * `CanvasScene` and put `Project.status` back to `intake` after checking
 * project MEMBERSHIP only, so a worker could revert the job. The worker role is
 * defined as "Read the project and its production package. Nothing else."
 *
 * It takes `project.edit`. The operation crosses two domains — the
 * specification it writes is `project.edit` territory, the canvas it overwrites
 * is `design.edit` territory — and one capability governs it safely because
 * `design.edit ⊆ project.edit` is asserted in the matrix. The specification is
 * the artefact being restored; the canvas follows it.
 *
 * Reading the timeline stays open. A worker must be able to see what the job
 * used to be, so `listVersions`, `getVersion`, `previewRestore` and
 * `compareVersions` keep project access and are asserted here so a future
 * change cannot quietly close them.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertProjectPermission, createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { applyCommands, seedScene, getScene } from '@/lib/canvas/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import {
  compareVersions,
  getVersion,
  listVersions,
  previewRestore,
  recordVersion,
  restoreVersion,
} from './service';

const suffix = `vrperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** A separate business, for the 404 assertions. */
let outsiderId: string;
let outsiderProjectId: string;
let outsiderVersionId: string;

const canEdit = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEdit = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/**
 * A project with an approved spec, a canvas, and a version to go back to —
 * then moved on, so a restore has something to actually change.
 */
async function projectWithHistory() {
  const project = await createProject(workspaceId, userIds.owner, {
    title: `Restore perms ${Math.random()}`,
  });
  await updateDraftSpec(project.id, userIds.owner, SPEC);
  await approveSpec(project.id, userIds.owner);
  const scene = await seedScene(project.id, userIds.owner);

  // Recorded AFTER the canvas exists, so the snapshot carries it. A version
  // captured before the scene was seeded has `canvas: null` and restoring it
  // would leave the design alone — which is correct behaviour, and would make
  // the assertions below prove nothing.
  const version = await recordVersion(project.id, {
    reason: 'manual',
    label: 'Before the widening',
  });

  // The project moves on, so restoring is observable.
  await applyCommands(project.id, userIds.owner, [
    { kind: 'update_object', id: scene.scene.objects[0].id, changes: { widthMm: 12_000 } },
  ]);

  return { project, versionId: version.id };
}

/** A version whose snapshot has no specification, so restoring it is a 400. */
async function projectWithEmptyVersion() {
  const project = await createProject(workspaceId, userIds.owner, {
    title: `Empty restore ${Math.random()}`,
  });
  const version = await recordVersion(project.id, { reason: 'manual', label: 'Nothing yet' });
  return { project, versionId: version.id };
}

beforeAll(async () => {
  const users = await Promise.all(
    WORKSPACE_ROLES.map((role) =>
      prisma.user.create({
        data: { clerkId: `${role}-${suffix}`, email: `${role}-${suffix}@example.test` },
      })
    )
  );
  WORKSPACE_ROLES.forEach((role, index) => {
    userIds[role] = users[index].id;
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Restore perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const otherWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });
  const otherWs = asWorkspaceId(otherWorkspace.id);

  const otherProject = await createProject(otherWs, outsiderId, { title: `Other ${suffix}` });
  await updateDraftSpec(otherProject.id, outsiderId, SPEC);
  await approveSpec(otherProject.id, outsiderId);
  outsiderProjectId = otherProject.id;
  const [foreignVersion] = await listVersions(otherProject.id, outsiderId);
  outsiderVersionId = foreignVersion.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The permission restoring takes                                              */
/* -------------------------------------------------------------------------- */

describe('the permission restoring a version takes', () => {
  it('is project.edit, and the worker does not hold it', () => {
    expect(can('designer', 'project.edit')).toBe(true);
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('worker', 'project.edit')).toBe(false);
  });

  it('can govern the canvas it overwrites, because design.edit ⊆ project.edit', () => {
    // If this ever stopped holding, `project.edit` would let someone discard a
    // design they are not allowed to edit, and restore would need both.
    for (const role of WORKSPACE_ROLES) {
      if (can(role, 'design.edit')) expect(can(role, 'project.edit')).toBe(true);
    }
  });

  it('leaves at least one role on each side of the boundary', () => {
    expect(canEdit.length).toBeGreaterThan(0);
    expect(cannotEdit).toContain('worker');
  });
});

/* -------------------------------------------------------------------------- */
/* Restoring                                                                   */
/* -------------------------------------------------------------------------- */

describe('restoring a version', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project, versionId } = await projectWithHistory();
    const restored = await restoreVersion(versionId, userIds[role]);

    expect(restored.reason).toBe('restored');
    // The canvas came back to what the version held.
    const scene = await getScene(project.id, userIds.owner);
    expect(scene.scene.objects[0].widthMm).toBe(8_000);
  });

  it.each(cannotEdit)('is refused for %s, and changes nothing at all', async (role) => {
    const { project, versionId } = await projectWithHistory();

    const specsBefore = await prisma.projectSpec.count({ where: { projectId: project.id } });
    const versionsBefore = await prisma.projectVersion.count({ where: { projectId: project.id } });
    const auditBefore = await prisma.auditEvent.count({ where: { projectId: project.id } });
    const sceneBefore = await getScene(project.id, userIds.owner);
    const projectBefore = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });

    await expect(restoreVersion(versionId, userIds[role])).rejects.toMatchObject({ status: 403 });

    expect(await prisma.projectSpec.count({ where: { projectId: project.id } })).toBe(specsBefore);
    expect(await prisma.projectVersion.count({ where: { projectId: project.id } })).toBe(
      versionsBefore
    );
    expect(await prisma.auditEvent.count({ where: { projectId: project.id } })).toBe(auditBefore);

    // The design the caller could not edit is still the design.
    const sceneAfter = await getScene(project.id, userIds.owner);
    expect(sceneAfter.scene.objects[0].widthMm).toBe(sceneBefore.scene.objects[0].widthMm);
    expect(sceneAfter.scene.objects[0].widthMm).toBe(12_000);

    const projectAfter = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(projectAfter.status).toBe(projectBefore.status);
  });

  it.each(cannotEdit)('refuses %s BEFORE the snapshot is read, not after', async (role) => {
    // A version with no specification snapshot is a 400 for someone who may
    // restore. A caller without the permission must not be able to tell that
    // apart from a restorable one, which is only true if the capability is
    // asserted before the snapshot is looked at.
    const { versionId } = await projectWithEmptyVersion();

    await expect(restoreVersion(versionId, userIds[role])).rejects.toMatchObject({ status: 403 });
    // And an authorised caller really does reach the domain guard.
    await expect(restoreVersion(versionId, userIds.owner)).rejects.toMatchObject({ status: 400 });
  });

  it('reports another business’s version as missing, not forbidden', async () => {
    await expect(restoreVersion(outsiderVersionId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(cannotEdit)('reports another business’s version as missing to %s too', async (role) => {
    await expect(restoreVersion(outsiderVersionId, userIds[role])).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Reading the timeline                                                        */
/* -------------------------------------------------------------------------- */

describe('reading the version history', () => {
  it.each(WORKSPACE_ROLES)('stays open to %s, including the roles that cannot restore', async (role) => {
    const { project, versionId } = await projectWithHistory();

    const versions = await listVersions(project.id, userIds[role]);
    expect(versions.length).toBeGreaterThan(0);

    const one = await getVersion(versionId, userIds[role]);
    expect(one.id).toBe(versionId);

    // Previewing is a read: it says what restoring WOULD do, and changes nothing.
    const preview = await previewRestore(versionId, userIds[role]);
    expect(preview.version.id).toBe(versionId);
    expect(preview.consequences.length).toBeGreaterThan(0);

    if (versions.length >= 2) {
      const diff = await compareVersions(project.id, userIds[role], {
        fromId: versions[1].id,
        toId: versions[0].id,
      });
      expect(diff).toBeTruthy();
    }
  });

  it('previewing does not restore', async () => {
    const { project, versionId } = await projectWithHistory();
    await previewRestore(versionId, userIds.worker);

    const scene = await getScene(project.id, userIds.owner);
    expect(scene.scene.objects[0].widthMm).toBe(12_000);
  });

  it('still refuses the reads across businesses', async () => {
    await expect(getVersion(outsiderVersionId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
    await expect(previewRestore(outsiderVersionId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Saving a version by hand                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `recordVersion` is an internal primitive: the services that call it have
 * already checked their own permission, and it takes no userId. The one
 * untrusted way in is POST /api/projects/:id/versions, which gates it with
 * `assertProjectPermission(id, user.id, 'project.edit')`.
 *
 * Route handlers cannot be exercised here — they resolve identity from the
 * Clerk session — so what is asserted is the expression the route evaluates,
 * against the same projects and the same roles.
 */
describe('the manual version route gate', () => {
  it.each(canEdit)('admits %s', async (role) => {
    const { project } = await projectWithHistory();
    await expect(
      assertProjectPermission(project.id, userIds[role], 'project.edit')
    ).resolves.toBeTruthy();
  });

  it.each(cannotEdit)('refuses %s', async (role) => {
    const { project } = await projectWithHistory();
    await expect(
      assertProjectPermission(project.id, userIds[role], 'project.edit')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reports another business’s project as missing rather than forbidden', async () => {
    await expect(
      assertProjectPermission(outsiderProjectId, userIds.owner, 'project.edit')
    ).rejects.toMatchObject({ status: 404 });
  });
});
