/**
 * Who may change a project's specification and its design.
 *
 * Two existing permissions already drew these lines and neither was enforced
 * on the write paths: `project.edit` ("Edit the specification, files and
 * conversation") and `design.edit` ("Edit the canvas and decide on design
 * proposals"). Every proposal operation and the draft-spec write checked only
 * project membership, so a worker could rewrite a specification a colleague
 * was about to approve, and a sales or production user could create, approve
 * or reject design proposals.
 *
 * The sharpest case is `approveProposal`, which had a check by accident:
 * `applyCommands` asserts `design.edit`, but its 403 was caught by the handler
 * that treats a failure as "this proposal cannot be applied" and REJECTS the
 * proposal. Pressing Approve without the permission destroyed the thing you
 * were trying to approve. That regression has its own test below.
 *
 * Role sets come from `can(role, …)`, so changing the matrix changes what this
 * file demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from '@/lib/spec/service';
import { getScene, seedScene } from '@/lib/canvas/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import { approveProposal, createProposal, listProposals, rejectProposal } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `dperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** Driven by the matrix rather than by a hardcoded list. */
const canDesign = WORKSPACE_ROLES.filter((role) => can(role, 'design.edit'));
const cannotDesign = WORKSPACE_ROLES.filter((role) => !can(role, 'design.edit'));
const canEditProject = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEditProject = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** An approved project with a seeded canvas, built by the owner. */
async function designedProject() {
  const owner = userIds.owner;
  const project = await createProject(workspaceId, owner, { title: `Design perms ${Math.random()}` });
  await updateDraftSpec(project.id, owner, COMPLETE_SPEC);
  await approveSpec(project.id, owner);
  const scene = await seedScene(project.id, owner);
  return { project, panelId: scene.scene.objects[0].id };
}

/** The same, with one pending proposal waiting for a decision. */
async function projectWithPendingProposal() {
  const { project, panelId } = await designedProject();
  const proposal = await createProposal(project.id, userIds.owner, {
    summary: 'zid 50cm f l3ard.',
    commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
  });
  return { project, panelId, proposal };
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
      name: `Design perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);
});

afterAll(async () => {
  const users = { in: Object.values(userIds) };
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

describe('the matrix these tests are driven by', () => {
  it('keeps design.edit a subset of project.edit', () => {
    // `approveProposal` can reach `updateDraftSpec` through a proposal's spec
    // patch. If a role could edit the design without being allowed to edit the
    // project, approving would half-apply: canvas written, specification
    // refused. Today no such role exists, and this test is what says so.
    for (const role of canDesign) {
      expect(can(role, 'project.edit'), `${role} has design.edit without project.edit`).toBe(true);
    }
  });

  it('still splits the roles both ways, so the assertions below mean something', () => {
    expect(canDesign.length).toBeGreaterThan(0);
    expect(cannotDesign.length).toBeGreaterThan(0);
    expect(canEditProject.length).toBeGreaterThan(0);
    expect(cannotEditProject.length).toBeGreaterThan(0);
  });
});

describe('editing the draft specification', () => {
  it.each(canEditProject)('is allowed for %s', async (role) => {
    const { project } = await designedProject();
    const view = await updateDraftSpec(project.id, userIds[role], { notes: `by ${role}` });
    expect(view.spec.notes).toBe(`by ${role}`);
  });

  it.each(cannotEditProject)('is refused for %s, and changes nothing', async (role) => {
    const { project } = await designedProject();
    const before = await getSpec(project.id, userIds.owner);

    await expect(
      updateDraftSpec(project.id, userIds[role], { notes: 'by someone who may not' })
    ).rejects.toMatchObject({ status: 403 });

    const after = await getSpec(project.id, userIds.owner);
    expect(after.spec).toEqual(before.spec);
    expect(after.version).toBe(before.version);
  });
});

describe('seeding the canvas', () => {
  it.each(canDesign)('is allowed for %s', async (role) => {
    const { project } = await designedProject();
    const view = await seedScene(project.id, userIds[role]);
    expect(view.scene.objects.length).toBeGreaterThan(0);
  });

  it.each(cannotDesign)('is refused for %s, and leaves the scene alone', async (role) => {
    const { project } = await designedProject();
    const before = await getScene(project.id, userIds.owner);

    await expect(seedScene(project.id, userIds[role])).rejects.toMatchObject({ status: 403 });

    const after = await getScene(project.id, userIds.owner);
    expect(after.scene).toEqual(before.scene);
  });
});

describe('creating a design proposal', () => {
  it.each(canDesign)('is allowed for %s', async (role) => {
    const { project, panelId } = await designedProject();
    const proposal = await createProposal(project.id, userIds[role], {
      summary: `by ${role}`,
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9000 } }],
    });
    expect(proposal.status).toBe('pending');
  });

  it.each(cannotDesign)('is refused for %s, and creates nothing', async (role) => {
    const { project, panelId } = await designedProject();

    await expect(
      createProposal(project.id, userIds[role], {
        summary: 'by someone who may not',
        commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9000 } }],
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.designProposal.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotDesign)('cannot supersede a pending proposal as %s', async (role) => {
    const { project, panelId, proposal } = await projectWithPendingProposal();

    // Creating supersedes any pending proposal, so refusing the create has to
    // happen before that write — otherwise the refusal still destroys one.
    await expect(
      createProposal(project.id, userIds[role], {
        summary: 'supersede attempt',
        commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9500 } }],
      })
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.designProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.status).toBe('pending');
    expect(await prisma.designProposal.count({ where: { projectId: project.id } })).toBe(1);
  });
});

describe('rejecting a design proposal', () => {
  it.each(canDesign)('is allowed for %s', async (role) => {
    const { project, proposal } = await projectWithPendingProposal();
    const decided = await rejectProposal(project.id, userIds[role], proposal.id);
    expect(decided.status).toBe('rejected');
  });

  it.each(cannotDesign)('is refused for %s, leaving the proposal pending', async (role) => {
    const { project, proposal } = await projectWithPendingProposal();

    await expect(
      rejectProposal(project.id, userIds[role], proposal.id)
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.designProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.status).toBe('pending');
    expect(after.decidedAt).toBeNull();
  });
});

describe('approving a design proposal', () => {
  it.each(canDesign)('is allowed for %s, and applies the change', async (role) => {
    const { project, proposal } = await projectWithPendingProposal();

    const decided = await approveProposal(project.id, userIds[role], proposal.id);
    expect(decided.status).toBe('approved');
    expect((await getScene(project.id, userIds.owner)).scene.objects[0].widthMm).toBe(8500);
  });

  /* ---- The regression this task exists for ---------------------------- */

  it.each(cannotDesign)(
    'refuses %s with 403 and leaves the proposal untouched',
    async (role) => {
      const { project, panelId, proposal } = await projectWithPendingProposal();

      const error = await approveProposal(project.id, userIds[role], proposal.id).catch(
        (caught: { status?: number; code?: string }) => caught
      );

      // 403, NOT the 409 the old code produced by routing the authorization
      // failure through the proposal-application handler.
      expect(error).toMatchObject({ status: 403 });
      expect((error as { code?: string }).code).not.toBe('proposal_apply_failed');

      // And — the destructive part — the proposal is still pending, with no
      // decision and no failure reason stamped on it.
      const after = await prisma.designProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(after.status).toBe('pending');
      expect(after.decidedAt).toBeNull();
      expect(after.failureReason).toBeNull();

      // The canvas is untouched too.
      const scene = await getScene(project.id, userIds.owner);
      expect(scene.scene.objects.find((object) => object.id === panelId)?.widthMm).toBe(8000);
    }
  );

  it('still rejects an unapplicable proposal for someone who may approve', async () => {
    // Proves the catch was NARROWED, not removed: a genuine application
    // failure must still mark the proposal rejected and answer 409.
    const { project, panelId } = await designedProject();
    const proposal = await createProposal(project.id, userIds.owner, {
      summary: 'targets an object that will be gone',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });

    // Remove the object the proposal targets, so applying it fails with
    // `object_not_found` — an application failure, not an authorization one.
    await prisma.canvasScene.update({
      where: { projectId: project.id },
      data: { data: { sceneVersion: 1, objects: [] } },
    });

    await expect(approveProposal(project.id, userIds.owner, proposal.id)).rejects.toMatchObject({
      status: 409,
      code: 'proposal_apply_failed',
    });

    const after = await prisma.designProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.status).toBe('rejected');
    expect(after.failureReason).toBeTruthy();
  });
});

describe('reads stay open to every member', () => {
  it.each(WORKSPACE_ROLES)('lets %s read the proposals, the scene and the spec', async (role) => {
    const { project } = await projectWithPendingProposal();

    expect(await listProposals(project.id, userIds[role])).toHaveLength(1);
    expect((await getScene(project.id, userIds[role])).scene.objects.length).toBeGreaterThan(0);
    expect((await getSpec(project.id, userIds[role])).spec.projectType).toBe('enseigne');
  });
});
