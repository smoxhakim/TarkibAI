/**
 * Integration tests for the project service against the real database.
 *
 * These verify the guarantees that unit tests cannot: that ownership is actually
 * enforced at the query level, and that a hard delete really does cascade to
 * dependent rows rather than failing on a foreign key.
 *
 * Run with: npm run test:integration
 * Every row created here is removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http/api';
import {
  assertProjectAccess,
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from './service';

const suffix = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerClerkId = `clerk-owner-${suffix}`;
const otherClerkId = `clerk-other-${suffix}`;

let ownerId: string;
let otherId: string;

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { clerkId: ownerClerkId, email: `owner-${suffix}@example.test`, name: 'Owner' },
  });
  const other = await prisma.user.create({
    data: { clerkId: otherClerkId, email: `other-${suffix}@example.test`, name: 'Other' },
  });
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(async () => {
  // Projects cascade to their dependent rows; users are removed last.
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

describe('ownership isolation', () => {
  it("refuses to load another user's project, and reports 404 rather than 403", async () => {
    const project = await createProject(ownerId, { title: 'Owner project' });

    await expect(assertProjectAccess(project.id, otherId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(assertProjectAccess(project.id, otherId)).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses to rename or archive another user's project", async () => {
    const project = await createProject(ownerId, { title: 'Owner project 2' });

    await expect(updateProject(project.id, otherId, { title: 'hijacked' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(updateProject(project.id, otherId, { archived: true })).rejects.toMatchObject({
      status: 404,
    });

    const untouched = await assertProjectAccess(project.id, ownerId);
    expect(untouched.title).toBe('Owner project 2');
    expect(untouched.archivedAt).toBeNull();
  });

  it("refuses to delete another user's project", async () => {
    const project = await createProject(ownerId, { title: 'Owner project 3' });

    await expect(deleteProject(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    expect(await assertProjectAccess(project.id, ownerId)).toBeTruthy();
  });

  it('scopes listing to the requesting user', async () => {
    await createProject(otherId, { title: 'Other user project' });

    const ownerTitles = (await listProjects(ownerId)).map((p) => p.title);
    expect(ownerTitles).not.toContain('Other user project');
  });

  it('reports a non-existent project as 404', async () => {
    await expect(
      assertProjectAccess('00000000-0000-0000-0000-000000000000', ownerId)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('archive lifecycle', () => {
  it('archives, hides from the default listing, and restores with the stage intact', async () => {
    const project = await createProject(ownerId, { title: 'Archivable' });
    await prisma.project.update({ where: { id: project.id }, data: { status: 'quoted' } });

    const archived = await updateProject(project.id, ownerId, { archived: true });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    // The workflow stage survives archiving — that is why archived is not a status value.
    expect(archived.status).toBe('quoted');

    const defaultList = await listProjects(ownerId);
    expect(defaultList.map((p) => p.id)).not.toContain(project.id);

    const withArchived = await listProjects(ownerId, { includeArchived: true });
    expect(withArchived.map((p) => p.id)).toContain(project.id);

    const restored = await updateProject(project.id, ownerId, { archived: false });
    expect(restored.archivedAt).toBeNull();
    expect(restored.status).toBe('quoted');
  });
});

describe('hard delete', () => {
  it('cascades to dependent rows instead of failing on a foreign key', async () => {
    const project = await createProject(ownerId, { title: 'Deletable' });

    // One dependent row from each direction the cascade has to cover.
    await prisma.chatMessage.create({
      data: { projectId: project.id, role: 'user', content: 'bghit enseigne dyal restaurant' },
    });
    await prisma.projectSpec.create({
      data: { projectId: project.id, version: 1, data: { dimensions: { width: 8 } } },
    });
    await prisma.document.create({
      data: { projectId: project.id, type: 'client_quote', version: 1, pdfUrl: 'r2://test' },
    });

    await deleteProject(project.id, ownerId);

    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.chatMessage.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.projectSpec.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.document.count({ where: { projectId: project.id } })).toBe(0);
  });
});
