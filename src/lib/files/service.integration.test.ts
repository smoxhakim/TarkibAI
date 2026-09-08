/**
 * Integration tests for file ownership boundaries.
 *
 * These run WITHOUT R2 configured, which is exactly the point: they verify that
 * ownership is checked before storage availability, so an outsider cannot even
 * learn whether a project has files or whether storage is enabled.
 *
 * Upload/download round trips against real R2 are covered separately once
 * credentials exist.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createUploadIntent, deleteFile, listFiles, loadReadyFiles } from './service';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;

const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of r2Keys) savedEnv[key] = process.env[key];
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `fo-${suffix}`, email: `fo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `fx-${suffix}`, email: `fx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);
});

afterEach(() => {
  for (const key of r2Keys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: [ownerId, otherId] } } } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

describe('file ownership', () => {
  it("refuses to list another user's files", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Files private' });
    await expect(listFiles(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to authorise an upload into another user's project", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'No upload' });
    await expect(
      createUploadIntent(project.id, otherId, {
        originalName: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        type: 'reference',
      })
    ).rejects.toMatchObject({ status: 404 });

    // Nothing may be reserved on a project the caller cannot access.
    expect(await prisma.file.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("refuses to delete another user's file", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'No delete' });
    const row = await prisma.file.create({
      data: {
        projectId: project.id,
        userId: ownerId,
        type: 'reference',
        objectKey: `dev/test/${suffix}-keep`,
        originalName: 'keep.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        status: 'ready',
      },
    });

    await expect(deleteFile(project.id, otherId, row.id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.file.count({ where: { id: row.id } })).toBe(1);
  });

  it('checks ownership BEFORE storage configuration', async () => {
    for (const key of r2Keys) delete process.env[key];
    const project = await createProject(ownerWs, ownerId, { title: 'Order matters' });

    // An outsider must get 404, never the 503 that would reveal whether storage
    // is configured on this deployment.
    await expect(
      createUploadIntent(project.id, otherId, {
        originalName: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        type: 'reference',
      })
    ).rejects.toMatchObject({ status: 404 });

    // The owner gets the honest 503.
    await expect(
      createUploadIntent(project.id, ownerId, {
        originalName: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        type: 'reference',
      })
    ).rejects.toMatchObject({ status: 503, code: 'storage_not_configured' });
  });
});

describe('file visibility', () => {
  it('hides pending uploads from listings until confirmed', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Pending hidden' });
    await prisma.file.create({
      data: {
        projectId: project.id,
        userId: ownerId,
        type: 'reference',
        objectKey: `dev/test/${suffix}-pending`,
        originalName: 'half-uploaded.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        status: 'pending',
      },
    });

    expect(await listFiles(project.id, ownerId)).toEqual([]);
  });

  it('will not load a file belonging to a different project', async () => {
    const projectA = await createProject(ownerWs, ownerId, { title: 'A' });
    const projectB = await createProject(ownerWs, ownerId, { title: 'B' });
    const row = await prisma.file.create({
      data: {
        projectId: projectA.id,
        userId: ownerId,
        type: 'reference',
        objectKey: `dev/test/${suffix}-cross`,
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        status: 'ready',
      },
    });

    // This is what stops a foreign file id smuggled into a chat message from
    // becoming vision context for the wrong project.
    expect(await loadReadyFiles(projectB.id, [row.id])).toEqual([]);
    expect(await loadReadyFiles(projectA.id, [row.id])).toHaveLength(1);
  });
});
