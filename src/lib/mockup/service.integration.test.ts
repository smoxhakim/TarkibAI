/**
 * Integration tests for mockups.
 *
 * Live generation needs a Replicate token and is not exercised here. These cover
 * the parts that must hold regardless: ownership, that a mockup is refused
 * before there is anything to visualise, and that failures record a reason
 * rather than leaving a card stuck.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { updateDraftSpec } from '@/lib/spec/service';
import { deleteMockup, listMockups, requestMockup, runMockup } from './service';

const suffix = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const savedToken = process.env.REPLICATE_API_TOKEN;
const savedR2 = process.env.R2_BUCKET_NAME;

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `mo-${suffix}`, email: `mo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `mx-${suffix}`, email: `mx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = savedToken;
  if (savedR2 === undefined) delete process.env.R2_BUCKET_NAME;
  else process.env.R2_BUCKET_NAME = savedR2;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

async function describedProject() {
  const project = await createProject(ownerId, { title: `mockup ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, {
    projectType: 'enseigne',
    materials: [{ name: 'alucobond noir' }],
  });
  return project;
}

describe('preconditions', () => {
  it('refuses when generation is not configured', async () => {
    delete process.env.REPLICATE_API_TOKEN;
    const project = await describedProject();

    await expect(
      requestMockup(project.id, ownerId, { kind: 'concept' })
    ).rejects.toMatchObject({ status: 503, code: 'mockup_not_configured' });
  });

  it('refuses before the project has been described', async () => {
    process.env.REPLICATE_API_TOKEN = 'test-token';
    const project = await createProject(ownerId, { title: 'Nothing described' });

    // A mockup is generated FROM the specification. With nothing recorded the
    // model would invent the entire project.
    await expect(requestMockup(project.id, ownerId, { kind: 'concept' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a site mockup with no photo chosen', async () => {
    process.env.REPLICATE_API_TOKEN = 'test-token';
    const project = await describedProject();

    await expect(requestMockup(project.id, ownerId, { kind: 'site' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a site photo from another project', async () => {
    process.env.REPLICATE_API_TOKEN = 'test-token';
    const [projectA, projectB] = await Promise.all([describedProject(), describedProject()]);

    const file = await prisma.file.create({
      data: {
        projectId: projectA.id,
        userId: ownerId,
        type: 'photo',
        objectKey: `dev/test/${suffix}-photo`,
        originalName: 'site.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        status: 'ready',
      },
    });

    await expect(
      requestMockup(projectB.id, ownerId, { kind: 'site', sourceFileId: file.id })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('checks ownership before configuration', async () => {
    delete process.env.REPLICATE_API_TOKEN;
    const project = await describedProject();

    // An outsider must not learn whether generation is enabled here.
    await expect(requestMockup(project.id, otherId, { kind: 'concept' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to list or delete another user's mockups", async () => {
    const project = await describedProject();
    const mockup = await prisma.mockup.create({
      data: { projectId: project.id, kind: 'concept', prompt: 'x', status: 'succeeded' },
    });

    await expect(listMockups(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(deleteMockup(project.id, otherId, mockup.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('job execution', () => {
  it('records a reason when generation fails, rather than leaving it running', async () => {
    const project = await describedProject();
    const mockup = await prisma.mockup.create({
      data: { projectId: project.id, kind: 'concept', prompt: 'test', status: 'queued' },
    });

    delete process.env.REPLICATE_API_TOKEN;
    await expect(runMockup(mockup.id)).rejects.toThrow();

    const after = await prisma.mockup.findUniqueOrThrow({ where: { id: mockup.id } });
    // A card stuck on "running" tells the user nothing they can act on.
    expect(after.status).toBe('failed');
    expect(after.failureReason).toContain('REPLICATE_API_TOKEN');
    expect(after.completedAt).not.toBeNull();
  });

  it('ignores a mockup that no longer exists', async () => {
    await expect(runMockup('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });

  it('does not re-run one that already succeeded', async () => {
    const project = await describedProject();
    const mockup = await prisma.mockup.create({
      data: {
        projectId: project.id,
        kind: 'concept',
        prompt: 'done',
        status: 'succeeded',
        resultObjectKey: 'dev/test/key',
      },
    });

    delete process.env.REPLICATE_API_TOKEN;
    // Would throw if it tried to generate again; costing money twice for the
    // same result is the failure being avoided.
    await expect(runMockup(mockup.id)).resolves.toBeUndefined();
    const after = await prisma.mockup.findUniqueOrThrow({ where: { id: mockup.id } });
    expect(after.status).toBe('succeeded');
  });
});
