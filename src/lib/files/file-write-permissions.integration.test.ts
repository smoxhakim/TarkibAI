/**
 * Who may add and remove a project's files.
 *
 * `createUploadIntent`, `confirmUpload` and `deleteFile` wrote `File` rows and
 * R2 objects after checking project MEMBERSHIP only, so a worker could upload
 * into a job and — worse — delete every site photo and reference document on
 * it, object and row together, with nothing to restore from. The worker role is
 * defined as "Read the project and its production package. Nothing else."
 *
 * All three take `project.edit`, which is defined as "Edit the specification,
 * FILES and conversation". The permission already named this operation; it was
 * simply not enforced.
 *
 * Reads stay open. A worker must be able to open the site photo for the job
 * they are building, so `listFiles` and `getFileDownloadUrl` keep project
 * access and are asserted here so a future change cannot quietly close them.
 *
 * Creator ownership is NOT the boundary and must never become it: a project
 * editor may confirm and delete a colleague's upload. That is asserted below,
 * because the obvious "fix" for a file permission is the wrong one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import { isStorageConfigured } from '@/lib/storage/config';
import {
  confirmUpload,
  createUploadIntent,
  deleteFile,
  getFileDownloadUrl,
  listFiles,
} from './service';

/**
 * Counts every call that would touch the bucket.
 *
 * `vi.spyOn` cannot redefine a live ES module export, so the module is wrapped
 * instead. The real implementations still run — this only records that they
 * were reached, which is the whole assertion.
 */
const r2Calls = vi.hoisted(() => ({ sign: 0, head: 0, del: 0 }));

vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>();
  return {
    ...actual,
    createSignedUploadUrl: (...args: Parameters<typeof actual.createSignedUploadUrl>) => {
      r2Calls.sign += 1;
      return actual.createSignedUploadUrl(...args);
    },
    headObject: (...args: Parameters<typeof actual.headObject>) => {
      r2Calls.head += 1;
      return actual.headObject(...args);
    },
    deleteObject: (...args: Parameters<typeof actual.deleteObject>) => {
      r2Calls.del += 1;
      return actual.deleteObject(...args);
    },
  };
});

const suffix = `flperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** A separate business, for the 404 assertions. */
let outsiderId: string;
let outsiderProjectId: string;

const canEdit = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEdit = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));

/**
 * R2 is not reachable from the test environment, so the storage-touching half
 * of these tests is skipped rather than faked. The AUTHORIZATION half — which
 * is what this file is about — runs either way, because every check happens
 * before storage is consulted.
 */
const storage = isStorageConfigured();
const withStorage = storage ? describe : describe.skip;

const UPLOAD = {
  type: 'photo',
  originalName: 'site.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 12_345,
} as const;

const newProject = (title = 'File perms') =>
  createProject(workspaceId, userIds.owner, { title: `${title} ${Math.random()}` });

/** An id shaped like the ones the schemas accept, belonging to nothing. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

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
      name: `File perms ${suffix}`,
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
  const otherProject = await createProject(asWorkspaceId(otherWorkspace.id), outsiderId, {
    title: `Other ${suffix}`,
  });
  outsiderProjectId = otherProject.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.file.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The permission these operations take                                        */
/* -------------------------------------------------------------------------- */

describe('the permission file writes take', () => {
  it('is project.edit, and the worker does not hold it', () => {
    expect(can('designer', 'project.edit')).toBe(true);
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('worker', 'project.edit')).toBe(false);
  });

  it('is not design.edit: production and sales would lose their own files', () => {
    expect(can('production', 'design.edit')).toBe(false);
    expect(can('sales', 'design.edit')).toBe(false);
  });

  it('is not cost.view: a file carries no money, and production lacks it', () => {
    expect(can('production', 'cost.view')).toBe(false);
  });

  it('leaves at least one role on each side of the boundary', () => {
    expect(canEdit.length).toBeGreaterThan(0);
    expect(cannotEdit).toContain('worker');
  });
});

/* -------------------------------------------------------------------------- */
/* Authorization, with no storage involved                                     */
/* -------------------------------------------------------------------------- */

describe('a caller without project.edit', () => {
  it.each(cannotEdit)('cannot create an upload intent as %s, and no row appears', async (role) => {
    const project = await newProject();

    await expect(createUploadIntent(project.id, userIds[role], UPLOAD)).rejects.toMatchObject({
      status: 403,
    });

    expect(await prisma.file.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('cannot confirm an upload as %s', async (role) => {
    const project = await newProject();
    await expect(
      confirmUpload(project.id, userIds[role], ABSENT_ID)
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(cannotEdit)('cannot delete a file as %s', async (role) => {
    const project = await newProject();
    await expect(deleteFile(project.id, userIds[role], ABSENT_ID)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('is refused before storage is reached at all', async () => {
    // The point of the ordering: no signed URL is minted, nothing is HEADed and
    // nothing is deleted for a caller who may not write. If any of these ran,
    // an unauthorized request would be touching the bucket.
    const project = await newProject();
    const before = { ...r2Calls };

    await expect(createUploadIntent(project.id, userIds.worker, UPLOAD)).rejects.toMatchObject({
      status: 403,
    });
    await expect(confirmUpload(project.id, userIds.worker, ABSENT_ID)).rejects.toMatchObject({
      status: 403,
    });
    await expect(deleteFile(project.id, userIds.worker, ABSENT_ID)).rejects.toMatchObject({
      status: 403,
    });

    expect(r2Calls).toEqual(before);
  });

  it.each(cannotEdit)(
    'gets the same 403 for a file that exists and one that does not, as %s',
    async (role) => {
      // Otherwise the pair of answers is a read of the file list by another name.
      const project = await newProject();
      const present = await prisma.file.create({
        data: {
          projectId: project.id,
          userId: userIds.owner,
          type: 'photo',
          objectKey: `test/${suffix}/${Math.random()}.jpg`,
          originalName: 'present.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          status: 'ready',
        },
      });

      await expect(deleteFile(project.id, userIds[role], present.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(deleteFile(project.id, userIds[role], ABSENT_ID)).rejects.toMatchObject({
        status: 403,
      });

      // And it is still there.
      expect(await prisma.file.count({ where: { id: present.id } })).toBe(1);
    }
  );
});

describe('cross-workspace', () => {
  it.each(WORKSPACE_ROLES)('reports another business’s project as missing to %s', async (role) => {
    // 404 before 403, for every role: an outsider must not learn it exists.
    await expect(
      createUploadIntent(outsiderProjectId, userIds[role], UPLOAD)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      confirmUpload(outsiderProjectId, userIds[role], ABSENT_ID)
    ).rejects.toMatchObject({ status: 404 });
    await expect(deleteFile(outsiderProjectId, userIds[role], ABSENT_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe('reading files', () => {
  it.each(WORKSPACE_ROLES)('stays open to %s, including the roles that cannot write', async (role) => {
    const project = await newProject();
    await prisma.file.create({
      data: {
        projectId: project.id,
        userId: userIds.owner,
        type: 'photo',
        objectKey: `test/${suffix}/${Math.random()}.jpg`,
        originalName: 'readable.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        status: 'ready',
      },
    });

    const files = await listFiles(project.id, userIds[role]);
    expect(files).toHaveLength(1);
    expect(files[0].originalName).toBe('readable.jpg');
  });

  it('still refuses to list another business’s files', async () => {
    await expect(listFiles(outsiderProjectId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The write path itself, where storage is available                           */
/* -------------------------------------------------------------------------- */

withStorage('with storage configured', () => {
  it.each(canEdit)('lets %s create an upload intent', async (role) => {
    const project = await newProject();
    const intent = await createUploadIntent(project.id, userIds[role], UPLOAD);

    expect(intent.uploadUrl).toContain('http');
    const row = await prisma.file.findUniqueOrThrow({ where: { id: intent.fileId } });
    expect(row.status).toBe('pending');
    expect(row.projectId).toBe(project.id);
  });

  it.each(canEdit)('lets %s delete a file', async (role) => {
    const project = await newProject();
    const intent = await createUploadIntent(project.id, userIds.owner, UPLOAD);

    await deleteFile(project.id, userIds[role], intent.fileId);
    expect(await prisma.file.count({ where: { id: intent.fileId } })).toBe(0);
  });

  it('does not reintroduce creator ownership', async () => {
    // One member reserves the upload; a DIFFERENT member with the permission
    // confirms and deletes it. Comparing `File.userId` to the caller would be
    // the pre-workspace rule this codebase removed in T18, and it would break
    // exactly this.
    const project = await newProject();
    const intent = await createUploadIntent(project.id, userIds.designer, UPLOAD);

    // The object never landed, so confirming reports that rather than
    // succeeding — the point is that it is not an AUTHORIZATION failure.
    await expect(confirmUpload(project.id, userIds.production, intent.fileId)).rejects.toMatchObject(
      { status: 400 }
    );

    await deleteFile(project.id, userIds.production, intent.fileId);
    expect(await prisma.file.count({ where: { id: intent.fileId } })).toBe(0);
  });

  it('refuses a signed download for a file that is not ready', async () => {
    const project = await newProject();
    const intent = await createUploadIntent(project.id, userIds.owner, UPLOAD);
    await expect(
      getFileDownloadUrl(project.id, userIds.worker, intent.fileId)
    ).rejects.toMatchObject({ status: 404 });
  });
});
