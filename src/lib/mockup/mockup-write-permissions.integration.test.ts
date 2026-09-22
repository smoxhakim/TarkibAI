/**
 * Who may generate and delete a mockup.
 *
 * `requestMockup` and `deleteMockup` checked project MEMBERSHIP only. That made
 * mockups the one place in TARKIB where an unauthorized member could SPEND
 * MONEY: every request reaches a paid image model, and the job retries twice.
 * A worker — "Read the project and its production package. Nothing else." —
 * could run it as often as they liked, and delete the client-facing artwork
 * afterwards.
 *
 * Both take `design.edit`, which is narrower than the `project.edit` a drawing
 * takes, and deliberately so:
 *
 *  - a drawing is production geometry, and production must be able to issue the
 *    drawing their package is built from;
 *  - a mockup is a PRESENTATION AID from an image model that nothing may
 *    calculate from, and `ROLE_DESCRIPTIONS` names mockups for neither
 *    production nor sales.
 *
 * Where two permissions would both be defensible, the narrower one is correct
 * for an operation billed per call.
 *
 * Reads stay open: every member may look at a mockup, including the roles that
 * may not commission one.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { updateDraftSpec } from '@/lib/spec/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import { SIGNAGE } from '@/lib/domains/registry';
import type { ProjectAiAccess } from '@/lib/ai/access';
import { buildToolbox } from '@/lib/ai/tools';
import { deleteMockup, getMockupImageUrl, listMockups, requestMockup } from './service';

/**
 * Every route to spending money, counted.
 *
 * `inngest.send` is the dispatch that leads to the image model, and
 * `createReplicateProvider` is the model itself. Both are wrapped rather than
 * spied on, because `vi.spyOn` cannot redefine a live ES module export. Neither
 * real implementation is ever invoked here: `send` is replaced outright so no
 * job runner is contacted, and the provider factory throws if anything reaches
 * it, which is the assertion this whole file exists for.
 */
const spend = vi.hoisted(() => ({ enqueued: 0, providerBuilt: 0 }));

vi.mock('@/lib/inngest/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inngest/client')>();
  return {
    ...actual,
    inngest: {
      ...actual.inngest,
      send: async () => {
        spend.enqueued += 1;
        return { ids: [] };
      },
    },
  };
});

vi.mock('./provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./provider')>();
  return {
    ...actual,
    createReplicateProvider: () => {
      spend.providerBuilt += 1;
      throw new Error('The image model must never be reached from this test.');
    },
  };
});

const suffix = `mkperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** A separate business, for the 404 assertions. */
let outsiderId: string;
let outsiderProjectId: string;

const canDesign = WORKSPACE_ROLES.filter((role) => can(role, 'design.edit'));
const cannotDesign = WORKSPACE_ROLES.filter((role) => !can(role, 'design.edit'));

const savedToken = process.env.REPLICATE_API_TOKEN;
const savedR2 = process.env.R2_BUCKET_NAME;

/** An id shaped like the ones the schemas accept, belonging to nothing. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * A project a mockup could legitimately be generated from.
 *
 * The provider and storage guards are satisfied so that an authorized request
 * genuinely proceeds to the enqueue. Otherwise a refused request and an
 * unconfigured server would be indistinguishable, and the assertions below
 * would pass for the wrong reason.
 */
async function describedProject() {
  const project = await createProject(workspaceId, userIds.owner, {
    title: `Mockup perms ${Math.random()}`,
  });
  await updateDraftSpec(project.id, userIds.owner, {
    projectType: 'enseigne',
    materials: [{ name: 'alucobond noir' }],
  });
  return project;
}

async function seedMockup(projectId: string) {
  return prisma.mockup.create({
    data: {
      projectId,
      kind: 'concept',
      prompt: 'a sign',
      promptSource: {},
      status: 'succeeded',
    },
  });
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
      name: `Mockup perms ${suffix}`,
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

beforeEach(() => {
  // Both guards satisfied, so an authorized request reaches the enqueue.
  process.env.REPLICATE_API_TOKEN = `test-token-${suffix}`;
  process.env.R2_BUCKET_NAME = savedR2 ?? `test-bucket-${suffix}`;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = savedToken;
  if (savedR2 === undefined) delete process.env.R2_BUCKET_NAME;
  else process.env.R2_BUCKET_NAME = savedR2;
});

afterAll(async () => {
  vi.restoreAllMocks();
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.mockup.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The permission these operations take                                        */
/* -------------------------------------------------------------------------- */

describe('the permission mockup writes take', () => {
  it('is design.edit, and the worker does not hold it', () => {
    expect(can('designer', 'design.edit')).toBe(true);
    expect(can('worker', 'design.edit')).toBe(false);
  });

  it('is narrower than the project.edit a drawing takes, and on purpose', () => {
    // Sales and production may issue a drawing and edit the project. They may
    // not commission artwork from a paid image model.
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('sales', 'design.edit')).toBe(false);
    expect(can('production', 'design.edit')).toBe(false);
  });

  it('is not cost.view: a designer does not hold it, and no figure is read here', () => {
    expect(can('designer', 'cost.view')).toBe(false);
  });

  it('leaves at least one role on each side of the boundary', () => {
    expect(canDesign.length).toBeGreaterThan(0);
    expect(cannotDesign).toEqual(expect.arrayContaining(['worker', 'sales', 'production']));
  });
});

/* -------------------------------------------------------------------------- */
/* Requesting                                                                  */
/* -------------------------------------------------------------------------- */

describe('requesting a mockup', () => {
  it.each(canDesign)('is allowed for %s, and is queued exactly once', async (role) => {
    const project = await describedProject();
    const before = spend.enqueued;

    const mockup = await requestMockup(project.id, userIds[role], { kind: 'concept' });

    expect(mockup.status).toBe('queued');
    expect(spend.enqueued).toBe(before + 1);
    expect(await prisma.mockup.count({ where: { projectId: project.id } })).toBe(1);
  });

  it.each(cannotDesign)(
    'is refused for %s, and costs nothing: no row, no job, no image model',
    async (role) => {
      const project = await describedProject();
      const before = { ...spend };

      await expect(
        requestMockup(project.id, userIds[role], { kind: 'concept' })
      ).rejects.toMatchObject({ status: 403 });

      // Nothing was queued and nothing was charged for.
      expect(spend.enqueued).toBe(before.enqueued);
      expect(spend.providerBuilt).toBe(0);
      expect(await prisma.mockup.count({ where: { projectId: project.id } })).toBe(0);
    }
  );

  it.each(cannotDesign)('refuses %s before the project is even described', async (role) => {
    // An undescribed project is a 400 for someone who may generate. A caller
    // without the permission must not be able to tell the two apart, which is
    // only true if the capability is asserted before the spec is read.
    const project = await createProject(workspaceId, userIds.owner, {
      title: `Undescribed ${Math.random()}`,
    });

    await expect(
      requestMockup(project.id, userIds[role], { kind: 'concept' })
    ).rejects.toMatchObject({ status: 403 });

    // And an authorised caller really does reach the domain guard.
    await expect(
      requestMockup(project.id, userIds.designer, { kind: 'concept' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(WORKSPACE_ROLES)('reports another business’s project as missing to %s', async (role) => {
    await expect(
      requestMockup(outsiderProjectId, userIds[role], { kind: 'concept' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('never reaches the image model in this entire suite', () => {
    // The provider factory throws if it is ever constructed. This asserts that
    // no path taken above — authorized or refused — got that far.
    expect(spend.providerBuilt).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Deleting                                                                    */
/* -------------------------------------------------------------------------- */

describe('deleting a mockup', () => {
  it.each(canDesign)('is allowed for %s', async (role) => {
    const project = await describedProject();
    const mockup = await seedMockup(project.id);

    await deleteMockup(project.id, userIds[role], mockup.id);
    expect(await prisma.mockup.count({ where: { id: mockup.id } })).toBe(0);
  });

  it.each(cannotDesign)('is refused for %s, and the artwork survives', async (role) => {
    const project = await describedProject();
    const mockup = await seedMockup(project.id);

    await expect(deleteMockup(project.id, userIds[role], mockup.id)).rejects.toMatchObject({
      status: 403,
    });

    const still = await prisma.mockup.findUnique({ where: { id: mockup.id } });
    expect(still).not.toBeNull();
    // The stored object is referenced by the row, which is untouched.
    expect(still?.resultObjectKey).toBe(mockup.resultObjectKey);
  });

  it.each(cannotDesign)(
    'gives %s the same 403 whether the mockup exists or not',
    async (role) => {
      const project = await describedProject();
      const mockup = await seedMockup(project.id);

      await expect(deleteMockup(project.id, userIds[role], mockup.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(deleteMockup(project.id, userIds[role], ABSENT_ID)).rejects.toMatchObject({
        status: 403,
      });
    }
  );

  it.each(WORKSPACE_ROLES)('reports another business’s project as missing to %s', async (role) => {
    await expect(
      deleteMockup(outsiderProjectId, userIds[role], ABSENT_ID)
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe('reading mockups', () => {
  it.each(WORKSPACE_ROLES)('stays open to %s, including the roles that cannot generate', async (role) => {
    const project = await describedProject();
    await seedMockup(project.id);

    const mockups = await listMockups(project.id, userIds[role]);
    expect(mockups).toHaveLength(1);
  });

  it('refuses an image url for a mockup with no stored object, rather than 403', async () => {
    const project = await describedProject();
    const mockup = await seedMockup(project.id);
    // A worker may read; there is simply no image on this row.
    await expect(
      getMockupImageUrl(project.id, userIds.worker, mockup.id)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('still refuses to list another business’s mockups', async () => {
    await expect(listMockups(outsiderProjectId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The AI surface                                                              */
/* -------------------------------------------------------------------------- */

describe('the AI boundary', () => {
  it('gives no role a tool that touches mockups at all', () => {
    for (const role of WORKSPACE_ROLES) {
      const access: ProjectAiAccess = {
        projectId: 'project-1',
        workspaceId: asWorkspaceId('workspace-1'),
        userId: 'user-1',
        role,
        domain: SIGNAGE,
      };
      for (const name of buildToolbox(access).map((tool) => tool.name)) {
        expect(name, `${role} must not have ${name}`).not.toMatch(/mockup|image|render/i);
      }
    }
  });
});
